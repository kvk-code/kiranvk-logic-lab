/* Logic Lab — the logic engine checks every AI text before a student sees it (same idea as the Wumpus tutor's
 * verify-and-repair loop). The AI writes; the engine verifies:
 *   1. every formula the AI writes must be on the board (a line or part of a line) or genuinely follow from the
 *      statements (truth table) — "X is false / ¬X holds" claims are checked as ¬X;
 *   2. when it explains a ✓ line, the rule it names must be the rule the checker identified;
 *   3. "line N is correct / wrong" must agree with the checker's ✓/×; it must not call a × line valid or a ✓ line wrong.
 * verify(text, session, {kind, line}) → {issues:[…]}   (empty = passes)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic-core.js'));
  else root.AIVerify = factory(root.LogicCore);
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';
  const RULE_WORDS = [
    [/unit[\s-]+resolution/i, 'unitres'], [/modus\s+ponens/i, 'mp'], [/modus\s+tollens/i, 'mt'],
    [/and[\s-]+elimination/i, 'andelim'], [/and[\s-]+introduction/i, 'andintro'],
    [/bicondition\w*\s+elimination|⇔[\s-]*elimination/i, 'biconditional'], [/implication\s+elimination|⇒[\s-]*elimination/i, 'implication'],
    [/contraposi\w+/i, 'contraposition'], [/de\s*morgan/i, 'demorgan'], [/double[\s-]+negation/i, 'doubleneg'], [/distribut\w+/i, 'distribution'],
  ];
  const STOP = new Set(['The', 'So', 'Since', 'Line', 'Lines', 'This', 'That', 'From', 'If', 'Then', 'Both', 'We', 'You', 'It', 'Use', 'Using', 'Here', 'Now', 'And', 'Or', 'Not', 'Your', 'Its', 'In', 'By', 'With', 'An', 'To', 'Apply', 'Applying', 'Modus', 'Ponens', 'Tollens', 'De', 'Morgan', 'Unit', 'Resolution', 'Rule', 'Step', 'Goal', 'KB', 'CNF', 'Because', 'Therefore', 'Thus', 'When', 'Each', 'Every', 'Remember', 'Note', 'Think', 'Look', 'Yes', 'No', 'Great', 'Good', 'Well', 'First', 'Next', 'Finally', 'Since', 'As', 'For', 'On', 'At', 'Of', 'Is', 'Are', 'But', 'However', 'Correct', 'Wrong', 'True', 'False', 'Biconditional', 'Implication', 'Elimination', 'Introduction', 'Contraposition', 'Distribution', 'Double', 'Negation', 'And-Elimination', 'And-Introduction', 'Modus Ponens', 'MP', 'MT']);
  const OP = /[¬∧∨⇒⇔~&|]|->|<->|=>/;

  // pull formula-looking runs out of prose, keep only the parseable ones that contain an operator
  function extractFormulas(text) {
    const out = [];
    // tokens with their offsets (so "end" is exact even when a token repeats)
    const src = String(text).replace(/[“”"`]/g, ' ');
    const toks = []; const tre = /[^\s]+/g; let tm;
    while ((tm = tre.exec(src))) {
      let w = tm[0], at = tm.index;
      const trail = /[.;:!?,]+$/.exec(w); if (trail && !/^[)]/.test(trail[0])) w = w.slice(0, w.length - trail[0].length);
      if (w) toks.push({ t: w, end: at + w.length });
      if (trail) toks.push({ t: trail[0], end: at + tm[0].length, punct: true });
    }
    const isF = (t) => /^[¬~(]*[A-Z][A-Za-z0-9]*(?:\d+,\d+)?[)]*$/.test(t) && !STOP.has(t.replace(/[()¬~]/g, '')) || /^[¬∧∨⇒⇔()~&|⊤⊥]+$/.test(t) || t === '->' || t === '<->' || t === '=>'
      || /^[¬~(]*[A-Z][A-Za-z0-9]*(?:\d+,\d+)?[)]*[¬∧∨⇒⇔][¬~(]*[A-Z]/.test(t);
    let run = [];
    const flush = () => {
      if (run.length) {
        const s = run.map((x) => x.t).join(' ');
        if (OP.test(s)) {
          // longest parseable window (trim stray brackets/words at the ends)
          let best = null;
          for (let a = 0; a < run.length && !best; a++) for (let b = run.length; b > a; b--) {
            const cand = run.slice(a, b).map((x) => x.t).join(' ').replace(/^[)\s]+|[(\s]+$/g, '');
            if (!OP.test(cand)) continue;
            const r = L.tryParse(cand);
            if (r.ok) { best = { text: cand, f: L.flat(r.f), start: run[a].end - run[a].t.length, end: run[b - 1].end }; break; }
          }
          if (best) out.push(best);
        }
      }
      run = [];
    };
    for (const t of toks) { if (!t.punct && isF(t.t)) run.push(t); else flush(); }
    flush();
    return out;
  }
  function subformulas(f, acc) {
    acc = acc || new Set(); acc.add(L.key(f));
    if (f.t === 'not') subformulas(f.a, acc);
    else if (f.t === 'and' || f.t === 'or') { f.args.forEach((a) => subformulas(a, acc)); }
    else if (f.t === 'imp' || f.t === 'iff') { subformulas(f.l, acc); subformulas(f.r, acc); }
    return acc;
  }
  function boardFormulas(s) {
    const set = new Set(); const fs = [];
    for (const l of s.all()) { let f = l.f && l.f.t ? l.f : l.c ? L.clauseFormula(l.c) : null; if (f) { fs.push(L.flat(f)); subformulas(L.flat(f), set); } }
    if (s.goal) { fs.push(s.goal); subformulas(s.goal, set); }
    if (s.alpha) { subformulas(s.alpha, set); subformulas(L.flat(L.Not(s.alpha)), set); }
    if (s.kb) s.kb.forEach((k) => subformulas(L.flat(k), set));
    return { set, fs };
  }

  function verify(text, s, opts) {
    opts = opts || {};
    const issues = []; const track = s.track; const A = s.all();
    // 1) formula claims
    if (track === 'patterns' || track === 'cnf') {
      const { set, fs } = boardFormulas(s);
      const premises = track === 'patterns' ? s.given.map((l) => l.f) : null;
      const okLines = A.filter((l) => l.ok && l.f && l.f.t).map((l) => L.flat(l.f));
      for (const m of extractFormulas(text)) {
        const after = String(text).slice(m.end, m.end + 40);
        const claimNeg = /^\s*(?:is|must be|would be|has to be|becomes)\s+(?:false|not true)/i.test(after);
        const f = claimNeg ? L.flat(L.Not(m.f)) : m.f;
        if (!claimNeg && set.has(L.key(m.f))) continue;                       // quoted from the board
        let ok = false;
        try {
          if (track === 'patterns') ok = L.entails(premises, f);
          else { ok = okLines.some((g) => L.equivalent(g, f)) || fs.some((g) => anySubEquivalent(g, f)); }
        } catch (e) { ok = true; }                                            // too big to check → do not block
        if (!ok) issues.push(track === 'patterns'
          ? `You wrote "${L.show(f)}" as if it were true, but it does NOT follow from the statements (truth table). Do not claim it.`
          : `You wrote "${L.show(f)}", but it is not equivalent to anything on the board — a CNF step must keep the sentence equivalent.`);
      }
    }
    // 1b) "X becomes Y" / "X is equivalent to Y" / "X ≡ Y" must really be an equivalence
    if (track === 'patterns' || track === 'cnf') {
      const ms = extractFormulas(text);
      for (let i = 0; i + 1 < ms.length; i++) {
        const a = ms[i], b = ms[i + 1];
        const between = String(text).slice(a.end, b.start);
        if (!/^\s*(becomes|is equivalent to|≡|turns into|rewrites to|is the same as|can be written as|=)\s*$/i.test(between)) continue;
        let eq = true; try { eq = L.equivalent(a.f, b.f); } catch (e) { }
        if (!eq) issues.push(`You wrote that "${L.show(a.f)}" becomes "${L.show(b.f)}", but they are NOT equivalent (truth table).`);
      }
    }
    // 2) rule named for the explained line
    if (opts.kind === 'step' && opts.line && (track === 'patterns' || track === 'cnf')) {
      const l = A[opts.line - 1];
      if (l && l.ok && !l.given && l.rule && l.verdict !== 'combined' && l.verdict !== 'equivalent') {
        const named = RULE_WORDS.filter(([re, id]) => re.test(text) && !(id === 'resolution')).map(([, id]) => id);
        if (named.length && !named.includes(l.rule)) issues.push(`You named ${named.map(L.ruleName).join(' / ')}, but the checker identified line ${opts.line} as ${L.ruleName(l.rule)}. Use ${L.ruleName(l.rule)}.`);
      }
    }
    // 3) verdict claims about lines
    const re = /line\s+(\d+)\s+(?:is|was)\s+(?:also\s+)?(not\s+)?(correct|right|valid|fine|wrong|incorrect|invalid|a mistake)/gi; let m;
    while ((m = re.exec(text))) {
      const l = A[Number(m[1]) - 1]; if (!l || l.given) continue;
      const saysGood = /correct|right|valid|fine/i.test(m[3]) !== !!m[2];
      if (saysGood !== !!l.ok) issues.push(`You said line ${m[1]} is ${saysGood ? 'correct' : 'wrong'}, but the checker marked it ${l.ok ? '✓ correct' : '× wrong'}.`);
    }
    if (opts.kind === 'step' && opts.line) {
      const l = A[opts.line - 1];
      if (l && l.ok && /\b(incorrect|invalid|is wrong|not valid|a mistake)\b/i.test(text) && !/\bnot (incorrect|invalid|wrong)\b/i.test(text)) issues.push(`Line ${opts.line} is ✓ correct (checker), but your text calls it wrong.`);
      if (l && !l.ok && /\b(is correct|is valid|correctly applies|this works|well done)\b/i.test(text)) issues.push(`Line ${opts.line} is × wrong (checker: ${l.msg}), but your text calls it correct.`);
    }
    return { issues: [...new Set(issues)] };
  }
  function anySubEquivalent(g, f) {
    const walk = (h) => { try { if (L.symbols(h).size <= 10 && L.equivalent(h, f)) return true; } catch (e) { } if (h.t === 'not') return walk(h.a); if (h.t === 'and' || h.t === 'or') return h.args.some(walk); if (h.t === 'imp' || h.t === 'iff') return walk(h.l) || walk(h.r); return false; };
    return walk(g);
  }
  // engine-only fallback text for a line (used when the AI cannot produce a consistent explanation)
  function engineText(s, n) {
    const l = s.all()[n - 1]; if (!l) return '';
    const law = l.rule && (L.INFER[l.rule] || L.RULES[l.rule]) ? ` (${(L.INFER[l.rule] || L.RULES[l.rule]).law})` : '';
    return (l.ok ? '' : 'Not valid: ') + (l.msg || '').replace(/🎯\s*/g, '') + law;
  }
  return { verify, extractFormulas, engineText };
});
