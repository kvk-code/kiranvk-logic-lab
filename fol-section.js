/* Logic Lab — "English ⇄ FOL" section controller (PECST522 Module 3). Self-contained: it owns the #fol panel and
 * does not touch the derivation app (app.js). The top-level switch in the header shows exactly one of the two panels.
 *
 * Three sub-tabs:
 *   • English → FOL: student types English, gets an FOL formula + glossary + pattern explanation. Needs an NVIDIA key
 *     (same BYOK relay as the tutor). The AI's JSON is VALIDATED by fol-core (it must parse) and back-translated to
 *     English as a sanity check before it is shown.
 *   • FOL → English: student types a formula, gets a deterministic natural reading + glossary + pattern notes. No key.
 *   • Practice: a reference sentence is shown; the student writes their OWN FOL; fol-core checks it for equivalence
 *     with the reference over finite domains (Mace4-style). No key.
 */
(function () {
  'use strict';
  const F = window.FOLCore, EX = window.FOLExamples || [];
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KKEY = 'logiclab.v1.nvkey';
  const nvKey = () => localStorage.getItem(KKEY) || '';
  let sub = 'e2f';     // e2f | f2e | practice
  let pracIdx = 0;

const lexOf = (fs) => { const out = new Set(); fs.forEach((t) => { try { const g = F.glossary(F.parse(t)); [...g.preds, ...g.funs, ...g.consts].forEach((x) => out.add(String(x.sym).replace(/[(/].*$/, ''))); } catch (er) { } }); return [...out]; };
  const root = document.getElementById('fol');
  if (!root || !F) return;

  // ───────── glossary / pattern render shared by sub-tabs
  function glossaryHTML(f) {
    const g = F.glossary(f);
    const row = (x) => `<li><code class="f">${esc(x.sym)}</code> — ${esc(x.gloss)}</li>`;
    let h = '';
    if (g.preds.length) h += `<div class="gl-group"><b>Predicates</b><ul>${g.preds.map(row).join('')}</ul></div>`;
    if (g.funs.length) h += `<div class="gl-group"><b>Functions</b><ul>${g.funs.map(row).join('')}</ul></div>`;
    if (g.consts.length) h += `<div class="gl-group"><b>Constants</b><ul>${g.consts.map(row).join('')}</ul></div>`;
    return h || '<span class="note">No predicates yet.</span>';
  }
  function patternHTML(f) {
    const notes = F.patternNotes(f);
    if (!notes.length) return '';
    return `<div class="fol-notes"><b>Why it is written this way</b><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>`;
  }
  const symbolBar = (targetSel) => `<div class="symbar" data-for="${targetSel}">${F.SYMBOLS.map((s) => `<button type="button" class="symbtn" data-ins="${esc(s.s)}" title="${esc(s.name)}">${esc(s.s)}</button>`).join('')}<button type="button" class="symbtn ink-tog${inkOn ? ' on' : ''}" data-ink="1" title="Write with your finger or stylus">✍ Write</button></div>`;
  let inkOn = localStorage.getItem('logiclab.v1.ink') === '1';
  const inkHooks = {};   // input selector -> {submit:()=>verdict, lexicon:()=>[...], ctx:{...}}

  // ───────── top-level render
  function render() {
    root.innerHTML = `
      <div class="fol-tabs">
        <button class="ftab${sub === 'e2f' ? ' on' : ''}" data-s="e2f">English → FOL</button>
        <button class="ftab${sub === 'f2e' ? ' on' : ''}" data-s="f2e">FOL → English</button>
        <button class="ftab${sub === 'practice' ? ' on' : ''}" data-s="practice">Practice (write your own)</button>
      </div>
      <div class="fol-body" id="fol-body"></div>`;
    root.querySelectorAll('.ftab').forEach((b) => (b.onclick = () => { sub = b.dataset.s; render(); }));
    if (sub === 'e2f') renderE2F();
    else if (sub === 'f2e') renderF2E();
    else renderPractice();
  }

  function wireSymbar() {
    root.querySelectorAll('.symbar').forEach((bar) => {
      const ta = $(bar.dataset.for, root);
      bar.querySelectorAll('.symbtn:not([data-ink])').forEach((b) => (b.onclick = () => { if (!ta) return; insertAtCursor(ta, b.dataset.ins); ta.focus(); }));
      const tog = bar.querySelector('[data-ink]');
      if (tog) tog.onclick = () => { const v = ta ? ta.value : ''; inkOn = !inkOn; localStorage.setItem('logiclab.v1.ink', inkOn ? '1' : '0'); render(); const t2 = $(bar.dataset.for, root); if (t2 && v) t2.value = v; };
      if (inkOn && ta && window.LogicInk) {
        const host = document.createElement('div'); host.className = 'inkpad'; ta.insertAdjacentElement('afterend', host);
        const hk = inkHooks[bar.dataset.for] || {};
        LogicInk.attach(host, { input: ta, lexicon: () => (hk.lexicon ? hk.lexicon() : []), submitLabel: hk.label || 'Check',
          onSubmit: () => { const r = hk.submit ? hk.submit() : null; return { ok: r == null ? null : !!r } },
          context: () => Object.assign({ track: 'fol', tab: sub }, hk.ctx ? hk.ctx() : {}) });
      }
    });
  }
  function insertAtCursor(el, text) {
    const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, s) + text + el.value.slice(e);
    const p = s + text.length; el.selectionStart = el.selectionEnd = p;
  }

  // ───────── FOL → English (deterministic, no key)
  function renderF2E() {
    const b = $('#fol-body', root);
    b.innerHTML = `
      <div class="card">
        <h2>FOL → English</h2>
        <p class="note">Type a first-order formula. You get a natural reading, a glossary and the translation pattern. No key needed.</p>
        ${symbolBar('#f2e-in')}
        <input class="fin f" id="f2e-in" placeholder="e.g. ∀x Bird(x) ⇒ Fly(x)   (ASCII ok: all x Bird(x) -> Fly(x))" autocomplete="off" spellcheck="false">
        <div class="actions"><button class="btn primary" id="f2e-go">Read it</button><button class="btn ghost" id="f2e-eg">Load an example</button></div>
        <div id="f2e-out"></div>
      </div>`;
    inkHooks['#f2e-in'] = { label: 'Read it', lexicon: () => lexOf(EX.map((x) => x.fol)), submit: () => { $('#f2e-go', root).click(); return null; } };
    wireSymbar();
    const inp = $('#f2e-in', root), out = $('#f2e-out', root);
    const run = () => {
      const r = F.tryParse(inp.value.trim());
      if (!inp.value.trim()) { out.innerHTML = ''; return; }
      if (!r.ok) { out.innerHTML = `<div class="msg bad"><b class="src">Parser</b>× ${esc(r.error)}</div>`; return; }
      out.innerHTML = `
        <div class="fol-read"><div class="rd-formula f">${esc(F.show(r.f))}</div>
          <div class="rd-en">“${esc(F.toEnglish(r.f))}”</div></div>
        ${patternHTML(r.f)}
        <details class="laws" open><summary>Glossary</summary>${glossaryHTML(r.f)}</details>`;
    };
    $('#f2e-go', root).onclick = run;
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    $('#f2e-eg', root).onclick = () => { inp.value = EX[Math.floor(Math.random() * EX.length)].fol; run(); };
  }

  // ───────── English → FOL (NVIDIA relay, validated + back-translated)
  function renderE2F() {
    const b = $('#fol-body', root);
    b.innerHTML = `
      <div class="card">
        <h2>English → FOL</h2>
        <p class="note">Type an English sentence. ${nvKey() ? 'The AI proposes a formula; the logic engine then checks it parses and reads it back to you.' : 'Needs your free NVIDIA key for the AI translation — set it up from the “AI tutor” chip at the top. You can still browse the ' + EX.length + ' offline examples below.'}</p>
        <input class="fin" id="e2f-in" placeholder="e.g. Not all birds fly." autocomplete="off" ${nvKey() ? '' : 'disabled'}>
        <div class="actions"><button class="btn primary" id="e2f-go" ${nvKey() ? '' : 'disabled'}>Translate</button></div>
        <div id="e2f-out"></div>
      </div>
      <div class="card">
        <details class="laws" open><summary>${EX.length} worked examples from the Module 3 slides (no key needed)</summary>
          <div class="fol-egs">${EX.map((e, i) => `<button class="eg" data-i="${i}"><span class="eg-en">${esc(e.en)}</span><span class="eg-fol f">${esc(e.fol)}</span></button>`).join('')}</div>
        </details>
      </div>`;
    const out = $('#e2f-out', root), inp = $('#e2f-in', root);
    root.querySelectorAll('.eg').forEach((btn) => (btn.onclick = () => showExample(EX[Number(btn.dataset.i)], out)));
    if (nvKey()) {
      const run = () => translate(inp.value.trim(), out);
      $('#e2f-go', root).onclick = run;
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    }
  }
  function showExample(e, out) {
    const f = F.parse(e.fol);
    out.innerHTML = `
      <div class="fol-read"><div class="rd-en">“${esc(e.en)}”</div>
        <div class="rd-formula f">${esc(F.show(f))}</div>
        <div class="note">Back-reads as: ${esc(F.toEnglish(f))}</div>
        <div class="fol-teach">💡 ${esc(e.teach)} <span class="note">(slide ${esc(e.from)})</span></div></div>
      ${patternHTML(f)}
      <details class="laws" open><summary>Glossary</summary>${glossaryHTML(f)}</details>`;
  }
  async function translate(en, out) {
    if (!en) { out.innerHTML = ''; return; }
    out.innerHTML = '<div class="note">Translating… the logic engine will check the result before it is shown.</div>';
    let draft = null, issues = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      let j;
      try { j = await callAI(en, attempt ? { draft, issues } : null); }
      catch (e) { out.innerHTML = `<div class="msg bad"><b class="src">Relay</b>× ${esc(String(e.message || e))}</div>`; return; }
      if (!j.ok) { out.innerHTML = `<div class="msg bad"><b class="src">AI</b>× ${esc(j.detail || j.reason || 'failed')}</div>`; return; }
      const parsed = extractFormula(j.text);
      if (!parsed) { draft = j.text; issues = ['Your reply did not contain a formula I could read. Reply with only the FOL formula on one line, using ∀ ∃ ¬ ∧ ∨ ⇒ ⇔.']; continue; }
      const r = F.tryParse(parsed);
      if (!r.ok) { draft = parsed; issues = ['The formula “' + parsed + '” does not parse: ' + r.error + ' Give a syntactically valid FOL formula.']; continue; }
      // success: show it with its deterministic back-translation
      const back = F.toEnglish(r.f);
      out.innerHTML = `
        <div class="fol-read"><div class="rd-en">“${esc(en)}”</div>
          <div class="rd-formula f">${esc(F.show(r.f))}</div>
          <div class="fol-badge">✓ checked: this formula parses, and the logic engine reads it back as —</div>
          <div class="note">“${esc(back)}”</div></div>
        ${patternHTML(r.f)}
        <details class="laws" open><summary>Glossary</summary>${glossaryHTML(r.f)}</details>
        <p class="note">The AI proposes; the deterministic parser validates. Compare the back-reading with your sentence — if they differ, the AI may have mis-translated.</p>`;
      return;
    }
    out.innerHTML = `<div class="msg warn"><b class="src">Engine</b>The AI could not produce a valid formula after 3 tries. ${draft ? 'Its last attempt was: <code>' + esc(draft) + '</code>' : ''} Try rephrasing, or see the worked examples.</div>`;
  }
  // pull the first parseable FOL line out of the model's reply (it is told to return the formula alone)
  function extractFormula(text) {
    const lines = String(text).split('\n').map((l) => l.replace(/^[-*>\s]+/, '').replace(/^FOL[:\s]*/i, '').trim()).filter(Boolean);
    for (const l of lines) { const c = l.replace(/[`*]/g, ''); if (/[∀∃]|\ball\b|\bexists\b|[⇒∧∨¬]|->/.test(c) && F.tryParse(c).ok) return c; }
    // last resort: the whole thing
    const whole = String(text).replace(/[`*]/g, '').trim();
    return F.tryParse(whole).ok ? whole : null;
  }
  async function callAI(en, repair) {
    const body = { user_key: nvKey(), kind: 'ask', context: { fol_task: 'english-to-fol' },
      question: `Translate this English sentence into a single first-order logic formula and reply with ONLY the formula on one line (no explanation, no code fences), using the symbols ∀ ∃ ¬ ∧ ∨ ⇒ ⇔ and predicate/constant/function names in CamelCase. Follow the rules: ∀ pairs with ⇒, ∃ pairs with ∧, "not all" is ¬∀, "no/none" is ¬∃. Sentence: ${en}` };
    if (repair) body.repair = repair;
    const res = await fetch('ai.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return res.json();
  }

  // ───────── Practice (deterministic equivalence check, no key)
  function renderPractice() {
    const b = $('#fol-body', root);
    const e = EX[pracIdx];
    b.innerHTML = `
      <div class="card">
        <h2>Practice — write the FOL yourself</h2>
        <div class="fol-prompt"><div class="note">Translate into first-order logic:</div><div class="prompt-en">“${esc(e.en)}”</div><div class="fol-teach">💡 ${esc(e.teach)}</div></div>
        ${symbolBar('#prac-in')}
        <input class="fin f" id="prac-in" placeholder="Write your formula (∀ ∃ ¬ ∧ ∨ ⇒ ⇔ — ASCII ok)" autocomplete="off" spellcheck="false">
        <div class="actions">
          <button class="btn primary" id="prac-check">Check</button>
          <button class="btn ghost" id="prac-show">Show reference</button>
          <button class="btn" id="prac-next">Next sentence →</button>
          <span class="note" style="margin-left:auto">${pracIdx + 1} / ${EX.length}</span>
        </div>
        <div id="prac-out"></div>
      </div>`;
    inkHooks['#prac-in'] = { label: 'Check', lexicon: () => lexOf([e.fol]), ctx: () => ({ ex: 'fol-' + pracIdx }),
      submit: () => { const o = $('#prac-out', root); check(e, $('#prac-in', root).value.trim(), o); return o.querySelector('.msg.ok') ? true : (o.querySelector('.msg.bad') ? false : null); } };
    wireSymbar();
    const inp = $('#prac-in', root), out = $('#prac-out', root);
    $('#prac-check', root).onclick = () => check(e, inp.value.trim(), out);
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') check(e, inp.value.trim(), out); });
    $('#prac-show', root).onclick = () => { const f = F.parse(e.fol); out.innerHTML = `<div class="fol-read"><div class="note">A reference answer:</div><div class="rd-formula f">${esc(F.show(f))}</div><div class="note">Not the only correct form — anything logically equivalent is accepted by Check.</div></div>${patternHTML(f)}`; };
    $('#prac-next', root).onclick = () => { pracIdx = (pracIdx + 1) % EX.length; renderPractice(); };
  }
  function check(e, text, out) {
    if (!text) { out.innerHTML = ''; return; }
    const r = F.tryParse(text);
    if (!r.ok) { out.innerHTML = `<div class="msg bad"><b class="src">Parser</b>× ${esc(r.error)}</div>`; return; }
    const ref = F.parse(e.fol);
    let res; try { res = F.finiteEquivalent(ref, r.f); } catch (err) { out.innerHTML = `<div class="msg warn"><b class="src">Engine</b>Could not check (formula too large): ${esc(String(err.message || err))}</div>`; return; }
    if (res.equivalent) {
      out.innerHTML = `<div class="msg ok"><b class="src">Engine</b>✓ Correct — your formula is logically equivalent to the reference${res.incomplete ? ' (checked over small finite domains)' : ' (checked over all domains up to size ' + F.MAXDOM + ')'}.</div>
        <div class="fol-read"><div class="note">You wrote:</div><div class="rd-formula f">${esc(F.show(r.f))}</div><div class="note">Reads as: ${esc(F.toEnglish(r.f))}</div></div>`;
    } else {
      const d = res.counter;
      out.innerHTML = `<div class="msg bad"><b class="src">Engine</b>× Not equivalent. There is a situation (a model with ${d.dom} object${d.dom > 1 ? 's' : ''}) where your formula and the reference disagree.</div>
        ${counterHTML(d, ref, r.f)}
        <div class="fol-read"><div class="note">Reference reads as: ${esc(F.toEnglish(ref))}</div><div class="note">Yours reads as: ${esc(F.toEnglish(r.f))}</div></div>`;
    }
  }
  function counterHTML(d, ref, mine) {
    const dom = []; for (let i = 0; i < d.dom; i++) dom.push(i);
    const rows = Object.entries(d.model.preds).map(([n, p]) => {
      const trues = [...p.table].map((t) => n + '(' + t.split(',').map((x) => 'o' + (Number(x) + 1)).join(',') + ')');
      return `<li><code>${esc(n)}</code> true for: ${trues.length ? esc(trues.join(', ')) : '(nothing)'}</li>`;
    });
    const consts = Object.entries(d.model.consts || {}).map(([n, v]) => `<li><code>${esc(n)}</code> = o${v + 1}</li>`);
    const rv = F.evalIn(ref, d.model, dom), mv = F.evalIn(mine, d.model, dom);
    return `<div class="fol-counter"><div class="note">Objects: ${dom.map((i) => 'o' + (i + 1)).join(', ')}. In this situation:</div>
      <ul>${rows.join('')}${consts.join('')}</ul>
      <div class="note">→ the reference is <b>${rv ? 'true' : 'false'}</b> here, but yours is <b>${mv ? 'true' : 'false'}</b>.</div></div>`;
  }

  // expose a mount hook for the top-level switch in app.js's shell
  window.FOLSection = { render, show() { render(); } };
  // initial render is triggered by the shell when the panel becomes visible
})();
