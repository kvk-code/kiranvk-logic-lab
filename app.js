/* Logic Lab — page controller. The checker lives in logic-core.js + lab-session.js; this file only renders. */
(function () {
  'use strict';
  const L = window.LogicCore, X = window.LabExercises, LS = window.LabSession;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PKEY = 'logiclab.v1.progress', KKEY = 'logiclab.v1.nvkey';

  // ───────── persistence (raw inputs only; the session is rebuilt by replaying them through the checker)
  let progress = {}; try { progress = JSON.parse(localStorage.getItem(PKEY) || '{}'); } catch (e) { progress = {}; }
  const saveProgress = () => { try { localStorage.setItem(PKEY, JSON.stringify(progress)); } catch (e) { } };
  let nvKey = localStorage.getItem(KKEY) || '';
  // AI step explanations (key users): {exId: {lineNo: text}}, kept with the progress so a reload or the PDF keeps them
  const AKEY = 'logiclab.v1.aisteps';
  let aiSteps = {}; try { aiSteps = JSON.parse(localStorage.getItem(AKEY) || '{}'); } catch (e) { aiSteps = {}; }
  const aiBadge = {};
  const saveAi = () => { try { localStorage.setItem(AKEY, JSON.stringify(aiSteps)); } catch (e) { } };
  let autoExplain = localStorage.getItem('logiclab.v1.autoexplain') !== 'off';
  let keyState = nvKey ? 'unknown' : 'off';

  // ───────── "My board": the student's own statements (any mode). Stored in this browser only.
  const BKEY = 'logiclab.v1.boards';
  let boards = []; try { boards = JSON.parse(localStorage.getItem(BKEY) || '[]'); } catch (e) { boards = []; }
  const saveBoards = () => { try { localStorage.setItem(BKEY, JSON.stringify(boards)); } catch (e) { } };
  const MODES = { patterns: 'Derive', cnf: 'Convert to CNF', resolution: 'Prove by resolution', fc: 'Forward chaining', bc: 'Backward chaining' };
  function boardEx(b) {
    const base = { id: b.id, title: b.title || b.statements[0], level: 1, mode: b.mode, board: b };
    if (b.mode === 'patterns') return Object.assign(base, { premises: b.statements, goal: b.goal || null });
    if (b.mode === 'cnf') return Object.assign(base, { start: b.cnfPick === 'all' ? b.statements.map((x) => '(' + x + ')').join(' ∧ ') : b.statements[Number(b.cnfPick) || 0] });
    if (b.mode === 'resolution') {
      const kb = b.statements.map((x) => L.parse(x));
      const clauses = [...kb, L.Not(L.parse(b.goal))].flatMap((f) => L.cnfClauses(f)).map(L.clauseText);
      return Object.assign(base, { kb: b.statements, alpha: b.goal, given: false, clauses: [...new Set(clauses)] });
    }
    return Object.assign(base, { rules: b.statements, query: String(b.goal || '').replace(/[,_\s]/g, '') });
  }
  X.TRACKS.unshift({ id: 'mine', title: '✎ My board', blurb: 'Your own statements. Pick what to do with them; every line is still checked, and Unstuck still helps.' });
  X.mine = boards.map(boardEx);
  const curEx = () => (exIdx >= 0 ? X[track][exIdx] : null);
  const K = () => (track === 'mine' ? (curEx() ? curEx().mode : null) : track);

  const sessions = {};
  function getSession(track, ex) {
    if (sessions[ex.id]) return sessions[ex.id];
    const s = LS.create(track, ex);
    for (const inp of (progress[ex.id] && progress[ex.id].inputs) || []) s.add(JSON.parse(JSON.stringify(inp)));
    s.hintsUsed = (progress[ex.id] && progress[ex.id].hints) || 0;
    sessions[ex.id] = s; return s;
  }
  function record(ex, s, inp) {
    const p = progress[ex.id] || (progress[ex.id] = { inputs: [], hints: 0 });
    if (inp) p.inputs.push(inp); else p.inputs.pop();
    p.solved = s.solved || p.solved || false; p.hints = s.hintsUsed; p.t = Date.now();
    saveProgress();
  }

  // ───────── routing
  let track = 'patterns', exIdx = 0;
  const fromHash = () => { const m = /^#([a-z]+)\/([a-z0-9]+)$/.exec(location.hash); if (m && X[m[1]]) { track = m[1]; const i = X[m[1]].findIndex((e) => e.id === m[2]); exIdx = m[2] === 'new' ? -1 : track === 'mine' && i < 0 ? (X.mine.length ? 0 : -1) : Math.max(0, i); } };
  fromHash();
  window.addEventListener('hashchange', () => { fromHash(); hintLevel = 0; renderAll(); window.scrollTo(0, 0); });
  const go = (t, i) => { track = t; exIdx = t === 'mine' && !X.mine.length ? -1 : i; history.replaceState(null, '', '#' + t + '/' + (exIdx < 0 ? 'new' : X[t][exIdx].id)); hintLevel = 0; renderAll(); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  // ───────── tracks & pills
  function renderNav() {
    $('#tracks').innerHTML = X.TRACKS.map((t) => {
      const done = X[t.id].filter((e) => progress[e.id] && progress[e.id].solved).length;
      return `<button class="track${t.id === track ? ' on' : ''}" data-t="${t.id}">${esc(t.title)}<span class="n">${t.id === 'mine' ? X.mine.length || '' : done + '/' + X[t.id].length}</span></button>`;
    }).join('');
    $('#tracks').querySelectorAll('.track').forEach((b) => (b.onclick = () => go(b.dataset.t, 0)));
    $('#pills').innerHTML = X[track].map((e, i) => `<button class="pill${i === exIdx ? ' on' : ''}${progress[e.id] && progress[e.id].solved ? ' done' : ''}" data-i="${i}" title="${esc(e.title)}">${track === 'mine' ? `${i + 1} · ${({ patterns: 'Derive', cnf: 'CNF', resolution: 'Resolution', fc: 'FC', bc: 'BC' })[e.mode]}` : i + 1}<span class="lv">${track === 'mine' ? '' : '•'.repeat(e.level)}</span></button>`).join('')
      + (track === 'mine' ? `<button class="pill${exIdx < 0 ? ' on' : ''}" data-i="-1">+ New board</button>` : '');
    $('#pills').querySelectorAll('.pill').forEach((b) => (b.onclick = () => { editing = null; if (Number(b.dataset.i) < 0) { exIdx = -1; history.replaceState(null, '', '#mine/new'); hintLevel = 0; renderAll(); } else go(track, Number(b.dataset.i)); }));
    const on = $('#tracks .track.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    const tEl = $('.toast'); if (tEl) tEl.classList.add('hidden');
  }

  // ───────── exercise card
  const SHOW = (f) => { try { return f && f.t ? L.show(f) : esc(f); } catch (e) { return esc(f); } };
  const RULE_LABEL = (id) => (id === 'premise' ? 'premise' : id === 'start' ? 'start' : id === 'given' ? 'given' : id === 'clause' ? 'clause of KB ∧ ¬α' : id === 'resolve' ? 'resolution' : L.ruleName(id));
  function msgClass(l) { return l.ok ? (['wrongrule', 'detour', 'combined', 'equivalent'].includes(l.verdict) || l.taut || l.redundant ? 'warn' : 'ok') : 'bad'; }
  function lineHTML(l, n, s) {
    let body = '';
    if (K() === 'fc') body = l.ok ? `<span class="f">${esc(L.prettyName(l.head))}</span><span class="tag">fire rule ${esc(l.ruleNo)}</span>` : `<span class="f">${esc(l.head || '?')}</span><span class="tag">rule ${esc(l.ruleNo)}</span>`;
    else if (K() === 'bc') body = `<span class="f">${esc(L.prettyName(String(l.goal || '')))}</span><span class="tag">${l.ruleNo === 'fact' ? 'known fact' : l.ruleNo === 'proved' ? 'already proved' : 'rule ' + esc(l.ruleNo)}</span>`;
    else body = `<span class="f">${l.c ? esc(L.clauseText(l.c)) : SHOW(l.f)}</span>${l.rule ? `<span class="tag">${esc(RULE_LABEL(l.rule))}</span>` : ''}${l.cites && l.cites.length ? `<span class="tag from">from ${l.cites.join(', ')}</span>` : ''}`;
    let msg = '';
    if (!l.given && l.msg) {
      const cx = l.counter ? `<span class="cx">e.g. when ${Object.entries(l.counter).map(([k, v]) => `${L.prettyName(k)} = ${v ? 'T' : 'F'}`).join(', ')} the two lines differ</span>` : '';
      msg = `<div class="msg ${msgClass(l)}"><b class="src">Checker</b>${l.ok ? '✓ ' : '× '}${esc(l.msg)}${cx}</div>`;
    }
    const ex0 = curEx(); const aiH = !l.given && ex0 ? aiHTML(ex0, n) : '';
    return `<div class="stn ${l.given ? 'given' : l.ok ? 'ok' : 'bad'}" data-n="${n}"><div class="num">${n}</div><div class="row">${body}</div>${msg}${aiH}</div>`;
  }

  function aiHTML(ex, n) {
    const ai = aiSteps[ex.id] && aiSteps[ex.id][n]; if (!ai) return '';
    return `<div class="aiwhy${ai === '…' ? ' wait' : ''}" title="Tap to expand / collapse"><div class="t"><b class="src">AI tutor</b>${ai === '…' ? 'writing an explanation… (the logic engine checks it before it appears)' : esc(ai)}</div><span>${esc(BADGE[aiSteps[ex.id][n + '_st']] || BADGE.checked)}</span></div>`;
  }
  // update one line's AI box in place — never re-render the card, or the student loses what they are typing
  function paintAi(ex, n) {
    if (!curEx() || curEx().id !== ex.id) return;
    const st = document.querySelector(`#excard .stn[data-n="${n}"]`); if (!st) return;
    const old = st.querySelector('.aiwhy'); const html = aiHTML(ex, n);
    if (old) old.outerHTML = html || ''; else if (html) st.insertAdjacentHTML('beforeend', html);
    const nw = st.querySelector('.aiwhy'); if (nw) nw.onclick = () => nw.classList.toggle('open');
  }
  function renderCard() {
    if (track === 'mine' && exIdx < 0) return renderSetup();
    const t = X.TRACKS.find((x) => x.id === K()), ex = X[track][exIdx], s = getSession(K(), ex);
    const A = s.all();
    let head = track === 'mine'
      ? `<div class="ex-head"><div class="meta">My board · ${esc(MODES[K()])}</div><h1>${esc(ex.title)}</h1><div class="actions" style="margin-top:6px"><button class="btn" id="b-edit">Edit statements</button><button class="btn ghost" id="b-del">Delete board</button></div>`
      : `<div class="ex-head"><div class="meta">${esc(t.title)} · ${exIdx + 1} of ${X[track].length} · level ${'●'.repeat(ex.level)}${'○'.repeat(3 - ex.level)}</div><h1>${esc(ex.title)}</h1>`;
    if (ex.story) head += `<p class="story">${esc(ex.story)}</p>`;
    if (ex.note) head += `<p class="story">${esc(ex.note)}</p>`;
    head += `<p class="blurb">${esc(t.blurb)}</p>`;
    if (K() === 'patterns') head += s.goal ? `<div class="goalbox">Goal <span class="f">${SHOW(s.goal)}</span>${track === 'mine' ? ' <button class="btn ghost" id="b-follows" style="padding:2px 8px;font-size:13px">does it follow?</button>' : ''}</div>`
      : `<div class="goalbox">No goal: derive freely. Unstuck shows what follows next.</div>`;
    if (track === 'mine' && K() !== 'cnf') { let sat = true; try { sat = L.satisfiable(ex.board.statements.map((x) => L.parse(x))); } catch (e) { } if (!sat) head += `<div class="msg bad" style="margin-top:10px">⚠ Your statements contradict each other: no truth assignment makes all of them true. From a contradiction ANYTHING follows, so the derivation proves nothing useful. Check them.</div>`; }
    if (K() === 'cnf') head += `<div class="goalbox">Target: conjunctive normal form (a ∧ of clauses, each a ∨ of literals)</div>`;
    if (K() === 'resolution') head += `<div class="goalbox">KB: <span class="f">${ex.kb.map((k) => SHOW(L.parse(k))).join(' ; ')}</span> &nbsp; Prove α = <span class="f">${SHOW(s.alpha)}</span></div>`;
    if (K() === 'fc' || K() === 'bc') head += `<div class="goalbox">Query <span class="f">${esc(L.prettyName(ex.query))}</span></div>`;
    head += '</div>';

    let side = '';
    if (K() === 'fc' || K() === 'bc') {
      const fired = new Set(s.lines.filter((l) => l.ok && l.ruleNo && !isNaN(l.ruleNo)).map((l) => Number(l.ruleNo)));
      side += `<table class="kbtable">${s.rules.map((r, i) => `<tr class="${fired.has(i + 1) ? 'fired' : ''}"><td class="i">${i + 1}</td><td class="f">${esc(L.ruleText(r))}</td><td class="note">${r.body.length ? '' : 'fact'}</td></tr>`).join('')}</table>`;
      if (K() === 'fc') side += `<div class="knownset">Known: ${[...s.known()].map((k) => `<span class="k">${esc(L.prettyName(k))}</span>`).join('')}</div>`;
      if (K() === 'bc') side += `<div class="tree">${treeHTML(s.tree)}</div>`;
    }

    let legend = `<div class="legend"><span><i class="lg ck"></i>Checker — decides ✓/×, always right</span><span><i class="lg hn"></i>Unstuck — hints from the checker</span>${nvKey ? '<span><i class="lg ai"></i>AI tutor — explains, checked by the engine</span>' : '<span class="note">AI tutor off — <a href="#" id="lg-key">add a free key</a></span>'}</div>`;
    if (!localStorage.getItem('logiclab.v1.howto')) legend = `<div class="howto"><b>How it works</b><ol><li>Write the next line, pick the rule, and say which lines it comes from (e.g. <i>1,4</i>). Press <b>Check line</b>.</li><li>The <b>checker</b> marks it ✓ or × and says why — it is never wrong.</li><li>Stuck? <b>Unstuck</b> gives a nudge, then the rule, then the line. With your own free NVIDIA key, an <b>AI tutor</b> also explains every step in words.</li></ol><button class="btn" id="howto-ok">Got it</button></div>` + legend;
    let rail = '<div class="rail">';
    A.forEach((l, i) => { rail += lineHTML(l, i + 1, s); });
    if (s.solved) rail += `<div class="stn goal"><div class="num">✓</div><div class="row"><span class="f">${K() === 'resolution' ? '□' : K() === 'cnf' ? 'CNF' : esc(L.prettyName(K() === 'patterns' ? L.show(s.goal) : ex.query))}</span><span class="tag">reached</span></div></div>`;
    else rail += composerHTML(s, A.length + 1);
    rail += '</div>';

    let done = '';
    if (s.solved) {
      const nextI = track !== 'mine' && exIdx + 1 < X[track].length ? exIdx + 1 : null;
      done = `<div class="solved"><b>Solved.</b><span class="note">${s.lines.filter((l) => !l.ok).length} wrong attempt(s) · Unstuck used on ${s.hintsUsed} step(s)</span><span style="flex:1"></span>${nextI !== null ? `<button class="btn primary" id="nextex">Next exercise →</button>` : track === 'mine' ? '' : nextTrackBtn()}<button class="btn" id="export">Export PDF</button><button class="btn" id="restart">Try again</button></div>`;
    }
    $('#excard').innerHTML = head + side + legend + rail + (s.solved ? '' : `<div class="actions"><button class="btn primary" id="check">Check line</button><button class="btn" id="unstuck2">Unstuck</button><button class="btn" id="undo"${s.lines.length ? '' : ' disabled'}>Undo</button><button class="btn ghost" id="restart">Restart</button><button class="btn ghost" id="export">Export PDF</button></div><div class="hintline">Enter = check · symbols: ~ & | -> &lt;-&gt; also work</div>`) + done;
    wireComposer(s, ex);
  }
  function nextTrackBtn() { const i = X.TRACKS.findIndex((t) => t.id === track); const n = X.TRACKS[i + 1]; return n ? `<button class="btn primary" id="nexttrack" data-t="${n.id}">Next track: ${esc(n.title)} →</button>` : ''; }
  function treeHTML(n) {
    if (!n) return '';
    const how = n.how === 'fact' ? 'fact' : n.how === 'proved' ? 'proved earlier' : n.how !== null && n.how !== undefined ? 'rule ' + (n.how + 1) : 'open';
    return `<ul><li><span class="g ${n.closed ? 'closed' : n.kids === null ? 'open' : ''}">${esc(L.prettyName(n.sym))}</span><span class="how">${how}</span>${(n.kids || []).map(treeHTML).join('')}</li></ul>`;
  }

  // ───────── composer (one per track)
  const SYMS = ['¬', '∧', '∨', '⇒', '⇔', '(', ')', '⊥'];
  // ✍ handwriting pad (ink.js): recognised on the device, fills the line box live
  let inkOn = localStorage.getItem('logiclab.v1.ink') === '1';
  const symbar = () => `<div class="symbar">${SYMS.map((c) => `<button class="sym" data-s="${c}" type="button" tabindex="-1">${c}</button>`).join('')}<button class="sym ink-tog${inkOn ? ' on' : ''}" id="ink-tog" type="button" tabindex="-1" title="Write with your finger">✍ Write</button></div>${inkOn ? '<div class="inkpad" id="inkpad"></div>' : ''}`;
  function boardSymbols(s, ex) {
    const set = new Set(), add = (f) => { try { L.symbols(typeof f === 'string' ? L.parse(f) : f, set); } catch (e) { } };
    s.all().forEach((l) => l.f && typeof l.f === 'object' && add(l.f));
    [s.goal, s.alpha, ...(ex.kb || []), ...((ex.board && ex.board.statements) || []), ...(ex.premises || []), ex.start].filter(Boolean).forEach(add);
    return [...set];
  }
  let resMode = 'resolve';
  function composerHTML(s, n) {
    const ex = s.ex;
    let inner = '';
    if (K() === 'patterns') {
      inner = `<div class="inrow"><input class="fin" id="fin" placeholder="new sentence, e.g. ¬P1,2" autocomplete="off" spellcheck="false"></div>${symbar()}
        <div class="inrow"><select class="sel" id="rule">${LS.RULE_MENUS.patterns.map((r) => `<option value="${r}">${esc(L.ruleName(r))}</option>`).join('')}</select>
        <input class="cin" id="cites" placeholder="from: 2,5" inputmode="numeric" autocomplete="off"></div>`;
    } else if (K() === 'cnf') {
      inner = `<div class="inrow"><input class="fin" id="fin" autocomplete="off" spellcheck="false"></div>${symbar()}
        <div class="inrow"><select class="sel" id="rule">${LS.RULE_MENUS.cnf.map((r) => `<option value="${r}">${esc(L.RULES[r].name)}</option>`).join('')}</select><span class="note">The box starts with your last line — edit it with one law.</span></div>`;
    } else if (K() === 'resolution') {
      const need = !ex.given;
      inner = `${need ? `<div class="inrow" style="margin-bottom:8px"><span class="seg"><button type="button" data-m="clause" class="${resMode === 'clause' ? 'on' : ''}">Add a clause</button><button type="button" data-m="resolve" class="${resMode === 'resolve' ? 'on' : ''}">Resolve two</button></span></div>` : ''}
        ${resMode === 'resolve' || !need ? `<div class="inrow"><span class="note">resolve line</span><input class="cin" id="ca" inputmode="numeric" placeholder="i" style="width:60px"><span class="note">with line</span><input class="cin" id="cb" inputmode="numeric" placeholder="j" style="width:60px"></div>` : ''}
        <div class="inrow" style="margin-top:8px"><input class="fin" id="fin" placeholder="${resMode === 'clause' && need ? 'a clause of KB ∧ ¬α, e.g. ¬P ∨ Q' : 'the resolvent, e.g. Q ∨ R   (⊥ for the empty clause □)'}" autocomplete="off" spellcheck="false"></div>${symbar()}`;
    } else if (K() === 'fc') {
      inner = `<div class="inrow"><span class="note">fire rule</span><select class="sel" id="ruleno">${s.rules.map((r, i) => (r.body.length ? `<option value="${i + 1}">${i + 1}: ${esc(L.ruleText(r))}</option>` : '')).join('')}</select>
        <span class="note">⇒ infer</span><input class="fin" id="fin" placeholder="symbol" style="flex:0 1 140px" autocomplete="off" spellcheck="false"></div>`;
    } else if (K() === 'bc') {
      const open = s.openLeaves();
      inner = `<div class="inrow"><span class="note">goal</span><select class="sel" id="goal">${[...new Set(open.map((o) => o.sym))].map((g) => `<option value="${esc(g)}">${esc(L.prettyName(g))}</option>`).join('')}</select>
        <span class="note">←</span><select class="sel" id="ruleno"><option value="fact">known fact</option><option value="proved">already proved</option>${s.rules.map((r, i) => (r.body.length ? `<option value="${i + 1}">rule ${i + 1}: ${esc(L.ruleText(r))}</option>` : '')).join('')}</select></div>`;
    }
    return `<div class="stn composer"><div class="num">${n}</div><div style="padding-top:2px">${inner}</div></div>`;
  }
  function insertAtCaret(el, txt) {
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, a) + txt + el.value.slice(b); el.focus(); el.setSelectionRange(a + txt.length, a + txt.length);
  }
  function wireComposer(s, ex) {
    const fin = $('#fin');
    document.querySelectorAll('.sym[data-s]').forEach((b) => (b.onmousedown = (e) => { e.preventDefault(); if (fin) insertAtCaret(fin, b.dataset.s); }));
    const it = $('#ink-tog'); if (it) it.onclick = () => { inkOn = !inkOn; localStorage.setItem('logiclab.v1.ink', inkOn ? '1' : '0'); const v = fin ? fin.value : ''; renderCard(); if ($('#fin') && v) $('#fin').value = v; };
    const ip = $('#inkpad'); if (ip && fin && window.LogicInk) LogicInk.attach(ip, { input: fin, lexicon: () => boardSymbols(s, ex), onSubmit: () => submit(s, ex), replaceIf: (p) => !!fin.dataset.prefill && p === fin.dataset.prefill.trim(), context: () => ({ track, ex: ex.id, kind: K(), rule: $('#rule') ? $('#rule').value : null }) });
    if (K() === 'cnf' && fin && !fin.value) { const A = s.all(); const g = [...A].reverse().find((l) => l.ok); fin.value = fin.dataset.prefill = L.show(g.f); }
    if (K() === 'patterns' && $('#rule')) $('#rule').value = lastRule.patterns || 'mp';
    document.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => { resMode = b.dataset.m; renderCard(); }));
    if (K() === 'resolution' && !ex.given && !s.lines.some((l) => l.ok && l.rule === 'clause') && resMode === 'resolve' && !wiredOnce[ex.id]) { wiredOnce[ex.id] = 1; resMode = 'clause'; renderCard(); return; }
    const chk = $('#check'); if (chk) chk.onclick = () => submit(s, ex);
    const us2 = $('#unstuck2'); if (us2) us2.onclick = (e) => { e.stopPropagation(); openUnstuck(); };
    const und = $('#undo'); if (und) und.onclick = () => { const n = s.all().length; s.undo(); record(ex, s, null); if (aiSteps[ex.id]) { delete aiSteps[ex.id][n]; delete aiSteps[ex.id][n + '_st']; saveAi(); } hintLevel = 0; renderAll(); };
    const rs = $('#restart'); if (rs) rs.onclick = () => { if (s.lines.length && !confirm('Clear your lines for this exercise?')) return; delete sessions[ex.id]; delete progress[ex.id]; delete aiSteps[ex.id]; saveAi(); saveProgress(); hintLevel = 0; renderAll(); };
    const nx = $('#nextex'); if (nx) nx.onclick = () => go(track, exIdx + 1);
    const xb = $('#export'); if (xb) xb.onclick = () => openExport();
    const ho = $('#howto-ok'); if (ho) ho.onclick = () => { localStorage.setItem('logiclab.v1.howto', '1'); $('.howto').remove(); };
    const lk = $('#lg-key'); if (lk) lk.onclick = (e) => { e.preventDefault(); openModal(); };
    document.querySelectorAll('#excard .aiwhy').forEach((a) => (a.onclick = () => a.classList.toggle('open')));
    const be = $('#b-edit'); if (be) be.onclick = () => { editing = ex.board; exIdx = -1; renderAll(); };
    const bd = $('#b-del'); if (bd) bd.onclick = () => { if (!confirm('Delete this board and its lines?')) return; boards = boards.filter((b) => b.id !== ex.id); saveBoards(); X.mine = boards.map(boardEx); delete progress[ex.id]; delete sessions[ex.id]; saveProgress(); go('mine', 0); };
    const bf = $('#b-follows'); if (bf) bf.onclick = () => { const g = s.goalStatus(); toast(!g || g.unknown ? 'Too many symbols for a truth table.' : g.follows ? '✓ Yes — the goal follows from your statements (truth table). Now derive it.' : `× No — e.g. ${Object.entries(g.counter || {}).map(([k, v]) => `${L.prettyName(k)}=${v ? 'T' : 'F'}`).join(', ')} makes all statements true and the goal false.`, 6000); };
    const nt = $('#nexttrack'); if (nt) nt.onclick = () => go(nt.dataset.t, 0);
    document.querySelectorAll('#excard input').forEach((el) => (el.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(s, ex); } }));
    if (fin && matchMedia('(min-width: 901px)').matches) fin.focus();
  }
  const wiredOnce = {}; const lastRule = {};
  const parseCites = (str) => String(str || '').split(/[^0-9]+/).filter(Boolean).map(Number);
  function submit(s, ex) {
    let inp;
    let fv = $('#fin') ? $('#fin').value.trim() : '';
    if (fv && VJ1.test(fv)) { const w = fv.match(VJ1)[0]; $('#fin').value = fixV(fv); return toast(`“${w}” would be ONE symbol (capital V is a letter). I changed it to ${fixV(w)} — check and press Check line again.`); }
    if (K() === 'cnf' && fv && $('#fin').dataset.slip !== fv) {
      const g = [...s.all()].reverse().find((l) => l.ok), li = g ? lintLine(fv, g.f) : null;
      if (li && li.fixed && li.notes.length && li.f && (() => { try { return L.equivalent(li.f, g.f); } catch (e) { return false; } })()) { $('#fin').dataset.slip = li.fixed; $('#fin').value = li.fixed; return toast(li.notes[0] + ' I added the brackets — press Check line.'); }
    }
    if (K() === 'patterns') { if (!fv) return toast('Write the new sentence first.'); inp = { f: fv, rule: $('#rule').value, cites: parseCites($('#cites').value) }; lastRule.patterns = inp.rule; }
    else if (K() === 'cnf') { if (!fv) return toast('Write the next line.'); inp = { f: fv, rule: $('#rule').value }; }
    else if (K() === 'resolution') {
      const clauseMode = !ex.given && resMode === 'clause';
      if (!fv) return toast(clauseMode ? 'Write a clause.' : 'Write the resolvent (⊥ for □).');
      inp = clauseMode ? { f: fv.replace(/□/g, '⊥'), rule: 'clause' } : { f: fv.replace(/□/g, '⊥'), rule: 'resolve', cites: [Number($('#ca').value), Number($('#cb').value)].filter(Boolean) };
    } else if (K() === 'fc') { if (!fv) return toast('Which symbol does the rule infer?'); inp = { ruleNo: Number($('#ruleno').value), head: fv }; }
    else if (K() === 'bc') { inp = { goal: $('#goal').value, ruleNo: $('#ruleno').value === 'fact' || $('#ruleno').value === 'proved' ? $('#ruleno').value : Number($('#ruleno').value) }; }
    const saved = JSON.parse(JSON.stringify(inp));
    const r = s.add(inp);
    record(ex, s, saved);
    hintLevel = 0;
    renderAll();
    if (r.ok && s.solved) toast('🎯 Solved!');
    if (nvKey && autoExplain) explainLine(ex, s, s.all().length);
    return { ok: !!r.ok, msg: r.msg || '' };          // the ✍ pad files this verdict with the line's ink (training label)
  }
  async function explainLine(ex, s, n) {
    const m = aiSteps[ex.id] || (aiSteps[ex.id] = {}); m[n] = '…'; paintAi(ex, n);
    try {
      const j = await verifiedAI({ kind: 'step', line: n, context: s.context() }, s, { kind: 'step', line: n }, window.AIVerify.engineText(s, n));
      if (j.ok) { m[n] = j.text.replace(/^\s*(line\s*\d+\s*[:.-]\s*)/i, ''); m[n + '_st'] = j.status; } else { delete m[n]; if (j.reason === 'bad-key' || /rejected/.test(j.detail || '')) setKeyState('bad'); toast('AI explanation unavailable: ' + (j.detail || j.reason)); }
    } catch (e) { delete m[n]; }
    saveAi(); paintAi(ex, n);
  }

  // ───────── My board: setup form
  let editing = null, setupFocus = null;
  const EXAMPLES = [
    { t: 'Rain', st: ['Rain ⇒ Wet', 'Wet ⇒ Slippery', 'Rain'], g: 'Slippery', m: 'patterns' },
    { t: 'Wumpus [1,1]', st: ['B1,1 ⇔ (P1,2 ∨ P2,1)', '¬B1,1'], g: '¬P1,2', m: 'patterns' },
    { t: 'What follows?', st: ['P ⇒ Q', '¬Q ∨ R', '¬(R ∧ S)', 'P'], g: '', m: 'patterns' },
    { t: 'Exam CNF', st: ['(P ∨ Q) ⇒ (R ∧ S)'], g: '', m: 'cnf' },
    { t: 'Resolution', st: ['P ∨ Q', 'P ⇒ R', 'Q ⇒ R'], g: 'R', m: 'resolution' },
    { t: 'Chaining', st: ['A ∧ B ⇒ C', 'C ⇒ D', 'A', 'B'], g: 'D', m: 'fc' },
  ];
  let setupMode = 'patterns';
  function renderSetup() {
    const b = editing || {};
    if (editing) setupMode = editing.mode;
    $('#excard').innerHTML = `<div class="ex-head"><div class="meta">My board</div><h1>${editing ? 'Edit your statements' : 'Bring your own statements'}</h1>
      <p class="story">Type any propositional statements, one per line (2, 3, 6 … up to 12). Add a goal if you have one. Then choose what to do with them. Every line you write is still checked, and Unstuck still helps.</p></div>
      <div class="note" style="margin-top:12px">Try an example:</div><div class="symbar">${EXAMPLES.map((e, i) => `<button class="btn" data-ex="${i}" style="padding:5px 10px;font-size:13px">${esc(e.t)}</button>`).join('')}</div>
      <label class="note">Statements (one per line)</label>
      <textarea class="fin" id="b-stm" rows="6" style="width:100%;resize:vertical" spellcheck="false" placeholder="P ⇒ Q&#10;Q ⇒ R&#10;P">${esc((b.statements || []).join('\n'))}</textarea>
      ${symbar()}
      <div id="b-prev" class="note"></div>
      <div id="b-deriv"></div>
      <label class="note">Goal (optional for “Derive” and “CNF”, needed for the others)</label>
      <input class="fin" id="b-goal" style="width:100%" autocomplete="off" spellcheck="false" placeholder="e.g. R" value="${esc(b.goal || '')}">
      <label class="note" style="display:block;margin-top:12px">What do you want to do?</label>
      <div class="seg" id="b-mode" style="flex-wrap:wrap">${Object.entries(MODES).map(([k, v]) => `<button type="button" data-m="${k}" class="${k === setupMode ? 'on' : ''}">${esc(v)}</button>`).join('')}</div>
      <div id="b-cnf" class="inrow ${setupMode === 'cnf' ? '' : 'hidden'}" style="margin-top:10px"><span class="note">convert</span><select class="sel" id="b-pick"></select></div>
      <div id="b-err" class="msg bad hidden" style="margin-top:10px"></div>
      <div class="actions"><button class="btn primary" id="b-start">${editing ? 'Save & restart board' : 'Start my board'}</button>${editing ? '<button class="btn ghost" id="b-cancel">Cancel</button>' : ''}<button class="btn" id="b-unstuck">Stuck? Unstuck</button></div>
      <p class="note" style="margin-top:12px">Symbols: ¬ ∧ ∨ ⇒ ⇔ or ~ &amp; | -&gt; &lt;-&gt;. Names like P, Rain, B1,1. First-order statements (∀, ∃) are coming in the next version.</p>`;
    const stm = $('#b-stm'), goal = $('#b-goal');
    setupFocus = stm;
    [stm, goal].forEach((el) => el.addEventListener('focus', () => (setupFocus = el)));
    document.querySelectorAll('#excard .sym[data-s]').forEach((x) => (x.onmousedown = (e) => { e.preventDefault(); insertAtCaret(setupFocus, x.dataset.s); preview(); }));
    // ✍ pad on the setup screen: write one statement at a time, "Add" appends it (or sets the goal if the goal box is active)
    const it = $('#ink-tog'); if (it) it.onclick = () => { const sv = stm.value, gv = goal.value; inkOn = !inkOn; localStorage.setItem('logiclab.v1.ink', inkOn ? '1' : '0'); renderSetup(); $('#b-stm').value = sv; $('#b-goal').value = gv; preview(); };
    const ip = $('#inkpad');
    if (ip && window.LogicInk) {
      ip.insertAdjacentHTML('beforebegin', '<input class="fin" id="ink-line" style="width:100%;margin-bottom:6px" placeholder="your handwritten statement appears here" autocomplete="off" spellcheck="false">');
      const line = $('#ink-line'), host = document.createElement('div'); ip.appendChild(host);
      const syms = () => { const set = new Set(); stm.value.split('\n').concat(goal.value).forEach((x) => { try { if (x.trim()) L.symbols(L.parse(x), set); } catch (e) { } }); return [...set]; };
      const pad = LogicInk.attach(host, { input: line, lexicon: syms, submitLabel: '＋ Add', onSubmit: () => {
        const v = line.value.trim(); if (!v) return;
        if (setupFocus === goal) goal.value = v; else stm.value = (stm.value.trim() ? stm.value.replace(/\s+$/, '') + '\n' : '') + v;
        line.value = ''; pad.clear(); preview();
        return { ok: null };                            // a statement typed into My board: no checker verdict
      }, context: () => ({ track: 'mine', ex: 'setup', kind: setupMode, field: setupFocus === goal ? 'goal' : 'statement' }) });
    }
    document.querySelectorAll('[data-ex]').forEach((x) => (x.onclick = () => { const e = EXAMPLES[Number(x.dataset.ex)]; stm.value = e.st.join('\n'); goal.value = e.g; setupMode = e.m; document.querySelectorAll('#b-mode button').forEach((y) => y.classList.toggle('on', y.dataset.m === setupMode)); preview(); }));
    document.querySelectorAll('#b-mode button').forEach((x) => (x.onclick = () => { setupMode = x.dataset.m; document.querySelectorAll('#b-mode button').forEach((y) => y.classList.toggle('on', y === x)); preview(); }));
    stm.oninput = () => { if (hintLevel) { hintLevel = 0; renderMeter(); } preview(); }; goal.oninput = preview;
    $('#b-start').onclick = startBoard;
    $('#b-unstuck').onclick = (e) => { e.stopPropagation(); openUnstuck(); };
    const bc = $('#b-cancel'); if (bc) bc.onclick = () => { const id = editing.id; editing = null; exIdx = Math.max(0, X.mine.findIndex((e) => e.id === id)); renderAll(); };
    preview();
  }
  function readSetup() {
    const lines = $('#b-stm').value.split('\n').map((x) => x.trim()).filter(Boolean);
    const parsed = lines.map((x) => L.tryParse(x));
    return { lines, parsed, goal: $('#b-goal').value.trim() };
  }
  // ───────── traps the parser accepts silently: "BVC" (capital V = a letter, so ONE symbol) and unbracketed ⇒ chains
  const VJOIN = /\b[A-Z](?:V[A-Z])+\b/g, VJ1 = /\b[A-Z](?:V[A-Z])+\b/;
  const fixV = (src) => src.replace(VJOIN, (w) => w.split('V').join(' ∨ '));
  const ATOMIC = (g) => g.t === 'var' || g.t === 'const' || g.t === 'not';
  function fp(f) { // fully bracketed, so the student sees exactly how the line was read
    const w = (g) => (ATOMIC(g) ? fp(g) : '(' + fp(g) + ')');
    switch (f.t) {
      case 'var': case 'const': return L.show(f);
      case 'not': return '¬' + w(f.a);
      case 'and': return f.args.map(w).join(' ∧ ');
      case 'or': return f.args.map(w).join(' ∨ ');
      case 'imp': return w(f.l) + ' ⇒ ' + w(f.r);
      case 'iff': return w(f.l) + ' ⇔ ' + w(f.r);
    }
    return L.show(f);
  }
  const uni = (s) => s.replace(/<->|<=>/g, '⇔').replace(/->|=>/g, '⇒').replace(/[&^]/g, '∧').replace(/\|/g, '∨').replace(/[~!]/g, '¬');
  function topOps(s) { // connectives outside every bracket, with their positions
    const out = []; let d = 0;
    for (let i = 0; i < s.length; i++) { const c = s[i]; if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--; else if (d === 0 && '∧∨⇒⇔→↔'.includes(c)) out.push({ c: c === '→' ? '⇒' : c === '↔' ? '⇔' : c, i }); }
    return out;
  }
  // → { notes: [text], fixed: suggested text or null, f: formula after the fixes (or the original) }
  // ref (optional): the line this one should be equivalent to — then an ∧/∨ bracket slip is flagged only when the
  // regrouped reading matches ref and the literal reading does not (no noise on ordinary premises).
  function lintLine(raw, ref) {
    const notes = []; let txt = raw;
    const vj = raw.match(VJOIN);
    if (vj) { txt = fixV(raw); notes.push(`“${vj[0]}” is read as ONE symbol named ${vj[0]} — a capital V is a letter, not “or”. Use the ∨ button (or type | ).`); }
    const p = L.tryParse(txt); if (!p.ok) return { notes, fixed: txt !== raw ? txt : null, f: null };
    const u = uni(txt), ops = topOps(u), kinds = new Set(ops.map((o) => o.c));
    const arrows = ops.filter((o) => o.c === '⇒' || o.c === '⇔').length;
    const eqv = (a, b) => { try { return L.equivalent(a, b); } catch (e) { return null; } };
    const regroup = (cut) => { const parts = []; let last = 0;
      ops.filter((o) => o.c === cut).forEach((o) => { parts.push(u.slice(last, o.i)); last = o.i + 1; }); parts.push(u.slice(last));
      const cand = parts.map((x) => x.trim()).map((x) => (topOps(x).length ? '(' + x + ')' : x)).join(` ${cut} `);
      const q = L.tryParse(cand); return q.ok && !L.same(q.f, p.f) ? { txt: cand, f: q.f } : null; };
    if (!arrows && kinds.has('∧') && kinds.has('∨') && ref) {
      const alt = regroup('∧');
      if (alt && eqv(alt.f, ref) && eqv(p.f, ref) === false) { notes.push(`Read as: ${fp(p.f)}, because ∧ binds tighter than ∨. You probably meant ${fp(alt.f)}, which is equivalent to the line you are rewriting. Add the brackets.`); return { notes, fixed: alt.txt, f: alt.f }; }
    }
    if (arrows && ops.length > 1 && (kinds.size > 1 || arrows > 1)) {
      let alt = null;
      if (kinds.has('∧') || kinds.has('∨')) { // regroup around the outermost ∧ (else ∨): “X ⇒ Y ∧ Z ⇒ W” → “(X ⇒ Y) ∧ (Z ⇒ W)”
        const cut = kinds.has('∧') ? '∧' : '∨'; const parts = []; let last = 0;
        ops.filter((o) => o.c === cut).forEach((o) => { parts.push(u.slice(last, o.i)); last = o.i + 1; }); parts.push(u.slice(last));
        const cand = parts.map((x) => x.trim()).map((x) => (topOps(x).length ? '(' + x + ')' : x)).join(` ${cut} `);
        const q = L.tryParse(cand); if (q.ok && !L.same(q.f, p.f)) alt = { txt: cand, f: q.f };
      }
      notes.push(`${vj ? 'Also, even with ∨ there, the line is read' : 'Read'} as: ${fp(p.f)}. ∧ binds tighter than ⇒ (order: ¬, ∧, ∨, ⇒, ⇔; ⇒ groups to the right).` + (alt ? ` Did you mean ${fp(alt.f)}? Add the brackets.` : ' Add brackets if you meant something else.'));
      if (alt) { txt = alt.txt; let vt = false; try { vt = L.valid(p.f); } catch (e) { } if (vt) notes[notes.length - 1] += ' (As written, the line is always true — a sure sign of a bracket slip.)'; return { notes, fixed: txt, f: alt.f }; }
    }
    return { notes, fixed: txt !== raw ? txt : null, f: p.f };
  }
  // Are lines 2… a step-by-step rewrite of line 1 (student is deriving inside the statements box)?
  function setupDerivation(lines, parsed) {
    if (lines.length < 2 || !parsed[0].ok) return null;
    const l0 = lintLine(lines[0]), f0 = l0.f || parsed[0].f; if (!f0) return null;
    const lint = [l0, ...lines.slice(1).map((x) => lintLine(x, f0))];
    const rows = lint.slice(1).map((li, k) => { let eq = null, cx = null; if (li.f) { try { eq = L.equivalent(f0, li.f); if (!eq) cx = L.counterexample(f0, li.f); } catch (e) { eq = null; } } return { i: k + 1, f: li.f, eq, cx }; });
    const good = rows.filter((r) => r.eq).length;
    if (!good || good < (lines.length - 1) / 2) return null;
    return { f0, lint, rows, last: [...rows].reverse().find((r) => r.eq) };
  }
  function preview() {
    const { lines, parsed, goal } = readSetup();
    const dv = setupDerivation(lines, parsed);
    const ref = lines.length > 1 && parsed[0].ok ? lintLine(lines[0]).f || parsed[0].f : null;
    const lintAt = (x, i) => (i > 0 && ref ? lintLine(x, ref) : lintLine(x));
    $('#b-prev').innerHTML = lines.map((x, i) => {
      if (!parsed[i].ok) { const li = lintAt(x, i); return `<div style="color:var(--brick2)">× (${i + 1}) ${esc(parsed[i].error)}</div>` + (li.fixed && L.tryParse(li.fixed).ok ? `<div class="msg warn" style="margin:4px 0">${esc(li.notes.join(' '))} <button class="btn" data-fix="${i}" style="padding:2px 8px;font-size:13px">Fix: ${esc(li.fixed)}</button></div>` : ''); }
      const li = lintAt(x, i), r = dv && i > 0 ? dv.rows[i - 1] : null;
      const eqTag = r ? (r.eq ? ` <span class="tag" style="color:var(--moss,#3d6b35)">≡ statement 1 ✓${li.fixed ? ' once fixed' : ''}</span>` : r.eq === false ? ` <span class="tag" style="color:var(--brick2)">≢ statement 1${r.cx ? ' (differs when ' + esc(Object.entries(r.cx).map(([k, v]) => `${L.prettyName(k)}=${v ? 'T' : 'F'}`).join(', ')) + ')' : ''}</span>` : '') : '';
      return `<div>✓ (${i + 1}) <span class="f" style="font-family:var(--math)">${esc(L.show(parsed[i].f))}</span>${eqTag}</div>` + (li.notes.length ? `<div class="msg warn" style="margin:4px 0 8px">⚠ ${esc(li.notes.join(' '))}${li.fixed ? ` <button class="btn" data-fix="${i}" style="padding:2px 8px;font-size:13px">Fix: ${esc(li.fixed)}</button>` : ''}</div>` : '');
    }).join('');
    $('#b-prev').querySelectorAll('[data-fix]').forEach((b) => (b.onclick = () => { const st = $('#b-stm'); const all = st.value.split('\n'); let k = -1; const idx = all.findIndex((x) => x.trim() && ++k === Number(b.dataset.fix)); if (idx < 0) return; all[idx] = lintAt(all[idx].trim(), Number(b.dataset.fix)).fixed; st.value = all.join('\n'); hintLevel = 0; renderMeter(); preview(); }));
    $('#b-deriv').innerHTML = dv ? `<div class="hintcard" style="background:var(--paper2);border-left:3px solid var(--ink)"><b>You are rewriting statement 1 step by step.</b> This box only holds your <i>starting</i> statements, so here each line is only checked for typos. On the board, every step gets a ✓ or × with the law it uses, and you get Unstuck hints${nvKey ? ' and AI explanations' : ''}.<div class="actions" style="margin-top:8px"><button class="btn primary" id="b-tocnf">Continue as a CNF board with my lines →</button><button class="btn ghost" id="b-hintnow">Hint for my next step</button></div></div>` : '';
    const tc = $('#b-tocnf'); if (tc) tc.onclick = () => continueAsCnf(lines, dv);
    const hn = $('#b-hintnow'); if (hn) hn.onclick = (e) => { e.stopPropagation(); openUnstuck(); };
    $('#b-cnf').classList.toggle('hidden', setupMode !== 'cnf');
    if (setupMode === 'cnf') { const cur = $('#b-pick').value; $('#b-pick').innerHTML = lines.map((x, i) => `<option value="${i}">statement ${i + 1}</option>`).join('') + (lines.length > 1 ? '<option value="all">all of them together (∧)</option>' : ''); if (cur) $('#b-pick').value = cur; }
  }
  function startBoard() {
    const { lines, parsed, goal } = readSetup(); const err = (m) => { $('#b-err').textContent = m; $('#b-err').classList.remove('hidden'); };
    if (!lines.length) return err('Type at least one statement.');
    if (lines.length > 12) return err('Up to 12 statements per board.');
    const bad = parsed.findIndex((p) => !p.ok); if (bad >= 0) return err(`Statement ${bad + 1}: ${parsed[bad].error}`);
    const vj = lines.findIndex((x) => VJ1.test(x));
    if (vj >= 0) return err(`Statement ${vj + 1}: ${lintLine(lines[vj]).notes[0]} Tap “Fix” above.`);
    let g = null; if (goal) { const gp = L.tryParse(goal); if (!gp.ok) return err('Goal: ' + gp.error); g = gp.f; }
    const syms = new Set(); parsed.forEach((p) => L.symbols(p.f, syms)); if (g) L.symbols(g, syms);
    if (syms.size > 14) return err(`That uses ${syms.size} different symbols — the checker's truth tables allow up to 14. Split it into smaller boards.`);
    if ((setupMode === 'resolution' || setupMode === 'fc' || setupMode === 'bc') && !goal) return err(`${MODES[setupMode]} needs a goal (what you want to prove).`);
    if (setupMode === 'fc' || setupMode === 'bc') {
      for (let i = 0; i < lines.length; i++) { try { L.parseDefinite(lines[i]); } catch (e) { return err(`Statement ${i + 1} is not a definite clause. Chaining needs facts (P) or rules like A ∧ B ⇒ C (one positive conclusion).`); } }
      if (g.t !== 'var') return err('For chaining, the goal must be a single symbol (the query), e.g. D.');
    }
    const b = { id: editing ? editing.id : 'b' + Date.now().toString(36), title: lines.length === 1 ? lines[0] : lines.slice(0, 2).join(' ; ') + (lines.length > 2 ? ' …' : ''), statements: lines, goal: goal || '', mode: setupMode, cnfPick: setupMode === 'cnf' ? $('#b-pick').value || '0' : null };
    if (editing) { boards = boards.map((x) => (x.id === b.id ? b : x)); delete sessions[b.id]; delete progress[b.id]; saveProgress(); editing = null; } else boards.push(b);
    saveBoards(); X.mine = boards.map(boardEx);
    go('mine', X.mine.findIndex((e) => e.id === b.id));
  }

  // Move a derivation typed into the statements box onto a real CNF board: statement 1 is the start, the student's
  // equivalent lines are replayed through the checker (with the law the checker recognises), so nothing is retyped.
  function continueAsCnf(lines, dv) {
    const b = { id: 'b' + Date.now().toString(36), title: lines[0], statements: [lines[0]], goal: '', mode: 'cnf', cnfPick: '0' };
    const inputs = []; let prev = L.flat(dv.f0);
    for (const r of dv.rows) {
      if (!r.eq || !r.f || L.same(prev, r.f)) continue;
      let d = null; try { d = L.diagnoseRewrite(prev, r.f, null, { track: 'cnf' }); } catch (e) { }
      const rule = (d && (d.rule || (d.rules && d.rules[0]))) || L.cnfNextRule(prev) || 'simplify';
      inputs.push({ f: L.show(r.f), rule }); prev = L.flat(r.f);
    }
    boards.push(b); saveBoards(); X.mine = boards.map(boardEx);
    progress[b.id] = { inputs, hints: 0, t: Date.now() }; saveProgress();
    editing = null; go('mine', X.mine.findIndex((e) => e.id === b.id));
    toast(inputs.length ? `Moved to a CNF board: your ${inputs.length} step(s) were checked. Carry on below.` : 'CNF board started. Write your first step below.');
  }
  // Unstuck on the setup screen: fix input traps first, then hint the next CNF step of whatever the student is converting.
  function setupHint(level) {
    const { lines, parsed } = readSetup();
    if (!lines.length) return { level, text: 'Type your starting statements, one per line (or tap an example). Then pick what to do with them and press “Start my board”.' };
    const bad = parsed.findIndex((p) => !p.ok); if (bad >= 0) return { level, text: `Statement ${bad + 1} can’t be read yet: ${parsed[bad].error}` };
    const r0 = parsed[0].ok ? lintLine(lines[0]).f || parsed[0].f : null;
    const lt = lines.map((x, i) => (i && r0 ? lintLine(x, r0) : lintLine(x))), tr = lt.findIndex((l) => l.notes.length);
    if (tr >= 0 && level === 1) return { level, text: `Before the logic — line ${tr + 1}: ${lt[tr].notes.join(' ')}${lt[tr].fixed ? ' Tap “Fix” under it.' : ''}` };
    const dv = setupDerivation(lines, parsed);
    let f = null, from = '';
    if (dv) { f = dv.last.f; from = `line ${dv.last.i + 1}`; }
    else if (setupMode === 'cnf') { const k = Number($('#b-pick').value) || 0; f = $('#b-pick').value === 'all' ? L.parse(lines.map((x) => '(' + x + ')').join(' ∧ ')) : lt[k].f || parsed[k].f; from = $('#b-pick').value === 'all' ? 'your statements' : `statement ${k + 1}`; }
    if (!f) return { level, text: `This screen only sets up your statements. Choose what to do — ${Object.values(MODES).join(' / ')} — and press “Start my board”. On the board, Unstuck gives a nudge, then the rule, then the next line.` };
    const n = L.cnfNextLine(f);
    if (!n) return { level, text: L.isCNF(f) ? `${from[0].toUpperCase() + from.slice(1)} is already in CNF 🎯 (a ∧ of clauses, each a ∨ of literals).` : 'No CNF law applies here any more.' };
    const R = L.RULES[n.rule], tail = dv ? ' Tip: “Continue as a CNF board” checks every step for you.' : '';
    if (level === 1) return { level, text: `To reach CNF: remove ⇔, then ⇒, push ¬ inwards, then distribute ∨ over ∧. In ${from}, the first of these still left to do is ${R.name.toLowerCase()}.${tail}` };
    if (level === 2) return { level, text: `Use ${R.name} on ${from}:  ${R.law}${tail}` };
    return { level, text: L.show(n.f), line: { f: n.f, rule: n.rule, toSetup: true } };
  }
  function openUnstuck() { // inline Unstuck buttons: run the side-panel Unstuck and bring the panel up on phones
    $('#unstuck').click();
    if (matchMedia('(max-width: 900px)').matches) setSheet(true);
    else $('#hint').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ───────── Unstuck
  let hintLevel = 0;
  function renderHint(h) {
    if (!h) { $('#hint').innerHTML = ''; return; }
    const isLine = h.level === 3 && h.line;
    $('#hint').innerHTML = `<div class="hintcard"><div class="lvl">from the checker · level ${h.level} · ${['', 'nudge', 'which rule', 'next line'][h.level]}</div><div class="${isLine ? 'f' : ''}">${esc(h.text)}</div>${isLine ? `<div class="use"><button class="btn" id="usehint">${h.line.toSetup ? 'Add it as my next line' : 'Put it in my answer box'}</button></div>` : ''}${h.level < 3 ? '<div class="note" style="margin-top:6px">Still stuck? Tap Unstuck again.</div>' : ''}</div>`;
    if (h.moves && h.moves.length && h.level >= 2) {
      $('#hint .hintcard').insertAdjacentHTML('beforeend', `<div class="moves">${h.moves.map((m, i) => `<div class="mv"><span class="f">${esc(L.show(m.f))}</span> <span class="tag">${esc(L.ruleName(m.rule))}</span> <span class="tag from">from ${m.cites.join(', ')}</span> <button class="btn" data-mv="${i}" style="padding:3px 10px;font-size:13px">use</button></div>`).join('')}</div>`);
      document.querySelectorAll('[data-mv]').forEach((b) => (b.onclick = () => useHint(h.moves[Number(b.dataset.mv)])));
      const u0 = $('#usehint'); if (u0) u0.closest('.use').remove();
    }
    const u = $('#usehint'); if (u) u.onclick = () => useHint(h.line);
  }
  function useHint(n) {
    if (n.toSetup) { const st = $('#b-stm'); st.value = st.value.replace(/\s*$/, '') + '\n' + L.show(n.f); hintLevel = 0; renderMeter(); renderHint(null); preview(); closeSheet(); return toast(`Added (${L.RULES[n.rule].name}). Try the next step yourself.`); }
    const fin = $('#fin');
    if (K() === 'patterns') { fin.value = L.show(n.f); $('#rule').value = n.rule; $('#cites').value = n.cites.join(','); }
    else if (K() === 'cnf') { fin.value = L.show(n.f); $('#rule').value = n.rule; }
    else if (K() === 'resolution') {
      if (n.setup) { resMode = 'clause'; renderCard(); $('#fin').value = L.show(n.f); }
      else { if (resMode !== 'resolve') { resMode = 'resolve'; renderCard(); } $('#ca').value = n.cites[0]; $('#cb').value = n.cites[1]; $('#fin').value = n.f.t === 'const' ? '⊥' : L.show(n.f); }
    } else if (K() === 'fc') { $('#ruleno').value = String(n.ruleNo); fin.value = L.prettyName(n.head); }
    else if (K() === 'bc') { $('#goal').value = n.goal; $('#ruleno').value = String(n.ruleNo); }
    closeSheet(); toast('Filled in — press Check line.');
  }
  $('#unstuck').onclick = () => {
    if (track === 'mine' && exIdx < 0) { hintLevel = Math.min(3, hintLevel + 1); renderMeter(); return renderHint(setupHint(hintLevel)); }
    const ex = X[track][exIdx], s = getSession(K(), ex);
    hintLevel = Math.min(3, hintLevel + 1);
    const h = s.hint(hintLevel);
    const pr = progress[ex.id] || (progress[ex.id] = { inputs: [], hints: 0 }); pr.hints = s.hintsUsed; saveProgress();
    renderMeter(); renderHint(h);
  };
  function renderMeter() { $('#meter').innerHTML = [1, 2, 3].map((i) => `<i class="${i <= hintLevel ? 'on' : ''}"></i>`).join(''); }

  // ───────── AI tutor (student's own NVIDIA key, relayed by ai.php)
  const threads = {};
  async function callAI(payload) {
    const r = await fetch('ai.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ user_key: nvKey }, payload)) });
    return r.json();
  }
  // AI text is shown only after the logic engine has checked it (Wumpus-tutor pattern): up to 2 rewrites with the
  // engine's findings fed back; if it still contradicts the engine, the engine's own text is used instead.
  async function verifiedAI(payload, s, vopts, fallback) {
    let j = await callAI(payload);
    if (!j.ok) return j;
    let text = j.text, rounds = 0, issues = window.AIVerify.verify(text, s, vopts).issues;
    while (issues.length && rounds < 2) {
      rounds++;
      const r = await callAI(Object.assign({}, payload, { repair: { draft: text, issues } }));
      if (!r.ok) break;
      text = r.text; issues = window.AIVerify.verify(text, s, vopts).issues;
    }
    if (issues.length) return { ok: true, text: fallback || text, status: fallback ? 'fallback' : 'unchecked', issues };
    return { ok: true, text, status: rounds ? 'revised' : 'checked' };
  }
  const BADGE = { checked: '✓ checked by the logic engine', revised: '✓ checked by the logic engine · revised', fallback: 'logic engine’s explanation (the AI draft contradicted the checker)', unchecked: '⚠ the logic engine could not confirm everything in this answer' };
  function renderThread() {
    const ex = curEx(); if (!ex) { $('#thread').innerHTML = ''; return; } const t = threads[ex.id] || [];
    $('#thread').innerHTML = t.map((m) => (m.q ? `<div class="q">${esc(m.q)}</div>` : `<div class="a">${esc(m.a)}<span class="by">${esc(m.by || '')}</span></div>`)).join('');
    $('#thread').scrollTop = 1e6;
  }
  async function askAI(kind, q) {
    if (!nvKey) return openModal();
    if (!curEx()) return toast('Start your board first.');
    const ex = X[track][exIdx], s = getSession(K(), ex);
    const t = threads[ex.id] || (threads[ex.id] = []);
    if (kind === 'ask') t.push({ q }); else t.push({ q: 'Explain the next step' });
    t.push({ a: '…thinking', by: '' }); renderThread();
    try {
      const prev = t.slice(0, -2).slice(-6).map((m) => (m.q ? 'Student: ' + m.q : 'Tutor: ' + m.a)).join('\n');
      const ctx = Object.assign(s.context(), prev ? { earlier_conversation: prev } : {});
      if (kind === 'explain') { // give the AI the law, not the finished line, so it cannot hand the answer over
        const n = s.nextStep();
        ctx.checker_next_step = !n ? null : n.rule && (L.RULES[n.rule] || L.INFER[n.rule]) ? `apply ${L.ruleName(n.rule)}${n.cites ? ' to line(s) ' + n.cites.join(', ') : ''}`
          : n.rule === 'resolve' ? `resolve lines ${n.cites.join(' and ')} on ${L.prettyName(n.on)}` : n.rule === 'clause' ? 'add the next clause of KB ∧ ¬α' : n.ruleNo ? `use rule ${n.ruleNo}` : null;
      }
      const nx = s.nextStep();
      const j = await verifiedAI({ kind, context: ctx, question: q }, s, { kind }, kind === 'explain' && nx ? (nx.rule && (L.RULES[nx.rule] || L.INFER[nx.rule]) ? `Next, use ${L.ruleName(nx.rule)}: ${(L.RULES[nx.rule] || L.INFER[nx.rule]).law}.` : 'Tap Unstuck for the next step.') : null);
      t.pop();
      if (j.ok) { t.push({ a: j.text, by: 'AI tutor · ' + BADGE[j.status] }); setKeyState('on'); }
      else { t.push({ a: j.detail || j.reason || 'The AI tutor did not answer.', by: 'error' }); if (j.reason === 'bad-key' || /rejected/.test(j.detail || '')) setKeyState('bad'); }
    } catch (e) { t.pop(); t.push({ a: 'Network problem — try again.', by: 'error' }); }
    renderThread();
  }
  $('#ask-go').onclick = () => { const q = $('#ask-q').value.trim(); if (!q) return; $('#ask-q').value = ''; askAI('ask', q); };
  $('#ask-q').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#ask-go').click(); } };
  $('#explain-go').onclick = () => askAI('explain', '');
  $('#ask-setup').onclick = (e) => { e.preventDefault(); openModal(); };

  function setKeyState(st) {
    keyState = st;
    const c = $('#ai-chip'); c.classList.toggle('on', st === 'on' || st === 'unknown'); c.classList.toggle('bad', st === 'bad');
    $('#ai-chip-t').textContent = st === 'off' ? 'AI tutor: off' : st === 'bad' ? 'AI tutor: key problem' : 'AI tutor: on';
    $('#ask-on').classList.toggle('hidden', !nvKey); $('#ask-off').classList.toggle('hidden', !!nvKey);
  }
  function openModal() { $('#modal').classList.remove('hidden'); $('#key').value = nvKey; $('#key-st').textContent = ''; }
  $('#ai-chip').onclick = openModal;
  $('#key-close').onclick = () => $('#modal').classList.add('hidden');
  $('#auto-ex').checked = autoExplain;
  $('#auto-ex').onchange = () => { autoExplain = $('#auto-ex').checked; localStorage.setItem('logiclab.v1.autoexplain', autoExplain ? 'on' : 'off'); };
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); };
  $('#key-clear').onclick = () => { nvKey = ''; localStorage.removeItem(KKEY); setKeyState('off'); $('#key').value = ''; $('#key-st').textContent = 'Key removed from this browser.'; };
  $('#key-save').onclick = async () => {
    const k = $('#key').value.trim();
    if (!/^nvapi-[A-Za-z0-9_\-]{20,}$/.test(k)) { $('#key-st').textContent = 'That does not look like an NVIDIA key (it starts with nvapi-).'; return; }
    $('#key-st').textContent = 'Testing…';
    try {
      const r = await fetch('ai.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test_key: k }) });
      const j = await r.json();
      if (j.ok) { nvKey = k; localStorage.setItem(KKEY, k); setKeyState('on'); $('#key-st').textContent = `✓ Works (${(j.ms / 1000).toFixed(1)} s). The Ask box is on.`; setTimeout(() => $('#modal').classList.add('hidden'), 900); }
      else $('#key-st').textContent = '× ' + (j.detail || j.reason);
    } catch (e) { $('#key-st').textContent = 'Network problem — try again.'; }
  };

  // ───────── export: a clean, printable study sheet (browser print → Save as PDF; symbols stay real text)
  function openExport() {
    const ex = curEx(); if (!ex) return;
    $('#x-ai').disabled = !nvKey; $('#x-ai').checked = !!nvKey;
    $('#x-ai-note').textContent = nvKey ? '' : '(needs your NVIDIA key — ⚙ AI tutor)';
    const t = threads[ex.id] || []; $('#x-qa').disabled = !t.length; $('#x-qa').checked = !!t.length;
    $('#x-st').textContent = ''; $('#xmodal').classList.remove('hidden');
  }
  $('#x-close').onclick = () => $('#xmodal').classList.add('hidden');
  $('#xmodal').onclick = (e) => { if (e.target.id === 'xmodal') $('#xmodal').classList.add('hidden'); };
  const LAW = (r) => (L.INFER[r] ? L.INFER[r].law : L.RULES[r] ? L.RULES[r].law : '');
  function justification(k, l, s) {
    if (l.given) return { what: k === 'cnf' ? 'starting sentence' : k === 'resolution' ? 'given clause' : 'premise (given)', law: '' };
    if (k === 'patterns' || k === 'cnf') return { what: `${L.ruleName(l.rule)}${l.cites && l.cites.length ? ' — from line' + (l.cites.length > 1 ? 's ' : ' ') + l.cites.join(', ') : ''}`, law: LAW(l.rule) };
    if (k === 'resolution') return l.rule === 'clause' ? { what: 'clause of KB ∧ ¬α (from converting a statement to CNF)', law: '' } : { what: `Resolution of lines ${(l.cites || []).join(' and ')}`, law: 'α ∨ β, ¬β ∨ γ ⊢ α ∨ γ  (remove exactly one complementary pair)' };
    if (k === 'fc') { const r = s.rules[Number(l.ruleNo) - 1]; return { what: `Rule ${l.ruleNo} fires${r ? ' (' + L.ruleText(r) + ')' : ''}`, law: 'Forward chaining: when every premise of a rule is known, add its conclusion' }; }
    if (k === 'bc') { if (l.ruleNo === 'fact') return { what: 'known fact — goal closed', law: '' }; if (l.ruleNo === 'proved') return { what: 'already proved earlier — reused', law: '' }; const r = s.rules[Number(l.ruleNo) - 1]; return { what: `Goal reduced by rule ${l.ruleNo}${r ? ' (' + L.ruleText(r) + ')' : ''}`, law: 'Backward chaining: to prove a goal, prove every premise of a rule that concludes it' }; }
    return { what: '', law: '' };
  }
  function parseNotes(txt) {
    const out = { summary: '', steps: {}, mistake: '' };
    String(txt || '').split('\n').forEach((ln) => {
      let m;
      if ((m = /^\s*SUMMARY:\s*(.+)/i.exec(ln))) out.summary = m[1];
      else if ((m = /^\s*STEP\s*(\d+)\s*:\s*(.+)/i.exec(ln))) out.steps[Number(m[1])] = m[2];
      else if ((m = /^\s*MISTAKE:\s*(.+)/i.exec(ln))) out.mistake = m[1];
      else if (out.summary && !Object.keys(out.steps).length && ln.trim()) out.summary += ' ' + ln.trim();
    });
    return out;
  }
  $('#x-go').onclick = async () => {
    const ex = curEx(), k = K(), s = getSession(k, ex);
    const opt = { wrong: $('#x-wrong').checked, ai: $('#x-ai').checked && !!nvKey, qa: $('#x-qa').checked };
    let notes = null;
    if (opt.ai) {
      $('#x-st').textContent = 'Writing AI study notes… (a few seconds)';
      try { const j = await verifiedAI({ kind: 'notes', context: s.context() }, s, { kind: 'notes' }, null); if (j.ok && j.status !== 'unchecked') notes = parseNotes(j.text); else if (j.ok) $('#x-st').textContent = 'The AI notes contradicted the checker even after 2 rewrites — exporting without them.'; else $('#x-st').textContent = 'AI notes failed (' + (j.detail || j.reason) + ') — exporting without them.'; }
      catch (e) { $('#x-st').textContent = 'AI notes failed (network) — exporting without them.'; }
    }
    try { $('#print').innerHTML = printHTML(ex, k, s, opt, notes); }
    catch (e) { console.error('export failed', e); $('#x-st').textContent = 'Export failed: ' + e.message; return; }
    $('#xmodal').classList.add('hidden');
    const old = document.title; document.title = 'Logic Lab - ' + String(ex.title).replace(/[^\w ,;∧∨¬⇒⇔-]+/g, ' ').slice(0, 60);
    setTimeout(() => { window.print(); document.title = old; }, 350);
  };
  function printHTML(ex, k, s, opt, notes) {
    const A = s.all(), t = X.TRACKS.find((x) => x.id === k);
    const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    let h = `<div class="ph"><b>Logic Lab</b><span>PECST522 Artificial Intelligence · Module 3 · ${esc(date)}</span></div>`;
    h += `<h1>${esc(ex.title)}</h1><div class="sub">${track === 'mine' ? 'My board' : esc(t.title)} · ${esc(MODES[k] || t.title)}</div>`;
    if (ex.story) h += `<p>${esc(ex.story)}</p>`;
    if (k === 'patterns') h += `<div class="box"><div class="k">Given</div>${ex.premises.map((p, i) => `<div>(${i + 1}) <span class="fm">${esc(L.show(L.parse(p)))}</span></div>`).join('')}<div class="k" style="margin-top:6px">Goal</div>${s.goal ? `<span class="fm">${esc(L.show(s.goal))}</span>` : 'none — free derivation'}</div>`;
    if (k === 'cnf') h += `<div class="box"><div class="k">Convert to CNF</div><span class="fm">${esc(L.show(L.parse(ex.start)))}</span></div>`;
    if (k === 'resolution') h += `<div class="box"><div class="k">Knowledge base</div>${ex.kb.map((p) => `<div class="fm">${esc(L.show(L.parse(p)))}</div>`).join('')}<div class="k" style="margin-top:6px">Prove (by refutation)</div><span class="fm">α = ${esc(L.show(s.alpha))}</span> — add ¬α, resolve to □</div>`;
    if (k === 'fc' || k === 'bc') h += `<div class="box"><div class="k">Definite clauses</div>${s.rules.map((r, i) => `<div>(${i + 1}) <span class="fm">${esc(L.ruleText(r))}</span></div>`).join('')}<div class="k" style="margin-top:6px">Query</div><span class="fm">${esc(L.prettyName(ex.query))}</span></div>`;
    if (notes && notes.summary) h += `<div class="box ai"><div class="k">Strategy (AI study note)</div>${esc(notes.summary)}</div>`;
    h += `<table><thead><tr><th>#</th><th>Line</th><th>Justification</th></tr></thead><tbody>`;
    A.forEach((l, i) => {
      if (l.given && (k === 'patterns' || k === 'cnf')) return;   // already shown in the Given box
      if (!l.ok && !l.given && !opt.wrong) return;
      const n = i + 1, j = justification(k, l, s);
      if (!l.ok) { const w = opt.ai && aiSteps[ex.id] && aiSteps[ex.id][n] && aiSteps[ex.id][n] !== '…' ? `<div class="why">${esc(aiSteps[ex.id][n])}</div>` : ''; h += `<tr class="wrong"><td class="n">${n}</td><td class="fm">${esc(s.lineText(l))}</td><td>✗ attempt — ${esc(l.msg || '')}${w}</td></tr>`; return; }
      const st = aiSteps[ex.id] && aiSteps[ex.id][n] && aiSteps[ex.id][n] !== '…' ? aiSteps[ex.id][n] : notes && notes.steps[n];
      const why = opt.ai && st ? `<div class="why">Why: ${esc(st)}</div>` : '';
      const chk = l.given ? '' : `<div class="chk">✓ ${esc((l.msg || '').replace(/🎯\s*/g, ''))}</div>`;
      h += `<tr><td class="n">${n}</td><td class="fm">${esc(k === 'fc' ? L.prettyName(l.head) : k === 'bc' ? 'goal ' + L.prettyName(String(l.goal)) : l.c ? L.clauseText(l.c) : s.lineText(l))}</td><td><div>${esc(j.what)}</div>${j.law ? `<div class="law">${esc(j.law)}</div>` : ''}${chk}${why}</td></tr>`;
    });
    h += `</tbody></table>`;
    h += s.solved ? `<p class="done">✓ Complete — ${k === 'resolution' ? 'the empty clause □ was derived, so KB ⊨ α.' : k === 'cnf' ? 'the sentence is in CNF.' : k === 'fc' ? 'the query was inferred.' : k === 'bc' ? 'every goal is closed.' : 'the goal was derived.'}</p>`
      : `<p>Not finished yet${s.goal || k !== 'patterns' ? '' : ' (free derivation — no goal)'}.</p>`;
    if (k === 'bc') h += `<div class="box"><div class="k">Goal tree</div><div class="tree">${treeHTML(s.tree)}</div></div>`;
    if (notes && notes.mistake) h += `<div class="box ai"><div class="k">Watch out (AI study note)</div>${esc(notes.mistake)}</div>`;
    const t2 = threads[ex.id] || [];
    if (opt.qa && t2.length) h += `<div class="box qa"><div class="k">My questions to the AI tutor</div>${t2.filter((m) => !(m.a && m.by === 'error')).map((m) => (m.q ? `<p><b>Q:</b> ${esc(m.q)}</p>` : `<p><b>A:</b> ${esc(m.a)}</p>`)).join('')}</div>`;
    h += `<div class="foot">Every ✓/✗ above was decided by the Logic Lab checker (truth tables and exact rule matching).${notes || (opt.qa && t2.length) ? ' Text marked “AI study note”, “Why” or “A:” was written by an AI tutor; it explains but is not itself checked.' : ''} kiranvk.me/ai/logic-lab · ${s.lines.filter((l) => !l.ok).length} wrong attempt(s) · Unstuck used on ${s.hintsUsed} step(s).</div>`;
    return h;
  }

  // ───────── laws reference
  $('#laws').innerHTML = Object.values(L.INFER).map((r) => `<li><b>${esc(r.name)}</b>: <span class="f">${esc(r.law)}</span></li>`).join('')
    + Object.values(L.RULES).map((r) => `<li><b>${esc(r.name)}</b>: <span class="f">${esc(r.law)}</span></li>`).join('');

  // ───────── export / import
  $('#exp').onclick = (e) => { e.preventDefault(); const b = new Blob([JSON.stringify({ app: 'logic-lab', v: 1, progress }, null, 1)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'logic-lab-progress.json'; a.click(); };
  $('#imp').onclick = (e) => { e.preventDefault(); $('#impfile').click(); };
  $('#impfile').onchange = async () => { const f = $('#impfile').files[0]; if (!f) return; try { const j = JSON.parse(await f.text()); if (j.app !== 'logic-lab') throw 0; progress = j.progress || {}; saveProgress(); for (const k in sessions) delete sessions[k]; renderAll(); toast('Progress imported.'); } catch (_) { toast('That is not a Logic Lab progress file.'); } };

  // ───────── mobile sheet
  // the sheet covers the lower 60 % of the screen: while it is open the page gets that much extra room at the bottom,
  // so every line can still be scrolled into the visible top part; Minimise (or a tap above it) keeps all hints/answers
  function setSheet(open) {
    $('#help').classList.toggle('open', open); document.body.classList.toggle('sheet-open', open);
    const kept = $('#hint').textContent.trim() || $('#thread').textContent.trim();
    $('#fab').textContent = open ? '▾ Minimise' : kept ? '▴ Hints & answers' : 'Unstuck · Ask';
    if (open) requestAnimationFrame(() => {                 // lift the line being worked on above the sheet
      const t = $('#excard .stn.composer') || [...document.querySelectorAll('#excard .stn')].pop(); if (!t) return;
      const room = innerHeight * 0.38, b = t.getBoundingClientRect().bottom; if (b > room) scrollBy({ top: b - room, behavior: 'smooth' });
    });
  }
  const closeSheet = () => setSheet(false);
  $('#sheet-min').onclick = (e) => { e.stopPropagation(); closeSheet(); };
  // keep the floating help button out of the way while the student is typing (phone keyboard up)
  document.addEventListener('focusin', (e) => { if (e.target.matches('#excard input, #excard textarea, #excard select')) $('#fab').classList.add('away'); });
  document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement || !document.activeElement.matches('#excard input, #excard textarea, #excard select')) $('#fab').classList.remove('away'); }, 50));
  $('#fab').onclick = () => setSheet(!$('#help').classList.contains('open'));
  document.addEventListener('click', (e) => { if (!$('#help').contains(e.target) && e.target.id !== 'fab' && !e.target.closest('.modal')) closeSheet(); });

  let tt; function toast(m) { let el = $('.toast'); if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); } el.textContent = m; clearTimeout(tt); el.classList.remove('hidden'); tt = setTimeout(() => el.classList.add('hidden'), 2600); }

  function renderAll() { renderNav(); renderCard(); renderMeter(); renderHint(null); renderThread(); }
  setKeyState(keyState);
  if (!location.hash) history.replaceState(null, '', '#' + track + '/' + (exIdx < 0 ? 'new' : X[track][exIdx].id));
  renderAll();
})();
