/* Logic Lab — propositional engine for PECST522 Module 3 (KTU 2024), v1.
 *
 * What is reused, and from where:
 *   • CNF pipeline (eliminate ⇔/⇒ → move ¬ inwards → distribute ∨ over ∧), PL-RESOLUTION, PL-FC-ENTAILS and
 *     TT-ENTAILS are ports of aima-python `aima/logic.py` (MIT, © aima-python contributors) — the same algorithms
 *     as AIMA 4e Ch. 7, which is textbook T1 of the syllabus.
 *   • The step diagnosis model (Correct / Expected / WrongRule / Detour / Buggy / NotEquivalent / Unknown) and the
 *     idea of "buggy rules" that name a student's exact mistake come from the IDEAS framework behind LogEx
 *     (ideas-edu/ideas, Apache-2.0; Lodder & Heeren, Open Universiteit). Their study found a "next step" button
 *     helps more than a vague hint — hence the 3-level Unstuck below.
 *   • Clause normalisation (drop duplicate literals, a clause with P and ¬P is a tautology) follows
 *     games/wumpus-justify/wumpus-logic.js.
 * Every ✓/× is decided here, deterministically. The AI tutor only explains; it never decides.
 * Works in the browser (window.LogicCore) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LogicCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ───────────────────────────── AST ─────────────────────────────
  // {t:'var', n} | {t:'const', v:true|false} | {t:'not', a} | {t:'and'|'or', args:[…]} | {t:'imp'|'iff', l, r}
  const V = (n) => ({ t: 'var', n });
  const C = (v) => ({ t: 'const', v });
  const Not = (a) => ({ t: 'not', a });
  const And = (...args) => ({ t: 'and', args });
  const Or = (...args) => ({ t: 'or', args });
  const Imp = (l, r) => ({ t: 'imp', l, r });
  const Iff = (l, r) => ({ t: 'iff', l, r });

  // ───────────────────────────── parser ─────────────────────────────
  // Accepts Unicode and ASCII: ¬ ~ ! not | ∧ & ^ /\ and | ∨ | \/ or | ⇒ → -> => implies | ⇔ ↔ <-> <=> iff
  // Symbols: P, Q, Rain, P12, B11, P1,2 (AIMA Wumpus style), P_1_2.  True/False: ⊤ T true, ⊥ F false (single letters
  // T and F are treated as constants only when written ⊤/⊥/true/false; plain T/F are symbols).
  function tokenize(src) {
    const s = String(src).replace(/[ \s]+/g, ' ').trim();
    const out = []; let i = 0;
    const two = { '->': 'imp', '=>': 'imp', '/\\': 'and', '\\/': 'or', '||': 'or', '&&': 'and' };
    const three = { '<->': 'iff', '<=>': 'iff' };
    while (i < s.length) {
      const c = s[i];
      if (c === ' ') { i++; continue; }
      if (three[s.substr(i, 3)]) { out.push({ k: three[s.substr(i, 3)] }); i += 3; continue; }
      if (two[s.substr(i, 2)]) { out.push({ k: two[s.substr(i, 2)] }); i += 2; continue; }
      if ('¬~!'.includes(c)) { out.push({ k: 'not' }); i++; continue; }
      if ('∧&^'.includes(c)) { out.push({ k: 'and' }); i++; continue; }
      if ('∨|'.includes(c)) { out.push({ k: 'or' }); i++; continue; }
      if ('⇒→⊃'.includes(c)) { out.push({ k: 'imp' }); i++; continue; }
      if ('⇔↔≡'.includes(c)) { out.push({ k: 'iff' }); i++; continue; }
      if ('([{'.includes(c)) { out.push({ k: '(' }); i++; continue; }
      if (')]}'.includes(c)) { out.push({ k: ')' }); i++; continue; }
      if (c === '⊤') { out.push({ k: 'const', v: true }); i++; continue; }
      if (c === '⊥') { out.push({ k: 'const', v: false }); i++; continue; }
      const m = /^[A-Za-z][A-Za-z_]*(?:\d+(?:,\d+)?)?(?:_\d+)*/.exec(s.slice(i));
      if (m) {
        let w = m[0]; i += w.length;
        const lw = w.toLowerCase();
        if (lw === 'not') { out.push({ k: 'not' }); continue; }
        if (lw === 'and') { out.push({ k: 'and' }); continue; }
        if (lw === 'or' || w === 'v') { out.push({ k: 'or' }); continue; }
        if (lw === 'implies') { out.push({ k: 'imp' }); continue; }
        if (lw === 'iff') { out.push({ k: 'iff' }); continue; }
        if (lw === 'true') { out.push({ k: 'const', v: true }); continue; }
        if (lw === 'false') { out.push({ k: 'const', v: false }); continue; }
        out.push({ k: 'var', n: canonName(w) }); continue;
      }
      throw new SyntaxError(`I can't read “${c}” (position ${i + 1}).`);
    }
    return out;
  }
  const canonName = (w) => w.replace(/,/g, '').replace(/_/g, '');   // P1,2 ≡ P12 ≡ P_1_2

  // precedence (AIMA Fig 7.7): ¬ > ∧ > ∨ > ⇒ > ⇔ ; ⇒ and ⇔ are right-associative
  function parse(src) {
    const toks = tokenize(src); let p = 0;
    if (!toks.length) throw new SyntaxError('Empty line.');
    const peek = () => toks[p], eat = (k) => { if (toks[p] && toks[p].k === k) { p++; return true; } return false; };
    function iff() { const l = imp(); if (eat('iff')) return Iff(l, iff()); return l; }
    function imp() { const l = or(); if (eat('imp')) return Imp(l, imp()); return l; }
    function or() { const a = [and()]; while (eat('or')) a.push(and()); return a.length === 1 ? a[0] : Or(...a); }
    function and() { const a = [unary()]; while (eat('and')) a.push(unary()); return a.length === 1 ? a[0] : And(...a); }
    function unary() {
      if (eat('not')) return Not(unary());
      const t = peek();
      if (!t) throw new SyntaxError('The line ends too early: something is missing after the last operator.');
      if (t.k === '(') { p++; const e = iff(); if (!eat(')')) throw new SyntaxError('A bracket is not closed.'); return e; }
      if (t.k === 'var') { p++; return V(t.n); }
      if (t.k === 'const') { p++; return C(t.v); }
      throw new SyntaxError(`Expected a symbol or “(” but found “${sym(t.k)}” — two operators in a row?`);
    }
    const e = iff();
    if (p < toks.length) throw new SyntaxError(toks[p].k === ')' ? 'There is an extra “)”.' : toks[p].k === 'var' ? `“${prettyName(toks[p].n)}” comes right after another term — is an operator (∧ ∨ ⇒ ⇔) missing?` : `Unexpected “${sym(toks[p].k)}” — is an operator missing?`);
    return e;
  }
  const sym = (k) => ({ not: '¬', and: '∧', or: '∨', imp: '⇒', iff: '⇔', '(': '(', ')': ')' }[k] || k);
  function tryParse(src) { try { return { ok: true, f: parse(src) }; } catch (e) { return { ok: false, error: e.message }; } }

  // ───────────────────────────── printing ─────────────────────────────
  const PREC = { iff: 1, imp: 2, or: 3, and: 4, not: 5, var: 6, const: 6 };
  function show(f, parent) {
    let s;
    switch (f.t) {
      case 'var': return prettyName(f.n);
      case 'const': return f.v ? '⊤' : '⊥';
      case 'not': s = '¬' + show(f.a, 'not'); return s;
      case 'and': s = f.args.map((a) => show(a, 'and')).join(' ∧ '); break;
      case 'or': s = f.args.map((a) => show(a, 'or')).join(' ∨ '); break;
      case 'imp': s = show(f.l, 'imp-l') + ' ⇒ ' + show(f.r, 'imp'); break;
      case 'iff': s = show(f.l, 'iff-l') + ' ⇔ ' + show(f.r, 'iff'); break;
    }
    if (!parent) return s;
    const pp = PREC[parent.replace('-l', '')];
    const need = PREC[f.t] < pp || (PREC[f.t] === pp && (parent.endsWith('-l') || f.t === 'and' || f.t === 'or'))
      || (parent === 'not' && f.t !== 'var' && f.t !== 'const' && f.t !== 'not');
    // keep ∨ inside ∧ (and vice versa), and any ∧/∨ under ⇒/⇔, bracketed — students read with explicit brackets
    const pr = parent.replace('-l', '');
    return need || ((pr === 'and' && f.t === 'or') || (pr === 'or' && f.t === 'and')) || ((pr === 'imp' || pr === 'iff') && (f.t === 'and' || f.t === 'or')) ? '(' + s + ')' : s;
  }
  // P12 → P1,2 for Wumpus-style names (letter(s) + exactly two digits), otherwise unchanged
  const prettyName = (n) => (/^[A-Z][a-z]?\d\d$/.test(n) ? n.replace(/(\d)(\d)$/, '$1,$2') : n);

  // ───────────────────────────── structure helpers ─────────────────────────────
  function flat(f) { // n-ary flatten of nested ∧/∨, recursively
    switch (f.t) {
      case 'not': return Not(flat(f.a));
      case 'imp': return Imp(flat(f.l), flat(f.r));
      case 'iff': return Iff(flat(f.l), flat(f.r));
      case 'and': case 'or': {
        const out = [];
        for (const a of f.args.map(flat)) { if (a.t === f.t) out.push(...a.args); else out.push(a); }
        return out.length === 1 ? out[0] : { t: f.t, args: out };
      }
      default: return f;
    }
  }
  // canonical key modulo associativity, commutativity and idempotence of ∧/∨ (and ⇔ symmetry).
  function key(f) {
    switch (f.t) {
      case 'var': return f.n;
      case 'const': return f.v ? 'T' : 'F';
      case 'not': return '~' + key(f.a);
      case 'imp': return '(' + key(f.l) + '>' + key(f.r) + ')';
      case 'iff': { const a = [key(f.l), key(f.r)].sort(); return '(' + a[0] + '=' + a[1] + ')'; }
      case 'and': case 'or': {
        const parts = []; const walk = (g) => { if (g.t === f.t) g.args.forEach(walk); else parts.push(key(g)); };
        walk(f);
        const u = [...new Set(parts)].sort();
        return u.length === 1 ? u[0] : '(' + u.join(f.t === 'and' ? '&' : '|') + ')';
      }
    }
  }
  const same = (a, b) => key(a) === key(b);
  function symbols(f, set) {
    set = set || new Set();
    if (f.t === 'var') set.add(f.n);
    else if (f.t === 'not') symbols(f.a, set);
    else if (f.t === 'and' || f.t === 'or') f.args.forEach((a) => symbols(a, set));
    else if (f.t === 'imp' || f.t === 'iff') { symbols(f.l, set); symbols(f.r, set); }
    return set;
  }
  function size(f) {
    if (f.t === 'var' || f.t === 'const') return 1;
    if (f.t === 'not') return 1 + size(f.a);
    if (f.t === 'and' || f.t === 'or') return 1 + f.args.reduce((s, a) => s + size(a), 0);
    return 1 + size(f.l) + size(f.r);
  }

  // ───────────────────────────── semantics (TT-ENTAILS, AIMA Fig 7.10) ─────────────────────────────
  function evalF(f, m) {
    switch (f.t) {
      case 'var': return !!m[f.n];
      case 'const': return f.v;
      case 'not': return !evalF(f.a, m);
      case 'and': return f.args.every((a) => evalF(a, m));
      case 'or': return f.args.some((a) => evalF(a, m));
      case 'imp': return !evalF(f.l, m) || evalF(f.r, m);
      case 'iff': return evalF(f.l, m) === evalF(f.r, m);
    }
  }
  const MAX_SYMS = 18;
  function models(fs, cb) { // enumerate all models over the symbols of fs; cb(model) → false to stop
    const syms = [...fs.reduce((s, f) => symbols(f, s), new Set())].sort();
    if (syms.length > MAX_SYMS) throw new Error('too many symbols for a truth table');
    const n = syms.length, m = {};
    for (let i = 0; i < 1 << n; i++) { for (let j = 0; j < n; j++) m[syms[j]] = !!(i & (1 << j)); if (cb(m) === false) return false; }
    return true;
  }
  // premises ⊨ goal  (premises: array of formulas)
  function entails(premises, goal) {
    return models([...premises, goal], (m) => (premises.every((p) => evalF(p, m)) && !evalF(goal, m) ? false : true));
  }
  function countermodel(premises, goal) { // a model of the premises in which the goal is false (null if entailed)
    let f = null;
    models([...premises, goal], (m) => { if (premises.every((p) => evalF(p, m)) && !evalF(goal, m)) { f = Object.assign({}, m); return false; } return true; });
    return f;
  }
  const equivalent = (a, b) => entails([a], b) && entails([b], a);
  const satisfiable = (fs) => !models(fs, (m) => (fs.every((f) => evalF(f, m)) ? false : true));
  const valid = (f) => entails([], f);

  // ───────────────────────────── normal forms ─────────────────────────────
  const isLit = (f) => f.t === 'var' || (f.t === 'not' && f.a.t === 'var');
  const isClause = (f) => isLit(f) || (f.t === 'or' && flat(f).args.every(isLit));
  const isCNF = (f) => { f = flat(f); return isClause(f) || (f.t === 'and' && f.args.every(isClause)); };
  const hasT = (f, t) => f.t === t || (f.t === 'not' && hasT(f.a, t)) || ((f.t === 'and' || f.t === 'or') && f.args.some((a) => hasT(a, t)))
    || ((f.t === 'imp' || f.t === 'iff') && (f.t === t || hasT(f.l, t) || hasT(f.r, t)));
  const negNotInward = (f) => (f.t === 'not' && f.a.t !== 'var') || (f.t === 'not' ? negNotInward(f.a) : (f.t === 'and' || f.t === 'or') ? f.args.some(negNotInward) : (f.t === 'imp' || f.t === 'iff') ? negNotInward(f.l) || negNotInward(f.r) : false);
  const orOverAnd = (f) => (f.t === 'or' && flat(f).args.some((a) => a.t === 'and')) || ((f.t === 'and' || f.t === 'or') && f.args.some(orOverAnd)) || (f.t === 'not' && orOverAnd(f.a)) || ((f.t === 'imp' || f.t === 'iff') && (orOverAnd(f.l) || orOverAnd(f.r)));

  // ───────────────────────────── rewrite rules ─────────────────────────────
  // Each rule: at(node) → array of replacements for THAT node (empty if it does not apply).
  // Rules are applied anywhere in the tree (rewriteAll) — exactly how the textbook equivalences are used.
  const subsetsSplit = (args) => { // all ways to split n-ary args into (one element, rest) — for distribution
    return args.map((a, i) => [a, args.filter((_, j) => j !== i)]);
  };
  const mk = (t, args) => (args.length === 1 ? args[0] : { t, args });
  const RULES = {
    biconditional: {
      name: 'Biconditional elimination', short: '⇔-elimination', law: 'α ⇔ β  ≡  (α ⇒ β) ∧ (β ⇒ α)',
      at: (f) => (f.t === 'iff' ? [And(Imp(f.l, f.r), Imp(f.r, f.l))] : []),
    },
    implication: {
      name: 'Implication elimination', short: '⇒-elimination', law: 'α ⇒ β  ≡  ¬α ∨ β',
      at: (f) => (f.t === 'imp' ? [Or(Not(f.l), f.r)] : []),
    },
    demorgan: {
      name: 'De Morgan', short: 'De Morgan', law: '¬(α ∧ β) ≡ ¬α ∨ ¬β ;  ¬(α ∨ β) ≡ ¬α ∧ ¬β',
      at: (f) => (f.t === 'not' && f.a.t === 'and' ? [Or(...f.a.args.map(Not))] : f.t === 'not' && f.a.t === 'or' ? [And(...f.a.args.map(Not))] : []),
    },
    doubleneg: {
      name: 'Double-negation elimination', short: '¬¬-elimination', law: '¬¬α ≡ α',
      at: (f) => (f.t === 'not' && f.a.t === 'not' ? [f.a.a] : []),
    },
    distribution: {
      name: 'Distribution of ∨ over ∧', short: 'Distribution', law: 'α ∨ (β ∧ γ)  ≡  (α ∨ β) ∧ (α ∨ γ)',
      at: (f) => {
        if (f.t !== 'or') return [];
        const out = []; const args = flat(f).args;
        args.forEach((a, i) => {
          if (a.t !== 'and') return;
          out.push(And(...a.args.map((x) => mk('or', args.map((y, j) => (j === i ? x : y))))));   // keep the student's order
        });
        return out;
      },
    },
    contraposition: {
      name: 'Contraposition', short: 'Contraposition', law: 'α ⇒ β  ≡  ¬β ⇒ ¬α',
      at: (f) => (f.t === 'imp' ? [Imp(Not(f.r), Not(f.l))] : []),
    },
    simplify: {
      name: 'Simplification', short: 'Simplify', law: 'α ∨ α ≡ α ;  (α ∨ ¬α ∨ …) ≡ ⊤ and is dropped from a conjunction ;  α ∧ ⊤ ≡ α',
      at: (f) => {
        if (f.t !== 'and' && f.t !== 'or') return [];
        const fl = flat(f); const out = [];
        // idempotence
        const seen = new Map(); fl.args.forEach((a) => seen.set(key(a), a));
        if (seen.size < fl.args.length) out.push(mk(f.t, [...seen.values()]));
        if (f.t === 'or') { // tautology  P ∨ ¬P ∨ … ≡ ⊤
          const ks = new Set(fl.args.map(key));
          if (fl.args.some((a) => ks.has(key(Not(a))) || (a.t === 'not' && ks.has(key(a.a))))) out.push(C(true));
        }
        if (f.t === 'and') { // drop tautological clauses / ⊤
          const keep = fl.args.filter((a) => !(a.t === 'const' && a.v) && !(a.t === 'or' && valid(a)));
          if (keep.length < fl.args.length && keep.length) out.push(mk('and', keep));
        }
        return out;
      },
    },
  };
  // Common mistakes (IDEAS "buggy rules"): each produces a NON-equivalent line and a precise explanation.
  const BUGGY = [
    { id: 'demorgan-noflip', msg: 'De Morgan: when ¬ moves inside, ∧ must flip to ∨ (and ∨ to ∧). You kept the same connective.',
      at: (f) => (f.t === 'not' && (f.a.t === 'and' || f.a.t === 'or') ? [{ t: f.a.t, args: f.a.args.map(Not) }] : []) },
    { id: 'demorgan-nonegate', msg: 'De Morgan: the connective flips AND every part gets a ¬. One part lost its negation.',
      at: (f) => (f.t === 'not' && (f.a.t === 'and' || f.a.t === 'or') ? f.a.args.map((_, i) => ({ t: f.a.t === 'and' ? 'or' : 'and', args: f.a.args.map((x, j) => (j === i ? x : Not(x))) })) : []) },
    { id: 'imp-wrong-side', msg: 'Implication elimination negates the LEFT side: α ⇒ β ≡ ¬α ∨ β (not α ∨ ¬β).',
      at: (f) => (f.t === 'imp' ? [Or(f.l, Not(f.r))] : []) },
    { id: 'imp-as-and', msg: 'α ⇒ β becomes ¬α ∨ β — a disjunction, not a conjunction.',
      at: (f) => (f.t === 'imp' ? [And(Not(f.l), f.r)] : []) },
    { id: 'imp-nonegate', msg: 'α ⇒ β ≡ ¬α ∨ β. You dropped the ¬ on α (α ∨ β is not equivalent).',
      at: (f) => (f.t === 'imp' ? [Or(f.l, f.r)] : []) },
    { id: 'converse', msg: 'That is the CONVERSE (β ⇒ α). It is not equivalent to α ⇒ β. The equivalent swap is the contrapositive ¬β ⇒ ¬α.',
      at: (f) => (f.t === 'imp' ? [Imp(f.r, f.l)] : []) },
    { id: 'contra-half', msg: 'Contraposition negates BOTH sides and swaps them: α ⇒ β becomes ¬β ⇒ ¬α. You negated only one side (or did not swap).',
      at: (f) => (f.t === 'imp' ? [Imp(f.l, Not(f.r)), Imp(Not(f.r), f.l), Imp(f.r, Not(f.l)), Imp(Not(f.l), f.r)] : []) },
    { id: 'inverse', msg: 'That is the INVERSE (¬α ⇒ ¬β). Not equivalent. Contraposition swaps the sides as well: ¬β ⇒ ¬α.',
      at: (f) => (f.t === 'imp' ? [Imp(Not(f.l), Not(f.r))] : []) },
    { id: 'neg-imp', msg: '¬(α ⇒ β) is α ∧ ¬β (eliminate ⇒ first, then De Morgan) — not ¬α ⇒ ¬β.',
      at: (f) => (f.t === 'not' && f.a.t === 'imp' ? [Imp(Not(f.a.l), Not(f.a.r)), Or(Not(f.a.l), Not(f.a.r))] : []) },
    { id: 'bicond-or', msg: 'α ⇔ β is (α ⇒ β) ∧ (β ⇒ α): BOTH directions must hold, so it is ∧, not ∨.',
      at: (f) => (f.t === 'iff' ? [Or(Imp(f.l, f.r), Imp(f.r, f.l))] : []) },
    { id: 'bicond-half', msg: 'You kept only one direction of the ⇔. α ⇔ β needs both α ⇒ β and β ⇒ α.',
      at: (f) => (f.t === 'iff' ? [Imp(f.l, f.r), Imp(f.r, f.l)] : []) },
    { id: 'distr-drop', msg: 'Distribution: α ∨ (β ∧ γ) ≡ (α ∨ β) ∧ (α ∨ γ). α has to go into EVERY conjunct.',
      at: (f) => {
        if (f.t !== 'or') return []; const args = flat(f).args, out = [];
        for (const [a, rest] of subsetsSplit(args)) { if (a.t !== 'and' || a.args.length < 2) continue; const r = mk('or', rest); out.push(And(Or(r, a.args[0]), ...a.args.slice(1))); }
        return out;
      } },
    { id: 'distr-wrong-op', msg: 'Distribution keeps the operators in place: α ∨ (β ∧ γ) ≡ (α ∨ β) ∧ (α ∨ γ). You swapped ∧ and ∨.',
      at: (f) => {
        if (f.t !== 'or') return []; const args = flat(f).args, out = [];
        for (const [a, rest] of subsetsSplit(args)) { if (a.t !== 'and') continue; const r = mk('or', rest); out.push(Or(...a.args.map((x) => And(r, x)))); }
        return out;
      } },
  ];

  // apply node-rule `at` at exactly one position anywhere in f → list of results
  function rewriteOnce(f, at) {
    const out = at(f).slice();
    switch (f.t) {
      case 'not': for (const a of rewriteOnce(f.a, at)) out.push(Not(a)); break;
      case 'imp': for (const a of rewriteOnce(f.l, at)) out.push(Imp(a, f.r)); for (const b of rewriteOnce(f.r, at)) out.push(Imp(f.l, b)); break;
      case 'iff': for (const a of rewriteOnce(f.l, at)) out.push(Iff(a, f.r)); for (const b of rewriteOnce(f.r, at)) out.push(Iff(f.l, b)); break;
      case 'and': case 'or':
        f.args.forEach((x, i) => { for (const y of rewriteOnce(x, at)) out.push({ t: f.t, args: f.args.map((z, j) => (j === i ? y : z)) }); });
        break;
    }
    return out;
  }
  // apply rule at ALL positions, outermost first (one "pass") — the line a hint shows
  function rewriteEverywhere(f, at) {
    const r = at(f);
    if (r.length) return rewriteEverywhere(r[0], at);
    switch (f.t) {
      case 'not': return Not(rewriteEverywhere(f.a, at));
      case 'imp': return Imp(rewriteEverywhere(f.l, at), rewriteEverywhere(f.r, at));
      case 'iff': return Iff(rewriteEverywhere(f.l, at), rewriteEverywhere(f.r, at));
      case 'and': case 'or': return flat({ t: f.t, args: f.args.map((a) => rewriteEverywhere(a, at)) });
      default: return f;
    }
  }
  // BFS: can `to` be reached from `from` using only rules in `ruleIds`, at most `depth` single applications?
  function reach(from, to, ruleIds, depth, limit) {
    const target = key(to); limit = limit || 4000;
    let frontier = [{ f: flat(from), path: [] }]; const seen = new Set([key(from)]);
    if (seen.has(target)) return [];
    for (let d = 0; d < depth; d++) {
      const next = [];
      for (const { f, path } of frontier) {
        for (const id of ruleIds) {
          const at = RULES[id] ? RULES[id].at : id.at;
          for (const g0 of rewriteOnce(f, at)) {
            const g = flat(g0), k = key(g);
            if (seen.has(k)) continue; seen.add(k);
            const p2 = path.concat(id);
            if (k === target) return p2;
            next.push({ f: g, path: p2 });
            if (seen.size > limit) return null;
          }
        }
      }
      frontier = next;
    }
    return null;
  }

  // ───────────────────────────── CNF strategy (AIMA to_cnf) + diagnosis of a rewrite step ─────────────────────────────
  // Strategy order (AIMA §7.5.2): ⇔ → ⇒ → push ¬ in → distribute → simplify
  function cnfNextRule(f) {
    f = flat(f);
    if (hasT(f, 'iff')) return 'biconditional';
    if (hasT(f, 'imp')) return 'implication';
    if (negNotInward(f)) return rewriteOnce(f, RULES.doubleneg.at).length ? 'doubleneg' : 'demorgan';
    if (orOverAnd(f)) return 'distribution';
    if (rewriteOnce(f, RULES.simplify.at).length) return 'simplify';
    return null;
  }
  function cnfNextLine(f) {
    const r = cnfNextRule(f); if (!r) return null;
    if (r === 'simplify') { const c = rewriteOnce(flat(f), RULES.simplify.at)[0]; return { rule: r, f: flat(c) }; }
    return { rule: r, f: flat(rewriteEverywhere(flat(f), RULES[r].at)) };
  }
  function toCNF(f) { // full AIMA pipeline with a trace
    const trace = []; let g = flat(f), guard = 0;
    for (;;) { const n = cnfNextLine(g); if (!n || ++guard > 60) break; trace.push(n); g = n.f; }
    return { f: g, trace };
  }

  // Diagnose a rewrite step prev → next with the student's claimed rule (IDEAS diagnose).
  // verdict: 'correct' | 'combined' | 'wrongrule' | 'detour' | 'equivalent' | 'buggy' | 'notequiv'
  function diagnoseRewrite(prev, next, claimed, opts) {
    opts = opts || {};
    prev = flat(prev); next = flat(next);
    const allowed = opts.rules || Object.keys(RULES);
    if (same(prev, next)) return { verdict: 'nochange', ok: false, msg: 'This line is the same as the previous one (up to the order of terms). Apply a rule to change it.' };
    let eq; try { eq = equivalent(prev, next); } catch (e) { eq = null; }
    if (eq === false) {
      for (const b of BUGGY) if (reach(prev, next, [b], 1)) return { verdict: 'buggy', ok: false, msg: b.msg, bug: b.id };
      // buggy rule after one correct step (e.g. ⇒-elim then a bad De Morgan) — only after every direct match failed
      for (const b of BUGGY) for (const id of allowed) for (const g of rewriteOnce(prev, RULES[id].at)) if (reach(g, next, [b], 1)) return { verdict: 'buggy', ok: false, msg: b.msg, bug: b.id };
      return { verdict: 'notequiv', ok: false, msg: 'This line is NOT equivalent to the previous one — some truth assignment makes one true and the other false.', counter: counterexample(prev, next) };
    }
    if (claimed && RULES[claimed]) {
      const p = reach(prev, next, [claimed], opts.sameRuleDepth || 6);
      if (p) {
        const detour = opts.track === 'cnf' && claimed !== cnfNextRule(prev) && !(claimed === 'simplify' || claimed === 'doubleneg');
        if (detour && (claimed === 'distribution' || opts.strictOrder)) return { verdict: 'detour', ok: true, rule: claimed, msg: `Correct ${RULES[claimed].name} — but the CNF recipe would do ${RULES[cnfNextRule(prev)].name} first. Fine, just keep going.` };
        return { verdict: 'correct', ok: true, rule: claimed, msg: `Correct ${RULES[claimed].name}${p.length > 1 ? ` (applied ${p.length}×)` : ''}.` };
      }
    }
    // equivalent: find which rule(s) were actually used
    for (const id of allowed) { const p = reach(prev, next, [id], 6); if (p) return claimed ? { verdict: 'wrongrule', ok: true, rule: id, msg: `The line is right, but the rule is ${RULES[id].name}, not ${RULES[claimed] ? RULES[claimed].name : claimed}.` } : { verdict: 'correct', ok: true, rule: id, msg: `Correct: ${RULES[id].name}.` }; }
    const p = reach(prev, next, allowed, 3, 6000);
    if (p) { const names = [...new Set(p)].map((id) => RULES[id].name); return { verdict: 'combined', ok: true, rules: p, msg: `Correct — you combined ${p.length} steps (${names.join(' → ')}). In an exam, write them as separate lines.` }; }
    return { verdict: 'equivalent', ok: true, msg: 'Equivalent — but I can’t see which rule takes you there in one or two steps. Write a smaller step so each line uses one law.' };
  }
  function counterexample(a, b) {
    let found = null;
    try { models([a, b], (m) => { if (evalF(a, m) !== evalF(b, m)) { found = Object.assign({}, m); return false; } return true; }); } catch (e) { }
    return found;
  }

  // ───────────────────────────── clauses + resolution (AIMA PL-RESOLUTION) ─────────────────────────────
  // clause = array of {s, neg}, normalised & sorted. Empty clause [] = □.
  function clauseOf(f) { // f must be a clause (literal or disjunction of literals) or ⊥ / □
    f = flat(f);
    if (f.t === 'const' && !f.v) return [];
    const lits = isLit(f) ? [f] : f.t === 'or' && f.args.every(isLit) ? f.args : null;
    if (!lits) return null;
    return normClause(lits.map((l) => (l.t === 'var' ? { s: l.n, neg: false } : { s: l.a.n, neg: true })));
  }
  function normClause(c) {
    const m = new Map(); for (const l of c) m.set((l.neg ? '-' : '+') + l.s, l);
    return [...m.values()].sort((a, b) => (a.s === b.s ? (a.neg ? 1 : -1) : a.s < b.s ? -1 : 1));
  }
  const clauseKey = (c) => c.map((l) => (l.neg ? '-' : '+') + l.s).join(' ') || '□';
  const clauseText = (c) => (c.length ? c.map((l) => (l.neg ? '¬' : '') + prettyName(l.s)).join(' ∨ ') : '□');
  const isTaut = (c) => c.some((l) => c.some((k) => k.s === l.s && k.neg !== l.neg));
  const clauseFormula = (c) => (c.length ? mk('or', c.map((l) => (l.neg ? Not(V(l.s)) : V(l.s)))) : C(false));
  function cnfClauses(f) { const g = toCNF(f).f; const parts = g.t === 'and' ? flat(g).args : [g]; return parts.map(clauseOf).filter((c) => c && !isTaut(c)); }
  // all resolvents of two clauses (one per complementary pair) — AIMA pl_resolve
  function resolvents(ci, cj) {
    const out = [];
    for (const a of ci) for (const b of cj) if (a.s === b.s && a.neg !== b.neg) {
      out.push({ on: a.s, c: normClause([...ci.filter((x) => x !== a), ...cj.filter((x) => x !== b)]) });
    }
    return out;
  }
  // student says: resolve ci with cj → c
  function checkResolution(ci, cj, c) {
    const rs = resolvents(ci, cj), k = clauseKey(c);
    if (!rs.length) return { ok: false, msg: 'These two clauses have no complementary pair (P in one and ¬P in the other) — they cannot be resolved.' };
    const hit = rs.find((r) => clauseKey(r.c) === k);
    if (hit) {
      if (rs.length > 1 && hit.c.length) return { ok: true, taut: true, msg: `Valid resolution on ${prettyName(hit.on)} — but these clauses clash on more than one symbol, so every resolvent is a tautology (useless). Pick a different pair.` };
      return { ok: true, on: hit.on, msg: hit.c.length ? `Correct: resolved on ${prettyName(hit.on)}.` : `□ — the empty clause! KB ∧ ¬α is unsatisfiable, so KB ⊨ α.` };
    }
    // classic error: cancelling two complementary pairs at once
    const both = normClause([...ci, ...cj].filter((l) => !(ci.concat(cj)).some((x) => x.s === l.s && x.neg !== l.neg)));
    if (rs.length > 1 && clauseKey(both) === k) return { ok: false, bug: 'two-pairs', msg: 'You cancelled TWO complementary pairs at once. Resolution removes exactly ONE pair per step; with two clashing pairs the result is always a tautology (useless), never □.' };
    return { ok: false, msg: `That is not the resolvent. Resolving on ${prettyName(rs[0].on)} gives ${clauseText(rs[0].c)}.`, expected: clauseText(rs[0].c) };
  }
  // AIMA PL-RESOLUTION with parent tracking → a refutation proof (list of steps ending in □), or null
  function refute(clauses, maxNew) {
    maxNew = maxNew || 4000;
    const all = []; const idx = new Map();
    const add = (c, from) => { const k = clauseKey(c); if (idx.has(k) || isTaut(c)) return null; idx.set(k, all.length); all.push({ c, from }); return all.length - 1; };
    clauses.forEach((c) => add(c, null));
    if (idx.has('□')) return [];
    for (let round = 0; round < 12; round++) {
      const n = all.length; let added = false;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        for (const r of resolvents(all[i].c, all[j].c)) {
          const id = add(r.c, [i, j, r.on]); if (id === null) continue; added = true;
          if (!r.c.length) return extractProof(all, id);
          if (all.length > maxNew) return null;
        }
      }
      if (!added) return null;
    }
    return null;
  }
  function extractProof(all, id) {
    const need = new Set(); const st = [id];
    while (st.length) { const k = st.pop(); if (need.has(k) || !all[k].from) continue; need.add(k); st.push(all[k].from[0], all[k].from[1]); }
    return [...need].sort((a, b) => a - b).map((k) => ({ a: all[all[k].from[0]].c, b: all[all[k].from[1]].c, on: all[k].from[2], c: all[k].c }));
  }

  // ───────────────────────────── natural-deduction style inference rules (AIMA §7.5.1) ─────────────────────────────
  // check(rule, premises[], conclusion) → true if conclusion follows from the cited premises BY THAT RULE (syntactically)
  const conj = (f) => (flat(f).t === 'and' ? flat(f).args : [flat(f)]);
  const disj = (f) => (flat(f).t === 'or' ? flat(f).args : [flat(f)]);
  const negOf = (f) => (f.t === 'not' ? f.a : Not(f));
  const INFER = {
    mp: { name: 'Modus Ponens', law: 'α ⇒ β, α  ⊢  β', n: 2,
      check: (ps, c) => ps.some((p) => p.t === 'imp' && same(p.r, c) && ps.some((q) => q !== p && same(q, p.l))) },
    mt: { name: 'Modus Tollens', law: 'α ⇒ β, ¬β  ⊢  ¬α', n: 2,
      check: (ps, c) => ps.some((p) => p.t === 'imp' && same(negOf(p.l), c) && ps.some((q) => q !== p && same(q, negOf(p.r)))) },
    andelim: { name: 'And-Elimination', law: 'α ∧ β  ⊢  α', n: 1,
      check: (ps, c) => ps.some((p) => flat(p).t === 'and' && conj(p).some((x) => same(x, c) || (flat(c).t === 'and' && conj(c).every((y) => conj(p).some((z) => same(z, y)))))) },
    andintro: { name: 'And-Introduction', law: 'α, β  ⊢  α ∧ β', n: 2,
      check: (ps, c) => flat(c).t === 'and' && conj(c).every((x) => ps.some((p) => same(p, x) || conj(p).some((y) => same(y, x)))) },
    unitres: { name: 'Unit Resolution', law: 'ℓ₁ ∨ … ∨ ℓₖ, ¬ℓᵢ  ⊢  ℓ₁ ∨ … ∨ ℓᵢ₋₁ ∨ ℓᵢ₊₁ ∨ … ∨ ℓₖ', n: 2,
      check: (ps, c) => ps.some((p) => { const d = disj(p); return d.length > 1 && ps.some((q) => q !== p && isLit(q) && d.some((x) => same(x, negOf(q)) && same(mk('or', d.filter((y) => !same(y, x))), c))); }) },
    resolution: { name: 'Resolution', law: 'α ∨ β, ¬β ∨ γ  ⊢  α ∨ γ', n: 2,
      check: (ps, c) => { if (ps.length !== 2) return false; const a = clauseOf(ps[0]), b = clauseOf(ps[1]), cc = clauseOf(c); return !!(a && b && cc) && resolvents(a, b).some((r) => clauseKey(r.c) === clauseKey(cc)); } },
  };
  // equivalence rules used on a single cited line in a proof
  const EQUIV_IN_PROOF = ['biconditional', 'implication', 'demorgan', 'doubleneg', 'contraposition', 'distribution'];
  const BUGGY_INFER = [
    { id: 'affirm-consequent', msg: 'Affirming the consequent: from α ⇒ β and β you can NOT conclude α (β may be true for another reason). Not a valid rule.',
      hit: (ps, c) => ps.some((p) => p.t === 'imp' && same(p.l, c) && ps.some((q) => q !== p && same(q, p.r))) },
    { id: 'deny-antecedent', msg: 'Denying the antecedent: from α ⇒ β and ¬α you can NOT conclude ¬β. Not a valid rule (Modus Tollens goes the other way: ¬β gives ¬α).',
      hit: (ps, c) => ps.some((p) => p.t === 'imp' && same(negOf(p.r), c) && ps.some((q) => q !== p && same(q, negOf(p.l)))) },
    { id: 'or-elim', msg: 'From α ∨ β alone you cannot conclude α — either one could be the true one. You need ¬β too (Unit Resolution).',
      hit: (ps, c) => ps.length === 1 && flat(ps[0]).t === 'or' && disj(ps[0]).some((x) => same(x, c)) },
  ];
  // Diagnose one proof line: {f, rule, cites:[formulas]} against the full KB (all earlier lines)
  function diagnoseInference(line, cited, kbAll) {
    const c = flat(line.f), ps = cited.map(flat), rule = line.rule;
    if (!ps.length && rule !== 'premise') return { ok: false, verdict: 'nocite', msg: 'Cite the line number(s) this step comes from.' };
    let fromCited = null; try { fromCited = entails(ps, c); } catch (e) { }
    if (INFER[rule]) {
      if (INFER[rule].check(ps, c)) return { ok: true, verdict: 'correct', msg: `Correct ${INFER[rule].name}.` };
    } else if (RULES[rule]) {
      if (ps.length === 1 && reach(ps[0], c, [rule], 6)) return { ok: true, verdict: 'correct', msg: `Correct ${RULES[rule].name}.` };
    }
    for (const b of BUGGY_INFER) if (b.hit(ps, c) && fromCited === false) return { ok: false, verdict: 'buggy', bug: b.id, msg: b.msg };
    // a mis-applied equivalence law on one cited line: name the exact mistake (De Morgan without flipping, half contrapositive…)
    if (fromCited === false && ps.length === 1) for (const b of BUGGY) if (reach(ps[0], c, [b], 1)) return { ok: false, verdict: 'buggy', bug: b.id, msg: b.msg };
    if (fromCited) { // sound, but not by the named rule — find the real one
      for (const [id, r] of Object.entries(INFER)) if (r.check(ps, c)) return { ok: true, verdict: 'wrongrule', rule: id, msg: `The line follows, but by ${r.name}, not ${ruleName(rule)}.` };
      for (const id of EQUIV_IN_PROOF) if (ps.length === 1 && reach(ps[0], c, [id], 6)) return { ok: true, verdict: 'wrongrule', rule: id, msg: `The line follows, but by ${RULES[id].name}, not ${ruleName(rule)}.` };
      return { ok: true, verdict: 'combined', msg: `It does follow from the cited lines, but not in one ${ruleName(rule)} step — split it into single-rule steps.` };
    }
    let fromKB = null; try { fromKB = entails(kbAll.map(flat), c); } catch (e) { }
    if (fromKB) return { ok: false, verdict: 'wrongcite', msg: 'The sentence is true given the KB, but it does not follow from the lines you cited. Check the line numbers.' };
    return { ok: false, verdict: 'unsound', msg: 'This does not follow — it is not entailed by the knowledge base.' };
  }
  const ruleName = (id) => (INFER[id] ? INFER[id].name : RULES[id] ? RULES[id].name : id);

  // one-step forward expansion for proof hints: all conclusions reachable from `lines` by one rule
  function proofSuccessors(lines) {
    const out = []; const L = lines.map(flat);
    const push = (f, rule, cites) => out.push({ f: flat(f), rule, cites });
    L.forEach((p, i) => {
      if (p.t === 'and') p.args.forEach((x) => push(x, 'andelim', [i]));
      for (const id of EQUIV_IN_PROOF) for (const g of RULES[id].at(p)) push(g, id, [i]);
      if (p.t === 'not' && (p.a.t === 'and' || p.a.t === 'or')) for (const g of RULES.demorgan.at(p)) push(g, 'demorgan', [i]);
      L.forEach((q, j) => {
        if (i === j) return;
        if (p.t === 'imp' && same(q, p.l)) push(p.r, 'mp', [i, j]);
        if (p.t === 'imp' && same(q, negOf(p.r))) push(negOf(p.l), 'mt', [i, j]);
        if (p.t === 'imp' && p.l.t === 'and' && i < j) { // And-Introduction, only when it unlocks an implication
          const parts = p.l.args.map((x) => L.findIndex((y) => same(y, x)));
          if (parts.every((k) => k >= 0) && parts.includes(j)) push(p.l, 'andintro', [...new Set(parts)]);
        }
        if (i < j && p.t === 'or' && (q.t === 'or') && isClause(p) && isClause(q)) { // general resolution between two non-unit clauses
          const a = clauseOf(p), b = clauseOf(q);
          if (a && b) { const rs = resolvents(a, b); if (rs.length === 1 && !isTaut(rs[0].c)) push(clauseFormula(rs[0].c), 'resolution', [i, j]); }
        }
        if (p.t === 'or' && isLit(q)) { const d = disj(p); const x = d.find((y) => same(y, negOf(q))); if (x) push(mk('or', d.filter((y) => !same(y, x))), 'unitres', [i, j]); }
      });
    });
    return out;
  }
  // BFS to the goal → first step of a shortest proof (by this rule set)
  function proofHint(lines, goal, maxDepth) {
    maxDepth = maxDepth || 5; const g = key(flat(goal));
    if (lines.some((l) => key(flat(l)) === g)) return { done: true };
    let frontier = [{ lines: lines.map(flat), first: null }]; const seen = new Set([lines.map((l) => key(flat(l))).sort().join('|')]);
    for (let d = 0; d < maxDepth; d++) {
      const next = [];
      for (const st of frontier) {
        const have = new Set(st.lines.map(key));
        for (const s of proofSuccessors(st.lines)) {
          const k = key(s.f); if (have.has(k) || size(s.f) > 14) continue;
          const first = st.first || s;
          if (k === g) return { first, depth: d + 1 };
          const nl = st.lines.concat(s.f); const sk = nl.map(key).sort().join('|');
          if (seen.has(sk)) continue; seen.add(sk); next.push({ lines: nl, first });
          if (seen.size > 20000) return null;
        }
      }
      frontier = next;
    }
    return null;
  }

  // ───────────────────────────── definite clauses: forward / backward chaining (AIMA PL-FC-ENTAILS, Fig 7.15) ─────────────────────────────
  // rule = {id, body:[symbols], head:symbol}; a fact is a rule with empty body.
  function parseDefinite(src) {
    const f = flat(parse(src));
    if (f.t === 'var') return { body: [], head: f.n };
    if (f.t === 'imp' && f.r.t === 'var') {
      const b = flat(f.l); const body = b.t === 'var' ? [b.n] : b.t === 'and' && b.args.every((a) => a.t === 'var') ? b.args.map((a) => a.n) : null;
      if (body) return { body, head: f.r.n };
    }
    throw new SyntaxError('A definite clause is a fact (P) or a rule with one positive head: A ∧ B ⇒ C.');
  }
  const ruleText = (r) => (r.body.length ? r.body.map(prettyName).join(' ∧ ') + ' ⇒ ' + prettyName(r.head) : prettyName(r.head));
  // AIMA agenda-based FC with a trace of rule firings
  function fcTrace(rules, q) {
    const count = rules.map((r) => r.body.length), inferred = new Set(), agenda = rules.filter((r) => !r.body.length).map((r) => r.head);
    const trace = [];
    while (agenda.length) {
      const p = agenda.shift();
      if (inferred.has(p)) continue; inferred.add(p);
      if (p === q) return { entailed: true, trace, inferred };
      rules.forEach((r, i) => { if (r.body.includes(p)) { count[i]--; if (count[i] === 0) { trace.push({ rule: i, head: r.head }); agenda.push(r.head); } } });
    }
    return { entailed: inferred.has(q), trace, inferred };
  }
  function fcClosure(rules) { const known = new Set(rules.filter((r) => !r.body.length).map((r) => r.head)); let ch = true; while (ch) { ch = false; for (const r of rules) if (!known.has(r.head) && r.body.every((b) => known.has(b))) { known.add(r.head); ch = true; } } return known; }
  // student fires rule i to infer head h given the currently known set
  function checkFire(rules, known, i, h) {
    const r = rules[i]; if (!r) return { ok: false, msg: 'There is no such rule number.' };
    if (!r.body.length) return { ok: false, msg: 'That is a fact, not a rule — facts are already known at the start.' };
    if (r.head !== h) return { ok: false, msg: `Rule ${i + 1} concludes ${prettyName(r.head)}, not ${prettyName(h)}.` };
    const missing = r.body.filter((b) => !known.has(b));
    if (missing.length) return { ok: false, msg: `Rule ${i + 1} cannot fire yet: ${missing.map(prettyName).join(', ')} ${missing.length > 1 ? 'are' : 'is'} not known. Its count is ${missing.length}, not 0.` };
    if (known.has(h)) return { ok: true, redundant: true, msg: `${prettyName(h)} was already known — firing again adds nothing (FC skips inferred symbols).` };
    return { ok: true, msg: `Correct: every premise of rule ${i + 1} is known, so ${prettyName(h)} is added to the agenda.` };
  }
  // backward chaining: is the goal provable, and which rules for a goal lead to success (avoids loops)?
  function bcProvable(rules, goal) { return fcClosure(rules).has(goal); }
  function bcGoodRules(rules, goal) { const known = fcClosure(rules); return rules.map((r, i) => ({ r, i })).filter(({ r }) => r.head === goal && r.body.every((b) => known.has(b))).map(({ i }) => i); }

  return {
    V, C, Not, And, Or, Imp, Iff,
    parse, tryParse, show, prettyName, flat, key, same, symbols, size,
    evalF, entails, equivalent, satisfiable, valid, counterexample, countermodel, MAX_SYMS,
    isLit, isClause, isCNF, RULES, BUGGY, rewriteOnce, rewriteEverywhere, reach,
    cnfNextRule, cnfNextLine, toCNF, diagnoseRewrite,
    clauseOf, clauseKey, clauseText, clauseFormula, isTaut, cnfClauses, resolvents, checkResolution, refute,
    INFER, EQUIV_IN_PROOF, ruleName, diagnoseInference, proofSuccessors, proofHint,
    parseDefinite, ruleText, fcTrace, fcClosure, checkFire, bcProvable, bcGoodRules,
  };
});
