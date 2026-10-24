// Logic Lab — handwriting pad. Recognises finger/stylus writing ON THE DEVICE: no key, no server, no limits.
// A small CNN (ink-model.bin, trained on HASYv2 + Google MathWriting glyphs; train/ in the repo) classifies each
// written symbol; a decoder then reads the whole line with the grammar of propositional logic and the symbols
// already on the board, so an ambiguous squiggle (v / ∨, → / ⇒, o / O) becomes whatever makes a valid line.
// Corrections the student taps are remembered (localStorage) and bias later reads toward their handwriting.
(function (root) {
  'use strict';
  const R = 32, BOX = 26, SS = 4;

  // ───────────────────────── model ─────────────────────────
  let M = null, loading = null;
  function loadModel(base) {
    if (M) return Promise.resolve(M);
    if (loading) return loading;
    loading = (async () => {
      const meta = await (await fetch(base + 'ink-model.json?v=' + (root.INK_V || 1))).json();
      const buf = new Int8Array(await (await fetch(base + 'ink-model.bin?v=' + (root.INK_V || 1))).arrayBuffer());
      const T = {}; let o = 0;
      for (const t of meta.tensors) {
        const n = t.shape.reduce((a, b) => a * b, 1), f = new Float32Array(n);
        for (let i = 0; i < n; i++) f[i] = buf[o + i] * t.scale;
        T[t.name] = f; o += n;
      }
      M = { classes: meta.classes, T, meta };
      return M;
    })();
    return loading;
  }
  function conv3(inp, C, H, W, w, b, O) {          // 3×3, same padding, ReLU
    const out = new Float32Array(O * H * W), HW = H * W;
    for (let o = 0; o < O; o++) {
      const ob = o * HW; out.fill(b[o], ob, ob + HW);
      for (let c = 0; c < C; c++) {
        const ib = c * HW, wb = (o * C + c) * 9;
        for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++) {
          const wv = w[wb + ky * 3 + kx]; if (wv === 0) continue;
          const dy = ky - 1, dx = kx - 1;
          const y0 = Math.max(0, -dy), y1 = Math.min(H, H - dy), x0 = Math.max(0, -dx), x1 = Math.min(W, W - dx);
          for (let y = y0; y < y1; y++) {
            const orow = ob + y * W, irow = ib + (y + dy) * W + dx;
            for (let x = x0; x < x1; x++) out[orow + x] += wv * inp[irow + x];
          }
        }
      }
      for (let i = ob; i < ob + HW; i++) if (out[i] < 0) out[i] = 0;
    }
    return out;
  }
  function pool2(inp, C, H, W) {
    const h = H >> 1, w = W >> 1, out = new Float32Array(C * h * w);
    for (let c = 0; c < C; c++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = c * H * W + 2 * y * W + 2 * x;
      out[c * h * w + y * w + x] = Math.max(inp[i], inp[i + 1], inp[i + W], inp[i + W + 1]);
    }
    return out;
  }
  function forward(img, aspect) {                   // img: Float32Array(1024) in 0..1 → {logp, feat}
    const T = M.T, S = M.meta.ch;                   // ch = [24,32,48,64,96]
    let x = conv3(img, 1, 32, 32, T['c1.weight'], T['c1.bias'], S[0]);
    x = pool2(conv3(x, S[0], 32, 32, T['c2.weight'], T['c2.bias'], S[1]), S[1], 32, 32);
    x = conv3(x, S[1], 16, 16, T['c3.weight'], T['c3.bias'], S[2]);
    x = pool2(conv3(x, S[2], 16, 16, T['c4.weight'], T['c4.bias'], S[3]), S[3], 16, 16);
    x = pool2(conv3(x, S[3], 8, 8, T['c5.weight'], T['c5.bias'], S[4]), S[4], 8, 8);
    const nin = x.length + 1, F1 = T['f1.weight'], nh = T['f1.bias'].length, feat = new Float32Array(nh);
    const a = Math.max(-3, Math.min(3, aspect));
    for (let j = 0; j < nh; j++) {
      let s = T['f1.bias'][j]; const r = j * nin;
      for (let i = 0; i < x.length; i++) s += F1[r + i] * x[i];
      s += F1[r + x.length] * a; feat[j] = s > 0 ? s : 0;
    }
    const F2 = T['f2.weight'], nc = T['f2.bias'].length, lg = new Float32Array(nc);
    let mx = -1e9;
    for (let k = 0; k < nc; k++) { let s = T['f2.bias'][k]; for (let j = 0; j < nh; j++) s += F2[k * nh + j] * feat[j]; lg[k] = s; if (s > mx) mx = s; }
    let z = 0; for (let k = 0; k < nc; k++) z += Math.exp(lg[k] - mx);
    const lz = mx + Math.log(z); for (let k = 0; k < nc; k++) lg[k] -= lz;
    return { logp: lg, feat };
  }

  // ───────────────────── rendering (matches train/build.py) ─────────────────────
  let cv = null;
  function render(strokes) {                        // strokes: [[ [x,y],… ],…] → {img, aspect}
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const s of strokes) for (const [x, y] of s) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const w = Math.max(x1 - x0, 1e-3), h = Math.max(y1 - y0, 1e-3), sc = BOX / Math.max(w, h);
    const ox = (R - w * sc) / 2 - x0 * sc, oy = (R - h * sc) / 2 - y0 * sc, N = R * SS;
    if (!cv) { cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(N, N) : Object.assign(document.createElement('canvas'), { width: N, height: N }); }
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.clearRect(0, 0, N, N); g.strokeStyle = g.fillStyle = '#fff'; g.lineWidth = 2.2 * SS; g.lineCap = g.lineJoin = 'round';
    for (const s of strokes) {
      g.beginPath();
      s.forEach(([x, y], i) => { const px = (x * sc + ox) * SS, py = (y * sc + oy) * SS; i ? g.lineTo(px, py) : g.moveTo(px, py); });
      if (s.length === 1) { const [x, y] = s[0]; g.arc((x * sc + ox) * SS, (y * sc + oy) * SS, 1.1 * SS, 0, 7); g.fill(); } else g.stroke();
    }
    const d = g.getImageData(0, 0, N, N).data, hi = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) hi[i] = d[i * 4 + 3] / 255;
    // PIL BILINEAR downscale ×4 = triangle filter of radius 4 source pixels
    const tmp = new Float32Array(R * N), img = new Float32Array(R * R), wts = [];
    for (let k = -4; k < 4; k++) wts.push(Math.max(0, 1 - Math.abs(k + 0.5) / 4));
    const ws = wts.reduce((a, b) => a + b, 0);
    for (let y = 0; y < N; y++) for (let X = 0; X < R; X++) { let s = 0; const c = X * SS + 2; for (let k = -4; k < 4; k++) { const xx = c + k; if (xx >= 0 && xx < N) s += hi[y * N + xx] * wts[k + 4]; } tmp[y * R + X] = s / ws; }
    for (let Y = 0; Y < R; Y++) for (let X = 0; X < R; X++) { let s = 0; const c = Y * SS + 2; for (let k = -4; k < 4; k++) { const yy = c + k; if (yy >= 0 && yy < N) s += tmp[yy * R + X] * wts[k + 4]; } img[Y * R + X] = Math.round(Math.min(1, s / ws) * 255) / 255; }
    return { img, aspect: Math.log(w / h) };
  }

  // ───────────────────── personal handwriting memory ─────────────────────
  const MEM_KEY = 'logiclab.v1.inkmem';
  let mem = []; try { mem = JSON.parse(localStorage.getItem(MEM_KEY) || '[]'); } catch (e) { mem = []; }
  const saveMem = () => { try { localStorage.setItem(MEM_KEY, JSON.stringify(mem.slice(-400))); } catch (e) { } };
  function remember(feat, cls) {
    const n = Math.hypot(...feat) || 1;
    mem.push({ c: cls, f: Array.from(feat, (v) => +(v / n).toFixed(4)) });
    const same = mem.filter((m) => m.c === cls); if (same.length > 25) mem.splice(mem.indexOf(same[0]), 1);
    saveMem();
  }
  function personal(logp, feat) {
    if (!mem.length) return logp;
    const n = Math.hypot(...feat) || 1, best = {};
    for (const m of mem) { let s = 0; for (let j = 0; j < feat.length; j++) s += m.f[j] * feat[j]; s /= n; if (!(best[m.c] >= s)) best[m.c] = s; }
    const out = Float32Array.from(logp); const ci = M.classes;
    for (const c in best) { const s = best[c]; const k = ci.indexOf(c); if (k >= 0 && s > 0.82) out[k] += 7 * (s - 0.82) / 0.18; }
    return out;
  }

  // ───────────────────── segmentation ─────────────────────
  function units(strokes) {                       // group strokes that overlap horizontally (one glyph)
    const bx = strokes.map((s) => { let a = 1e9, b = -1e9, t = 1e9, u = -1e9; for (const [x, y] of s) { a = Math.min(a, x); b = Math.max(b, x); t = Math.min(t, y); u = Math.max(u, y); } return { a, b, t, u }; });
    const order = strokes.map((_, i) => i).sort((i, j) => (bx[i].a + bx[i].b) - (bx[j].a + bx[j].b));
    const G = [];
    for (const k of order) {
      const { a, b, t, u } = bx[k], g = G[G.length - 1];
      if (g) {
        const ov = Math.min(b, g.b) - Math.max(a, g.a), w = Math.min(b - a, g.b - g.a);
        if (ov > 0.45 * Math.max(w, 1)) { g.s.push(k); g.a = Math.min(a, g.a); g.b = Math.max(b, g.b); g.t = Math.min(t, g.t); g.u = Math.max(u, g.u); continue; }
      }
      G.push({ s: [k], a, b, t, u });
    }
    return G;
  }

  // ───────────────────── reading a line ─────────────────────
  // class → [token, log-prior]; letters/digits map to themselves
  const OPS = { and: [['∧', 0]], amp: [['∧', 0]], or: [['∨', 0]], not: [['¬', 0]], sim: [['¬', 0]], '-': [['¬', -0.7]],
    imp: [['⇒', 0]], to: [['⇒', 0]], iff: [['⇔', 0]], lr: [['⇔', 0]], '=': [['⇔', -1.2]], top: [['⊤', 0]], bot: [['⊥', 0]],
    all: [['∀', -2]], ex: [['∃', -2]], '(': [['(', 0]], ')': [[')', 0]], ',': [[',', 0]], '+': [['t', -1.5]], '<': [['(', -2.5]], '>': [['⇒', -1.5], [')', -2.5]],
    '|': [['I', -0.4], ['l', -0.8], ['1', -0.8]], v: [['∨', 0], ['v', -0.4]], V: [['∨', 0], ['V', -0.4]], o: [['o', 0], ['O', -0.6], ['0', -1]], O: [['O', 0], ['0', -0.8]], '0': [['0', 0], ['O', -0.8]] };
  const tokOf = (c) => OPS[c] || [[c, 0]];
  const isL = (ch) => /^[A-Za-z]$/.test(ch), isD = (ch) => /^\d$/.test(ch);
  const BIN = '∧∨⇒⇔';
  const canon = (w) => w.replace(/,/g, '');
  function decode(cands, nU, lex, final, start) {
    // cands[i] = [{len, alts:[{tok, lp, cls}], seg}] for segments starting at unit i
    const L = lex.size, lexArr = [...lex];
    const prefixOK = (w) => !L || lexArr.some((a) => a.startsWith(canon(w)));
    const finishIdent = (st) => {
      if (!st.id) return 0; const c = canon(st.id);
      if (L) return lex.has(c) ? 1.5 : -5;
      return /^[A-Z]/.test(c) ? 0 : -1.2;
    };
    let beams = [{ i: 0, out: [], mode: (start && start.mode) || 'o', dep: (start && start.dep) || 0, id: '', sc: 0 }];
    const done = [];
    for (let step = 0; step < 80 && beams.length; step++) {
      const nxt = [];
      for (const b of beams) {
        if (b.i >= nU) { done.push(b); continue; }
        for (const cand of cands[b.i] || []) {
          for (const al of cand.alts) {
            const t = al.tok; let sc = b.sc + al.lp + 1.2 - 2.2 * (cand.len - 1), mode = b.mode, dep = b.dep, id = b.id;
            const bad = (p) => { sc -= p; };
            if (isL(t)) {
              if (mode === 'o') { mode = 'a'; id = t; }
              else if (id && !/[,]$/.test(id)) { if (/\d$/.test(id)) bad(6); id += t; }
              else bad(8);
              if (!prefixOK(id)) bad(3);
            } else if (isD(t)) {
              if (mode === 'a' && id) { id += t; if (!prefixOK(id)) bad(3); } else bad(8);
            } else if (t === ',') {
              if (mode === 'a' && /\d$/.test(id)) id += ','; else bad(8);
            } else {
              if (id) { sc += finishIdent({ id }); id = ''; }
              if (t === '¬') { if (mode !== 'o') bad(8); }
              else if (t === '(') { if (mode !== 'o') bad(8); dep++; }
              else if (t === ')') { if (mode !== 'a' || dep === 0) bad(8); dep = Math.max(0, dep - 1); }
              else if (BIN.includes(t)) { if (mode !== 'a') bad(8); mode = 'o'; }
              else if (t === '⊤' || t === '⊥') { if (mode !== 'o') bad(8); mode = 'a'; }
              else if (t === '∀' || t === '∃') { if (mode !== 'o') bad(8); }
            }
            nxt.push({ i: b.i + cand.len, out: [...b.out, { tok: t, seg: cand.seg, alts: cand.alts, cls: al.cls }], mode, dep, id, sc });
          }
        }
      }
      nxt.sort((a, b) => b.sc - a.sc);
      const seen = new Set(); beams = [];
      for (const b of nxt) { const k = b.i + '|' + b.out.map((o) => o.tok).join(''); if (seen.has(k)) continue; seen.add(k); beams.push(b); if (beams.length >= 48) break; }
    }
    for (const b of done) {
      if (b.id) b.sc += finishIdent(b);
      if (final) { if (b.mode !== 'a') b.sc -= 5; b.sc -= 6 * b.dep; }
    }
    done.sort((a, b) => b.sc - a.sc);
    return done;
  }
  // write each symbol the way the board writes it (P12 / P1,2 are the same symbol to the checker)
  const spell = (text, lexicon) => { const by = {}; (lexicon || []).forEach((w) => { by[canon(w)] = w.replace(/^([A-Z][a-z]?)(\d)(\d)$/, '$1$2,$3'); });
    return text.replace(/[A-Za-z][A-Za-z_]*(?:\d+(?:,\d+)?)?/g, (w) => by[canon(w)] || w); };
  const pretty = (toks) => toks.map((t) => (BIN.includes(t) ? ' ' + t + ' ' : t)).join('').replace(/\s+/g, ' ').trim();

  // strokes → {text, tokens:[{tok, seg:[unitIdx…], alts}]}
  // grammar state after text already in the box (the pad appends to it): operand expected next ('o') or operator ('a')
  function stateAfter(prefix) {
    const p = String(prefix || '').replace(/\s+/g, ''); if (!p) return null;
    const dep = Math.max(0, (p.match(/\(/g) || []).length - (p.match(/\)/g) || []).length);
    return { mode: /[A-Za-z0-9)⊤⊥□]$/.test(p) ? 'a' : 'o', dep };
  }
  function recognise(strokes, lexicon, final, prefix) {
    if (!M || !strokes.length) return { text: '', tokens: [] };
    const U = units(strokes);
    const hs = U.map((u) => u.u - u.t).sort((a, b) => a - b), med = Math.max(8, hs[hs.length >> 1] || 20);
    const singleBest = [];
    const single = (k) => {                        // best log-prob of unit k read on its own
      if (singleBest[k] !== undefined) return singleBest[k];
      const key = U[k].s.map((si) => sid(strokes[si])).join('.');
      let r = cache.get(key); if (!r) { const { img, aspect } = render(U[k].s.map((si) => strokes[si])); r = forward(img, aspect); cache.set(key, r); }
      return (singleBest[k] = Math.max(...r.logp));
    };
    const cands = [], lexChars = new Set();
    (lexicon || []).forEach((w) => [...canon(w)].forEach((ch) => lexChars.add(ch)));
    for (let i = 0; i < U.length; i++) {
      cands[i] = [];
      for (let len = 1; len <= 3 && i + len <= U.length; len++) {
        if (len > 1 && U[i + len - 1].a - U[i + len - 2].b > 0.45 * med) break;      // gap too wide to be one glyph
        if (len > 1 && U.slice(i, i + len).every((u, q) => single(i + q) > -0.25) && U[i + len - 1].a - U[i + len - 2].b > 0.12 * med) break;  // confident separate glyphs: skip the merge
        const ss = []; for (let k = i; k < i + len; k++) U[k].s.forEach((si) => ss.push(strokes[si]));
        const key = U.slice(i, i + len).map((u) => u.s.map((si) => sid(strokes[si])).join('.')).join('|');
        let r = cache.get(key);
        if (!r) { const { img, aspect } = render(ss); r = forward(img, aspect); cache.set(key, r); }
        const lp = personal(r.logp, r.feat);
        // geometry: a comma is small and low; brackets and | are tall
        const h = (U[i + len - 1].u - U[i].t), lowMid = (U[i].t + U[i].u) / 2;
        const alts = [];
        const order = Array.from(lp.keys()).sort((a, b) => lp[b] - lp[a]).slice(0, 6);
        const must = new Set(['(', ')', 'not', 'and', 'or', 'imp', 'iff', ...lexChars]);   // always keep these readings in play
        for (const k of order.concat(Array.from(lp.keys()).filter((q) => must.has(M.classes[q]) && !order.includes(q)))) {
          if (lp[k] < Math.log(0.004) && !must.has(M.classes[k])) continue;
          for (const [tok, pri] of tokOf(M.classes[k])) {
            let g = 0;
            if (tok === ',' && h > 0.6 * med) g -= 3;
            if ((tok === '(' || tok === ')') && h < 0.5 * med) g -= 2;
            alts.push({ tok, lp: lp[k] + pri + g, cls: M.classes[k] });
          }
        }
        alts.sort((a, b) => b.lp - a.lp);
        const uniq = []; for (const a of alts) if (!uniq.some((u) => u.tok === a.tok)) uniq.push(a);
        cands[i].push({ len, seg: Array.from({ length: len }, (_, q) => i + q), alts: uniq.slice(0, 9), key, feat: r.feat });
        void lowMid;
      }
    }
    const lex = new Set((lexicon || []).map(canon));
    const all = decode(cands, U.length, lex, final, stateAfter(prefix));
    if (!all.length) return { text: '', tokens: [], readings: [] };
    // the top few distinct whole-line readings: shown as tappable suggestions, and the user's pick becomes a label
    const readings = [];
    for (const b of all) {
      if (readings.length >= 5 || b.sc < all[0].sc - 14) break;
      const tokens = b.out.map((o) => ({ tok: o.tok, alts: o.alts, units: o.seg, strokes: o.seg.flatMap((u) => U[u].s), cand: cands[o.seg[0]].find((c) => c.len === o.seg.length) }));
      const text = spell(pretty(tokens.map((t) => t.tok)), lexicon);
      if (!readings.some((r) => norm(r.text) === norm(text))) readings.push({ text, tokens, sc: +b.sc.toFixed(2) });
    }
    return { text: readings[0].text, tokens: readings[0].tokens, readings };
  }
  const norm = (t) => String(t || '').replace(/\s+/g, '');
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cache = new Map(), ids = new WeakMap(); let nid = 0;

  // ───────────────────── training-data collection (ink-collect.php) ─────────────────────
  // Every line written on the pad and then checked is saved WITHOUT any name, roll number or IP: the strokes, the
  // readings shown, what the writer picked or corrected, and the checker's ✓/×. It trains later versions of the model.
  // On by default with a visible notice under the pad; "Turn off" and "Delete what I sent" are always one tap away.
  const Collect = (() => {
    const OFF = 'logiclab.v1.inkcollect', CID = 'logiclab.v1.inkcid', Q = 'logiclab.v1.inkq', BAK = 'logiclab.v1.inkbak', NOTICE_V = '2026-10-03';
    const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
    const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
    const capped = (k, arr, bytes) => { while (arr.length && JSON.stringify(arr).length > bytes) arr.shift(); while (arr.length && !put(k, arr)) arr.shift(); if (!arr.length) put(k, []); };
    const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
    const on = () => { try { return localStorage.getItem(OFF) !== 'off'; } catch (e) { return false; } };
    const cid = () => { let c = ''; try { c = localStorage.getItem(CID) || ''; } catch (e) { } if (!/^[a-f0-9]{16,32}$/.test(c)) { c = hex(12); try { localStorage.setItem(CID, c); } catch (e) { } } return c; };
    let base = '', busy = false, sent = 0;
    async function flush() {
      if (busy || !on()) return;
      const q = get(Q, []); if (!q.length) return;
      busy = true;
      try {
        const batch = []; let sz = 0;
        for (const r of q) { const n = JSON.stringify(r).length; if (batch.length && (sz + n > 450000 || batch.length >= 30)) break; batch.push(r); sz += n; }
        const res = await fetch(base + 'ink-collect.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cid: cid(), recs: batch }), keepalive: sz < 60000 });
        const j = await res.json().catch(() => ({}));
        if (j.ok || res.status === 400 || res.status === 413) {          // sent, or a record the server will never take
          const gone = new Set(batch.map((r) => r.rid)); put(Q, get(Q, []).filter((r) => !gone.has(r.rid)));
          if (j.ok) { sent += j.n || 0; if (q.length > batch.length) setTimeout(flush, 400); }
        }
      } catch (e) { /* offline: stays queued, retried on the next line or page load */ } finally { busy = false; }
    }
    function add(rec) {
      if (!on()) return;
      Object.assign(rec, { v: 1, rid: hex(8), at: new Date().toISOString(), consent: { train: true, notice: NOTICE_V } });
      const q = get(Q, []); q.push(rec); capped(Q, q, 1.2e6);
      const b = get(BAK, []); b.push(rec); capped(BAK, b, 1.2e6);       // local backup of the latest lines
      flush();
    }
    async function forget() {
      const c = cid();
      try { const r = await fetch(base + 'ink-collect.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cid: c, forget: 1 }) }); if (!(await r.json()).ok) return false; } catch (e) { return false; }
      try { [Q, BAK, CID].forEach((k) => localStorage.removeItem(k)); localStorage.setItem(OFF, 'off'); } catch (e) { }
      return true;
    }
    const set = (v) => { try { v ? localStorage.removeItem(OFF) : localStorage.setItem(OFF, 'off'); } catch (e) { } if (v) flush(); };
    return { init: (b) => { base = b || ''; setTimeout(flush, 1500); }, add, flush, forget, on, set, sent: () => sent, pending: () => get(Q, []).length };
  })();
  const sid = (s) => { let v = ids.get(s); if (!v) { v = ++nid; ids.set(s, v); } return v; };

  // ───────────────────── the pad (UI) ─────────────────────
  function attach(host, opts) {
    // opts: {input, lexicon:()=>[…], onSubmit, base}
    host.innerHTML = `<div class="ink-wrap"><canvas class="ink-cv"></canvas><div class="ink-hint">Write the whole line here with your finger, big and clear. Leave a little gap between symbols.</div></div>
      <div class="ink-chips" aria-live="polite"></div>
      <div class="ink-bar"><button type="button" class="btn" data-a="undo">↶ Undo stroke</button><button type="button" class="btn" data-a="clear">Clear</button><button type="button" class="btn" data-a="back" title="Show the start of the line again" disabled>⇢ Back</button><button type="button" class="btn" data-a="space">⇠ More room</button><span class="ink-st note"></span><span style="flex:1"></span><button type="button" class="btn primary" data-a="check">${opts.submitLabel || 'Check line'}</button></div>
      <div class="ink-consent note"></div>`;
    const cvs = host.querySelector('.ink-cv'), ctx = cvs.getContext('2d'), chips = host.querySelector('.ink-chips');
    const st = host.querySelector('.ink-st'), hint = host.querySelector('.ink-hint'), cons = host.querySelector('.ink-consent');
    const S = []; let cur = null, pan = 0, timer = null, last = null, dpr = 1;
    let t0 = null, pick = null, chipFix = [], events = []; const ptrs = new Set();
    // text already in the box when this line was started: the pad ADDS after it (Kiran 2026-10-03), unless the app says
    // the box only holds a starting suggestion (opts.replaceIf, e.g. the CNF box prefilled with the last line)
    let prefix = null, pmode = 'append';
    const join = (a, b) => (!a ? b : !b ? a : (a + ' ' + b).replace(/([(¬])\s+/g, '$1').replace(/\s+\)/g, ')'));
    const compose = (t) => (pmode === 'append' ? join(prefix, t) : t);
    const startLine = () => { if (prefix != null) return; prefix = opts.input.value.trim(); pmode = prefix && opts.replaceIf && opts.replaceIf(prefix) ? 'replace' : 'append'; };   // what the writer did with this line (for the training record)
    function paintConsent() {
      cons.innerHTML = Collect.on()
        ? 'Your writing is saved <b>without your name</b> to train this pad, so it reads handwriting better. <a href="#" data-c="off">Turn off</a> · <a href="#" data-c="forget">Delete what I sent</a>'
        : 'Saving your writing to train the pad is off. <a href="#" data-c="on">Turn on</a>';
      cons.querySelectorAll('a').forEach((a) => (a.onclick = async (e) => {
        e.preventDefault(); const c = a.dataset.c;
        if (c === 'on' || c === 'off') Collect.set(c === 'on');
        if (c === 'forget') { if (!confirm('Delete every line this browser has sent for training, and stop saving?')) return; cons.textContent = 'Deleting…'; const ok = await Collect.forget(); if (!ok) { cons.textContent = 'Could not reach the server — try again when online.'; setTimeout(paintConsent, 2500); return; } cons.textContent = 'Done: your lines will be deleted from the training data, and saving is off.'; setTimeout(paintConsent, 3500); return; }
        paintConsent();
      }));
    }
    paintConsent(); Collect.init(opts.base || '');
    const size = () => { dpr = window.devicePixelRatio || 1; const r = cvs.getBoundingClientRect(); cvs.width = Math.round(r.width * dpr); cvs.height = Math.round(r.height * dpr); draw(); };
    function draw() {
      const bk = host.querySelector('[data-a="back"]'); if (bk) bk.disabled = pan <= 0;
      const W = cvs.width / dpr, H = cvs.height / dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(0,0,0,.10)'; ctx.lineWidth = 1; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.moveTo(0, H * 0.72); ctx.lineTo(W, H * 0.72); ctx.stroke(); ctx.setLineDash([]);
      const hl = new Set(); if (last && sel != null && last.tokens[sel]) last.tokens[sel].strokes.forEach((k) => hl.add(k));
      S.forEach((s, k) => { ctx.strokeStyle = hl.has(k) ? '#c2410c' : '#1f2937'; ctx.lineWidth = 3; ctx.lineCap = ctx.lineJoin = 'round'; ctx.beginPath(); s.forEach(([x, y], i) => (i ? ctx.lineTo(x - pan, y) : ctx.moveTo(x - pan, y))); if (s.length === 1) { ctx.arc(s[0][0] - pan, s[0][1], 1.5, 0, 7); } ctx.stroke(); });
      if (cur) { ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 3; ctx.beginPath(); cur.forEach(([x, y], i) => (i ? ctx.lineTo(x - pan, y) : ctx.moveTo(x - pan, y))); ctx.stroke(); }
    }
    const r1 = (v) => Math.round(v * 10) / 10;
    const pos = (e) => { const r = cvs.getBoundingClientRect(); return [r1(e.clientX - r.left + pan), r1(e.clientY - r.top), Math.max(0, Math.round(e.timeStamp - t0))]; };
    cvs.addEventListener('pointerdown', (e) => { e.preventDefault(); cvs.setPointerCapture(e.pointerId); if (t0 == null) t0 = e.timeStamp; startLine(); ptrs.add(e.pointerType || '?'); cur = [pos(e)]; hint.style.display = 'none'; clearTimeout(timer); });
    cvs.addEventListener('pointermove', (e) => { if (!cur) return; const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; for (const ev of evs) cur.push(pos(ev)); draw(); });
    const up = () => { if (!cur) return; S.push(cur); cur = null; sel = null; pick = null; chipFix = []; const W = cvs.width / dpr; const mx = Math.max(...S[S.length - 1].map((p) => p[0])) - pan; if (mx > W * 0.88) { pan += W * 0.45; } draw(); clearTimeout(timer); timer = setTimeout(() => run(false), 260); };
    cvs.addEventListener('pointerup', up); cvs.addEventListener('pointercancel', up);
    let sel = null;
    async function run(final) {
      if (!S.length) { opts.input.value = prefix != null ? prefix : opts.input.value; chips.innerHTML = ''; return; }
      if (!M) { st.textContent = 'loading recogniser…'; await loadModel(opts.base || ''); st.textContent = ''; }
      const t0 = performance.now();
      last = recognise(S, opts.lexicon ? opts.lexicon() : [], final, pmode === 'append' ? prefix : '');
      opts.input.value = compose(last.text); opts.input.dispatchEvent(new Event('input', { bubbles: true }));
      st.textContent = `read in ${Math.round(performance.now() - t0)} ms · on this device`;
      paintChips();
    }
    function paintChips() {
      const RD = last.readings || [], on = pick == null ? 0 : pick;
      const pre = prefix ? `<div class="ink-pre note">${pmode === 'append' ? `Adding after <b>${esc(prefix)}</b> · <a href="#" data-p="replace">replace the box instead</a>` : `Replacing <b>${esc(prefix)}</b> · <a href="#" data-p="append">add after it instead</a>`}</div>` : '';
      chips.innerHTML = pre + (RD.length > 1 ? `<div class="ink-sugg"><span class="note">Readings:</span>${RD.map((r, j) => `<button type="button" class="ink-read${j === on ? ' on' : ''}" data-j="${j}">${esc(r.text)}</button>`).join('')}</div>` : '') + (last.tokens || []).map((t, i) => `<button type="button" class="ink-chip${i === sel ? ' on' : ''}" data-i="${i}">${t.tok === ',' ? ',' : t.tok}</button>`).join('') +
        (sel != null && last.tokens[sel] ? `<div class="ink-alts">Meant: ${last.tokens[sel].alts.map((a) => `<button type="button" class="ink-alt" data-t="${a.tok}" data-c="${a.cls}">${a.tok}</button>`).join('')}${['¬', '∧', '∨', '⇒', '⇔', '(', ')'].filter((x) => !last.tokens[sel].alts.some((a) => a.tok === x)).map((x) => `<button type="button" class="ink-alt more" data-t="${x}">${x}</button>`).join('')}</div>` : '');
      chips.querySelectorAll('.ink-chip').forEach((b) => (b.onclick = () => { sel = sel === +b.dataset.i ? null : +b.dataset.i; paintChips(); draw(); }));
      chips.querySelectorAll('.ink-alt').forEach((b) => (b.onclick = () => fix(sel, b.dataset.t, b.dataset.c)));
      chips.querySelectorAll('.ink-read').forEach((b) => (b.onclick = () => choose(+b.dataset.j)));
      chips.querySelectorAll('[data-p]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); pmode = a.dataset.p; events.push({ k: 'pmode', to: pmode }); run(false); }));
    }
    function choose(j) {                                   // the writer tapped one of the whole-line readings
      const r = last && last.readings && last.readings[j]; if (!r) return;
      pick = j; chipFix = []; events.push({ k: 'pick', j, n: S.length });
      last.tokens = r.tokens.map((t) => ({ ...t })); last.text = r.text; opts.input.value = compose(r.text); opts.input.dispatchEvent(new Event('input', { bubbles: true }));
      sel = null; paintChips(); draw();
    }
    const TOK2CLS = { '¬': 'not', '∧': 'and', '∨': 'or', '⇒': 'imp', '⇔': 'iff', '(': '(', ')': ')', ',': ',', '⊤': 'top', '⊥': 'bot' };
    function fix(i, tok, cls) {
      const t = last.tokens[i]; if (!t) return;
      const c = cls && cls !== 'undefined' ? cls : (TOK2CLS[tok] || tok);
      if (t.cand && M.classes.includes(c)) remember(t.cand.feat, c);   // learn this person's way of writing it
      chipFix.push({ i, from: t.tok, to: tok }); events.push({ k: 'chip', i, from: t.tok, to: tok, n: S.length });
      t.tok = tok; last.text = pretty(last.tokens.map((x) => x.tok)); opts.input.value = compose(last.text); sel = null; paintChips(); draw();
    }
    host.querySelectorAll('.ink-bar button').forEach((b) => (b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'undo') { S.pop(); if (!S.length) pan = 0; pick = null; chipFix = []; events.push({ k: 'undo', n: S.length }); }
      if (a === 'clear') { S.length = 0; pan = 0; cache.clear(); resetLine(); }
      if (a === 'space') { pan += (cvs.width / dpr) * 0.45; draw(); return; }
      if (a === 'back') { pan = Math.max(0, pan - (cvs.width / dpr) * 0.45); draw(); return; }
      if (a === 'check') {
        clearTimeout(timer);
        // keep what the writer chose: re-read only if they neither picked, fixed a chip, nor typed in the box
        const kept = last && (pick != null || chipFix.length || norm(opts.input.value) !== norm(compose(last.text)));
        (S.length && !kept ? run(true) : Promise.resolve()).then(() => {
          const snap = S.length && last ? snapshot() : null;
          const v = opts.onSubmit && opts.onSubmit();
          if (snap && v && typeof v === 'object' && 'ok' in v) record(snap, v);
        });
        return;
      }
      sel = null; draw(); run(false);
    }));
    function resetLine() { prefix = null; pmode = 'append'; t0 = null; pick = null; chipFix = []; events = []; ptrs.clear(); }
    function snapshot() {
      const text = opts.input.value.trim(), RD = last.readings || [];
      let ctx = null; try { ctx = opts.context ? opts.context() : null; } catch (e) { }
      return {
        strokes: S.map((s) => s.map((p) => p.slice())), shown: RD.map((r) => r.text), top: RD.length ? RD[0].text : last.text,
        pick, chips: chipFix.slice(), events: events.slice(-40), typed: norm(text) !== norm(compose(last.text)), text, prefix: pmode === 'append' ? prefix || '' : '', pmode,
        lex: opts.lexicon ? opts.lexicon() : [], ctx,
        dev: { ptr: [...ptrs], coarse: !!(window.matchMedia && matchMedia('(pointer: coarse)').matches), w: Math.round(cvs.width / dpr), h: Math.round(cvs.height / dpr), dpr },
        model: { v: (M && M.meta.version) || 'v1', n: root.INK_V || 0 },
      };
    }
    function record(snap, v) {
      // label quality: ✓ from the checker on an un-typed line = gold; a pick, chip fix or typed correction = silver
      const verdict = v.ok === null ? null : { ok: !!v.ok, msg: String(v.msg || '').slice(0, 200) };
      const tier = verdict && verdict.ok && !snap.typed ? 'gold' : (snap.pick != null || snap.chips.length || snap.typed) ? 'silver' : 'none';
      Collect.add({ ...snap, verdict, tier });
      resetLine();
    }
    new ResizeObserver(size).observe(cvs); size();
    loadModel(opts.base || '').catch(() => { st.textContent = 'could not load the recogniser — check your connection'; });
    return { strokes: S, run, clear: () => { S.length = 0; pan = 0; sel = null; last = null; resetLine(); chips.innerHTML = ''; st.textContent = ''; hint.style.display = ''; draw(); } };
  }

  root.LogicInk = { Collect, loadModel, recognise, render, forward: (img, a) => forward(img, a), units, attach, _setModel: (m) => { M = m; } };
})(typeof window !== 'undefined' ? window : globalThis);
