/* Logic Lab — First-Order Logic core for the "English ⇄ FOL" section (PECST522 Module 3, KTU 2024).
 *
 * Deterministic, in-browser, offline. Nothing external is required.
 *
 * Research verdict (why this is hand-built and not a library):
 *   • GF / Boxer+C&C / NLTK logic / Prover9+Mace4 / Stanford Epilog all need a Python/Java/Prolog runtime and are
 *     not free CORS-callable hosted services. Z3-WASM and a Mace4-WASM port exist but add megabytes of payload for a
 *     problem that is, in general, undecidable — overkill for a classroom tool.
 *   • FOL equivalence over a FIXED, SMALL finite domain is decidable by enumeration — this is exactly Mace4's
 *     finite-model idea. Implemented directly in JS it is a few kB, works offline, and is deterministic. That is what
 *     the practice checker uses.
 *   • Parsing, pretty-printing and FOL → English are done deterministically here; only English → FOL needs natural
 *     language, which goes to the NVIDIA relay and is then VALIDATED by this parser plus a back-translation.
 *
 * AST:
 *   term:   {t:'var', n} | {t:'const', n} | {t:'fun', n, args:[term]}
 *   atom:   {t:'pred', n, args:[term]} | {t:'eq', l:term, r:term}
 *   formula: atom
 *          | {t:'not', a}
 *          | {t:'and'|'or', args:[formula]}
 *          | {t:'imp'|'iff', l, r}
 *          | {t:'all'|'ex', v:string, body:formula}
 *
 * Variables are lowercase single letters (x, y, z, …) by convention; constants are capitalised names (John, Mary);
 * predicates/functions are Capitalised names with arguments: Loves(x, y), FatherOf(John).
 * Works in the browser (window.FOLCore) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FOLCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ───────────────────────────── tokenizer ─────────────────────────────
  // Accepts Unicode and ASCII: ∀ forall all / ∃ exists some ; ¬ ~ ! not ; ∧ & and ; ∨ | or ;
  // ⇒ → -> => implies ; ⇔ ↔ <-> <=> iff ; = equals.
  function tokenize(src) {
    const s = String(src).replace(/\s+/g, ' ').trim();
    const out = []; let i = 0;
    const three = { '<->': 'iff', '<=>': 'iff' };
    const two = { '->': 'imp', '=>': 'imp' };
    while (i < s.length) {
      const c = s[i];
      if (c === ' ') { i++; continue; }
      if (three[s.substr(i, 3)]) { out.push({ k: three[s.substr(i, 3)] }); i += 3; continue; }
      if (two[s.substr(i, 2)]) { out.push({ k: two[s.substr(i, 2)] }); i += 2; continue; }
      if ('∀'.includes(c)) { out.push({ k: 'all' }); i++; continue; }
      if ('∃'.includes(c)) { out.push({ k: 'ex' }); i++; continue; }
      if ('¬~!'.includes(c)) { out.push({ k: 'not' }); i++; continue; }
      if ('∧&^'.includes(c)) { out.push({ k: 'and' }); i++; continue; }
      if ('∨|'.includes(c)) { out.push({ k: 'or' }); i++; continue; }
      if ('⇒→⊃'.includes(c)) { out.push({ k: 'imp' }); i++; continue; }
      if ('⇔↔≡'.includes(c)) { out.push({ k: 'iff' }); i++; continue; }
      if ('([{'.includes(c)) { out.push({ k: '(' }); i++; continue; }
      if (')]}'.includes(c)) { out.push({ k: ')' }); i++; continue; }
      if ('[]'.includes(c)) { out.push({ k: c === '[' ? '(' : ')' }); i++; continue; } // [...] as grouping (slides use it)
      if (c === ',') { out.push({ k: ',' }); i++; continue; }
      if (c === '=') { out.push({ k: 'eq' }); i++; continue; }
      if (c === '.' || c === ':') { i++; continue; } // ∀x. P(x) and ∀x: P(x) — the dot/colon is optional sugar
      const m = /^[A-Za-z][A-Za-z0-9_]*/.exec(s.slice(i));
      if (m) {
        let w = m[0]; i += w.length; const lw = w.toLowerCase();
        if (lw === 'forall' || lw === 'all') { out.push({ k: 'all' }); continue; }
        if (lw === 'exists' || lw === 'some') { out.push({ k: 'ex' }); continue; }
        if (lw === 'not') { out.push({ k: 'not' }); continue; }
        if (lw === 'and') { out.push({ k: 'and' }); continue; }
        if (lw === 'or') { out.push({ k: 'or' }); continue; }
        if (lw === 'implies') { out.push({ k: 'imp' }); continue; }
        if (lw === 'iff') { out.push({ k: 'iff' }); continue; }
        out.push({ k: 'name', n: w }); continue;
      }
      throw new SyntaxError(`I can't read “${c}” (position ${i + 1}).`);
    }
    return out;
  }
  const isVarName = (n) => /^[a-z][0-9]?$/.test(n); // x, y, z, x1 — a lowercase short name is a variable

  // ───────────────────────────── parser ─────────────────────────────
  // precedence: quantifier binds loosest to the right; ¬ > ∧ > ∨ > ⇒ > ⇔ ; ⇒/⇔ right-assoc (AIMA Fig 8.3)
  function parse(src) {
    const toks = tokenize(src); let p = 0;
    if (!toks.length) throw new SyntaxError('Empty formula.');
    const peek = () => toks[p], eat = (k) => { if (toks[p] && toks[p].k === k) { p++; return true; } return false; };
    const expect = (k, m) => { if (!eat(k)) throw new SyntaxError(m); };

    function formula() { return iff(); }
    function iff() { const l = imp(); if (eat('iff')) return { t: 'iff', l, r: iff() }; return l; }
    function imp() { const l = orF(); if (eat('imp')) return { t: 'imp', l, r: imp() }; return l; }
    function orF() { const a = [andF()]; while (eat('or')) a.push(andF()); return a.length === 1 ? a[0] : { t: 'or', args: a }; }
    function andF() { const a = [unary()]; while (eat('and')) a.push(unary()); return a.length === 1 ? a[0] : { t: 'and', args: a }; }
    function unary() {
      if (eat('not')) return { t: 'not', a: unary() };
      const t = peek();
      if (!t) throw new SyntaxError('The formula ends too early.');
      if (t.k === 'all' || t.k === 'ex') {
        p++; const kind = t.k;
        // one or more variables: ∀x, ∀x y, ∀x,y
        const vars = [];
        do {
          const vt = peek();
          if (!vt || vt.k !== 'name' || !isVarName(vt.n)) throw new SyntaxError(`A quantifier needs a variable (lowercase letter), found “${vt ? sym(vt) : 'end'}”.`);
          vars.push(vt.n); p++;
        } while (eat(','));
        const body = iff();
        let f = body; for (let k = vars.length - 1; k >= 0; k--) f = { t: kind, v: vars[k], body: f };
        return f;
      }
      if (t.k === '(') { p++; const e = formula(); expect(')', 'A bracket is not closed.'); return e; }
      return atom();
    }
    function atom() {
      const l = term();
      if (eat('eq')) return { t: 'eq', l, r: term() };
      if (l.t === 'pred') return l;
      if (l.t === 'const') return { t: 'pred', n: l.n, args: [] }; // a bare capitalised name used as a 0-ary predicate
      throw new SyntaxError(`Expected a predicate but found a ${l.t === 'var' ? 'variable' : 'term'} “${termStr(l)}”.`);
    }
    function term() {
      const t = peek();
      if (!t || t.k !== 'name') throw new SyntaxError(`Expected a term but found “${t ? sym(t) : 'end'}”.`);
      p++;
      if (eat('(')) {
        const args = [term()]; while (eat(',')) args.push(term());
        expect(')', `“${t.n}(…” is not closed.`);
        return isVarName(t.n) ? (() => { throw new SyntaxError(`“${t.n}” looks like a variable but is used as a function.`); })()
          : (/^[A-Z]/.test(t.n) ? { t: 'pred', n: t.n, args } : { t: 'fun', n: t.n, args });
      }
      return isVarName(t.n) ? { t: 'var', n: t.n } : { t: 'const', n: t.n };
    }
    const e = formula();
    if (p < toks.length) throw new SyntaxError(`Unexpected “${sym(toks[p])}” — is an operator or bracket missing?`);
    return e;
  }
  const sym = (t) => ({ all: '∀', ex: '∃', not: '¬', and: '∧', or: '∨', imp: '⇒', iff: '⇔', '(': '(', ')': ')', ',': ',', eq: '=', name: t.n }[t.k] || t.k);
  const termStr = (t) => (t.t === 'var' || t.t === 'const' ? t.n : t.n + '(' + t.args.map(termStr).join(', ') + ')');
  function tryParse(src) { try { return { ok: true, f: parse(src) }; } catch (e) { return { ok: false, error: e.message }; } }

  // predicate/function used as a term inside an atom: term() returns {t:'pred'} only at top of an atom call;
  // nested predicate-looking terms are coerced to functions here.
  function fixTerms(f) { // ensure arguments of predicates/functions are terms, not predicates
    const T = (x) => (x.t === 'pred' ? { t: 'fun', n: x.n, args: x.args.map(T) } : x.t === 'fun' ? { t: 'fun', n: x.n, args: x.args.map(T) } : x);
    const F = (g) => {
      switch (g.t) {
        case 'pred': return { t: 'pred', n: g.n, args: g.args.map(T) };
        case 'eq': return { t: 'eq', l: T(g.l), r: T(g.r) };
        case 'not': return { t: 'not', a: F(g.a) };
        case 'and': case 'or': return { t: g.t, args: g.args.map(F) };
        case 'imp': case 'iff': return { t: g.t, l: F(g.l), r: F(g.r) };
        case 'all': case 'ex': return { t: g.t, v: g.v, body: F(g.body) };
      }
      return g;
    };
    return F(f);
  }

  // ───────────────────────────── printing ─────────────────────────────
  const PREC = { iff: 1, imp: 2, or: 3, and: 4, not: 5, all: 5, ex: 5, pred: 6, eq: 6 };
  function showTerm(t) {
    if (t.t === 'var' || t.t === 'const') return t.n;
    return t.n + '(' + t.args.map(showTerm).join(', ') + ')';
  }
  function wrapQuant(inner, parent) {
    if (!parent) return inner;
    const pr = parent.replace('-l', '');
    // a quantifier binds loosest to the right, so bracket it whenever it is not the rightmost part of its parent:
    // as any operand of ¬/∧/∨, and as a left/non-final operand of ⇒/⇔.
    const need = parent === 'not' || pr === 'and' || pr === 'or'
      || ((pr === 'imp' || pr === 'iff') && parent.endsWith('-l'));
    return need ? '(' + inner + ')' : inner;
  }
  function show(f, parent) {
    let s;
    switch (f.t) {
      case 'pred': return f.n + (f.args.length ? '(' + f.args.map(showTerm).join(', ') + ')' : '');
      case 'eq': return showTerm(f.l) + ' = ' + showTerm(f.r);
      case 'not': return '¬' + show(f.a, 'not');
      case 'all': { const inner = '∀' + f.v + ' ' + show(f.body, 'all'); return wrapQuant(inner, parent); }
      case 'ex': { const inner = '∃' + f.v + ' ' + show(f.body, 'ex'); return wrapQuant(inner, parent); }
      case 'and': s = f.args.map((a) => show(a, 'and')).join(' ∧ '); break;
      case 'or': s = f.args.map((a) => show(a, 'or')).join(' ∨ '); break;
      case 'imp': s = show(f.l, 'imp-l') + ' ⇒ ' + show(f.r, 'imp'); break;
      case 'iff': s = show(f.l, 'iff-l') + ' ⇔ ' + show(f.r, 'iff'); break;
    }
    if (!parent) return s;
    const pr = parent.replace('-l', '');
    const need = PREC[f.t] < PREC[pr]
      || (parent === 'not' && !['pred', 'eq', 'not'].includes(f.t))
      || ((pr === 'and' && f.t === 'or') || (pr === 'or' && f.t === 'and'))
      || ((pr === 'imp' || pr === 'iff') && (f.t === 'and' || f.t === 'or'))
      || (parent.endsWith('-l') && PREC[f.t] === PREC[pr]);
    return need ? '(' + s + ')' : s;
  }

  // canonical key modulo renaming of bound variables and ∧/∨ comm/assoc/idempotence — for "same shape" checks
  function key(f, env, i) {
    env = env || {}; i = i || { n: 0 };
    const kt = (t) => (t.t === 'var' ? (env[t.n] || t.n) : t.t === 'const' ? '#' + t.n : t.n + '(' + t.args.map(kt).join(',') + ')');
    switch (f.t) {
      case 'pred': return f.n + '(' + f.args.map(kt).join(',') + ')';
      case 'eq': { const a = [kt(f.l), kt(f.r)].sort(); return a[0] + '≈' + a[1]; }
      case 'not': return '¬' + key(f.a, env, i);
      case 'imp': return '(' + key(f.l, env, i) + '>' + key(f.r, env, i) + ')';
      case 'iff': { const a = [key(f.l, env, i), key(f.r, env, i)].sort(); return '(' + a[0] + '=' + a[1] + ')'; }
      case 'and': case 'or': {
        const parts = []; const walk = (g) => { if (g.t === f.t) g.args.forEach(walk); else parts.push(key(g, env, i)); };
        walk(f); const u = [...new Set(parts)].sort();
        return '(' + u.join(f.t === 'and' ? '&' : '|') + ')';
      }
      case 'all': case 'ex': { const b = '_v' + (i.n++); return (f.t === 'all' ? '∀' : '∃') + key(f.body, Object.assign({}, env, { [f.v]: b }), i); }
    }
  }
  const same = (a, b) => key(a) === key(b);

  // collect the predicate signatures, constants, functions and free/bound variables
  function signature(f) {
    const preds = {}, funs = {}, consts = new Set();
    const T = (t) => {
      if (t.t === 'const') consts.add(t.n);
      else if (t.t === 'fun') { funs[t.n] = t.args.length; t.args.forEach(T); }
    };
    const F = (g) => {
      switch (g.t) {
        case 'pred': preds[g.n] = g.args.length; g.args.forEach(T); break;
        case 'eq': T(g.l); T(g.r); break;
        case 'not': F(g.a); break;
        case 'and': case 'or': g.args.forEach(F); break;
        case 'imp': case 'iff': F(g.l); F(g.r); break;
        case 'all': case 'ex': F(g.body); break;
      }
    };
    F(f);
    return { preds, funs, consts: [...consts] };
  }

  // ───────────────────────────── finite-domain model checking (Mace4-style) ─────────────────────────────
  // Evaluate a closed formula in an explicit finite model. domain = [0..d-1].
  // model = { preds:{name:{arity, table:Set of arg-tuple strings}}, funs:{name:{arity, map:{tuple->elem}}}, consts:{name->elem} }
  function evalIn(f, model, dom, env) {
    env = env || {};
    const T = (t) => {
      if (t.t === 'var') return env[t.n];
      if (t.t === 'const') return model.consts[t.n];
      const m = model.funs[t.n]; return m ? m.map[t.args.map(T).join(',')] : undefined;
    };
    switch (f.t) {
      case 'pred': { const p = model.preds[f.n]; return !!(p && p.table.has(f.args.map(T).join(','))); }
      case 'eq': return T(f.l) === T(f.r);
      case 'not': return !evalIn(f.a, model, dom, env);
      case 'and': return f.args.every((a) => evalIn(a, model, dom, env));
      case 'or': return f.args.some((a) => evalIn(a, model, dom, env));
      case 'imp': return !evalIn(f.l, model, dom, env) || evalIn(f.r, model, dom, env);
      case 'iff': return evalIn(f.l, model, dom, env) === evalIn(f.r, model, dom, env);
      case 'all': return dom.every((e) => evalIn(f.body, model, dom, Object.assign({}, env, { [f.v]: e })));
      case 'ex': return dom.some((e) => evalIn(f.body, model, dom, Object.assign({}, env, { [f.v]: e })));
    }
  }

  // enumerate all finite models of size d over the combined signature of several formulas; cb(model) → false to stop.
  // returns true if the search completed (never aborted), false if cb stopped it.
  function enumModels(sig, d, cb) {
    const dom = []; for (let i = 0; i < d; i++) dom.push(i);
    const predList = Object.entries(sig.preds); // [name, arity]
    const funList = Object.entries(sig.funs);
    const constList = sig.consts.slice();
    // each predicate of arity a has d^a tuples, each true/false → a bit vector we count through
    const tuples = (a) => { const out = [[]]; for (let k = 0; k < a; k++) { const nx = []; for (const t of out) for (const e of dom) nx.push([...t, e]); out.length = 0; out.push(...nx); } return out; };
    const predTuples = predList.map(([, a]) => tuples(a));
    const predBits = predList.map((_, i) => predTuples[i].length);
    const funDom = funList.map(([, a]) => tuples(a));           // each entry maps to one of d values
    const funChoices = funList.map((_, i) => funDom[i].length);  // number of entries; each has d choices
    // total configurations: product of (2^predBits) * (d^(sum fun entries)) * (d^#consts)
    // guard the blow-up
    let totalBits = predBits.reduce((s, b) => s + b, 0);
    let totalDigits = funChoices.reduce((s, c) => s + c, 0) + constList.length;
    if (totalBits + totalDigits * Math.ceil(Math.log2(Math.max(2, d))) > 24) return 'too-big';

    const predState = predBits.map(() => 0n);
    const buildModel = (predVals, funVals, constVals) => {
      const preds = {}; predList.forEach(([n, a], i) => {
        const set = new Set(); predTuples[i].forEach((tp, j) => { if ((predVals[i] >> BigInt(j)) & 1n) set.add(tp.join(',')); });
        preds[n] = { arity: a, table: set };
      });
      const funs = {}; funList.forEach(([n, a], i) => { const map = {}; funDom[i].forEach((tp, j) => { map[tp.join(',')] = funVals[i][j]; }); funs[n] = { arity: a, map }; });
      const consts = {}; constList.forEach((n, i) => { consts[n] = constVals[i]; });
      return { preds, funs, consts };
    };
    // iterate predicate bit-vectors (odometer), and for each, iterate function tables + constants (odometer in base d)
    const maxPred = predBits.map((b) => (1n << BigInt(b)) - 1n);
    const incPred = () => { for (let i = 0; i < predState.length; i++) { if (predState[i] < maxPred[i]) { predState[i]++; return true; } predState[i] = 0n; } return false; };
    do {
      // function/constant odometer in base d
      const fTotal = funChoices.reduce((s, c) => s + c, 0) + constList.length;
      const dig = new Array(fTotal).fill(0);
      const incDig = () => { for (let i = 0; i < dig.length; i++) { if (dig[i] < d - 1) { dig[i]++; return true; } dig[i] = 0; } return false; };
      do {
        let p = 0; const funVals = funChoices.map((c) => { const arr = []; for (let k = 0; k < c; k++) arr.push(dig[p++]); return arr; });
        const constVals = constList.map(() => dig[p++]);
        const m = buildModel(predState.slice(), funVals, constVals);
        if (cb(m) === false) return false;
      } while (fTotal > 0 && incDig());
    } while (incPred());
    return true;
  }

  // Equivalence over finite domains up to size MAXDOM: true iff no counter-model of either direction up to that size.
  // Returns {equivalent:bool, counter?:{model, dom, where:'a⊭b'|'b⊭a'}, incomplete?:bool}.
  const MAXDOM = 3;
  function finiteEquivalent(a, b, maxDom) {
    maxDom = maxDom || MAXDOM;
    const sig = mergeSig(signature(a), signature(b));
    let incomplete = false;
    for (let d = 1; d <= maxDom; d++) {
      let found = null;
      const r = enumModels(sig, d, (m) => {
        const va = !!evalIn(a, m, range(d)), vb = !!evalIn(b, m, range(d));
        if (va !== vb) { found = { model: m, dom: d, where: va ? 'a⊭b' : 'b⊭a' }; return false; }
        return true;
      });
      if (r === 'too-big') { incomplete = true; break; }
      if (found) return { equivalent: false, counter: found };
    }
    return { equivalent: true, incomplete };
  }
  // one-directional entailment over finite models: a ⊨ b ? (counter = a true, b false)
  function finiteEntails(a, b, maxDom) {
    maxDom = maxDom || MAXDOM;
    const sig = mergeSig(signature(a), signature(b));
    let incomplete = false;
    for (let d = 1; d <= maxDom; d++) {
      let found = null;
      const r = enumModels(sig, d, (m) => { if (evalIn(a, m, range(d)) && !evalIn(b, m, range(d))) { found = { model: m, dom: d }; return false; } return true; });
      if (r === 'too-big') { incomplete = true; break; }
      if (found) return { entails: false, counter: found, incomplete };
    }
    return { entails: true, incomplete };
  }
  const range = (d) => { const a = []; for (let i = 0; i < d; i++) a.push(i); return a; };
  function mergeSig(x, y) {
    const preds = Object.assign({}, x.preds, y.preds), funs = Object.assign({}, x.funs, y.funs);
    const consts = [...new Set([...x.consts, ...y.consts])];
    return { preds, funs, consts };
  }

  // ───────────────────────────── FOL → English (deterministic) ─────────────────────────────
  // Renders a reasonable natural reading. Not unique English, but faithful. Handles the common classroom shapes:
  //   ∀x (P(x) ⇒ Q(x))  → "every P is a Q" / "everything that is P is Q"
  //   ∃x (P(x) ∧ Q(x))  → "some P is a Q"
  //   ¬∀x (P(x) ⇒ Q(x)) → "not every P is a Q"
  //   ∀x ¬...           → "no ..." where it reads naturally
  // Falls back to a literal paraphrase for anything else.
  function toEnglish(f) {
    return sentence(f) + '.';
  }
  function humanName(n) { return n.replace(/([a-z])([A-Z])/g, '$1 $2'); }
  function predPhrase(p, subjVar) {
    // returns {text} describing predicate p where subjVar is the quantified variable acting as subject
    if (p.t === 'eq') { const other = sameVar(p.l, subjVar) ? p.r : p.l; return { text: 'equals ' + termEng(other) }; }
    const h = humanName(p.n).toLowerCase();
    const args = p.args || [];
    if (args.length === 0) return { text: h + ' holds' };
    if (args.length === 1 && sameVar(args[0], subjVar)) { const b = verbBase(h); return b ? { text: verb3(b), base: b } : { text: unaryEng(h) }; }
    if (args.length === 1) return { text: unaryEng(h) + ' (' + termEng(args[0]) + ')' };
    // binary/n-ary: "loves y", "likes y" — subject var becomes the understood subject, others listed
    const objs = args.map((a, i) => ({ a, i })).filter((o) => !sameVar(o.a, subjVar)).map((o) => termEng(o.a));
    const verb = verbN(h);
    return { text: verb + (objs.length ? ' ' + objs.join(' and ') : '') };
  }
  const sameVar = (t, v) => t && t.t === 'var' && t.n === v;
  const aAn = (w) => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
  // unary predicates: nouns read "is a student", adjectives "is smart", verbs "flies" (2026-10-18: "is a smart", "lovess" fixes)
  const ADJ = new Set(('smart rich poor red round green blue yellow black white curious happy sad tall short even odd breezy smelly stenchy evil greedy wet dry ' +
    'alive dead hungry honest intelligent young old big small large safe hot cold sick healthy kind lazy busy married male female mortal immortal ' +
    'prime positive negative empty full open closed visible valid true false free famous brave clever strong weak fast slow heavy light ' +
    'expensive cheap beautiful ugly good bad nice loyal friendly asleep awake late early wealthy edible poisonous dangerous').split(' '));
  const VERBS = new Set(('fly swim pass study run sleep walk sing talk die work smile bark live fail win lose cry laugh read write ' +
    'eat drink think move fall grow shine glitter attend exist').split(' '));
  const verb3 = (b) => (/(s|sh|ch|x|z|o)$/.test(b) ? b + 'es' : /[^aeiou]y$/.test(b) ? b.slice(0, -1) + 'ies' : b + 's');
  const verbBase = (h) => {
    if (VERBS.has(h)) return h;
    if (/ies$/.test(h) && VERBS.has(h.slice(0, -3) + 'y')) return h.slice(0, -3) + 'y';
    if (/es$/.test(h) && VERBS.has(h.slice(0, -2))) return h.slice(0, -2);
    if (/s$/.test(h) && VERBS.has(h.slice(0, -1))) return h.slice(0, -1);
    return null;
  };
  const isAdj = (h) => ADJ.has(h) || /(ous|ful|ive|able|ible|less|ish)$/.test(h);
  // "is a student" / "is smart" / "flies"
  const unaryEng = (h) => { const b = verbBase(h); if (b) return verb3(b); return 'is ' + (isAdj(h) ? h : aAn(h)); };
  // binary verbs: "loves" stays "loves", "like" -> "likes", "study" -> "studies"
  const verbN = (h) => { const b = verbBase(h); if (b) return verb3(b); return /s$/.test(h) ? h : verb3(h); };
  function termEng(t) {
    if (!t) return '';
    if (t.t === 'var') return t.n;
    if (t.t === 'const') return humanName(t.n);
    return humanName(t.n) + ' of ' + t.args.map(termEng).join(' and ');
  }
  function sentence(f) {
    // ¬∀x (P ⇒ Q)  → not every P is a Q
    if (f.t === 'not' && f.a.t === 'all' && f.a.body.t === 'imp') {
      const q = f.a; const rd = readRestricted(q.v, q.body.l, q.body.r);
      if (rd) return 'not ' + rd.allPhrase;
    }
    if (f.t === 'not' && f.a.t === 'ex' && f.a.body.t === 'and') {
      const q = f.a; const rd = readRestricted2(q.v, q.body);
      if (rd) return 'no ' + rd.subj + ' ' + rd.pred;
    }
    if (f.t === 'all') {
      const b = f.body;
      if (b.t === 'imp') { const rd = readRestricted(f.v, b.l, b.r); if (rd) return rd.allPhrase; }
      if (b.t === 'not' && b.a.t === 'pred') return 'nothing ' + predPhrase(b.a, f.v).text;
      // ∀x ∃y ...  common "everyone loves someone"
      if (b.t === 'ex') { const inner = sentence(b); return 'for every ' + f.v + ', ' + inner; }
      return 'for every ' + f.v + ', ' + sentence(b);
    }
    if (f.t === 'ex') {
      const b = f.body;
      if (b.t === 'and') { const rd = readRestricted2(f.v, b); if (rd) return 'some ' + rd.subj + ' ' + rd.pred; }
      if (b.t === 'all') return 'there is some ' + f.v + ' such that ' + sentence(b);
      return 'there is some ' + f.v + ' such that ' + sentence(b);
    }
    if (f.t === 'not') return 'it is not the case that ' + sentence(f.a);
    if (f.t === 'and') return f.args.map(sentence).join(', and ');
    if (f.t === 'or') return f.args.map(sentence).join(', or ');
    if (f.t === 'imp') return 'if ' + sentence(f.l) + ', then ' + sentence(f.r);
    if (f.t === 'iff') return sentence(f.l) + ' if and only if ' + sentence(f.r);
    if (f.t === 'pred') {
      if (f.args.length === 0) return f.n + ' holds';
      if (f.args.length === 1) return termEng(f.args[0]) + ' ' + unaryEng(humanName(f.n).toLowerCase());
      const h = humanName(f.n).toLowerCase(); const verb = verbN(h);
      return termEng(f.args[0]) + ' ' + verb + ' ' + f.args.slice(1).map(termEng).join(' and ');
    }
    if (f.t === 'eq') return termEng(f.l) + ' is ' + termEng(f.r);
    return show(f);
  }
  // ∀x (P(x) ⇒ body):  "every P <body-about-it>"
  function readRestricted(v, restr, conseq) {
    if (restr.t !== 'pred' || restr.args.length !== 1 || !sameVar(restr.args[0], v)) return null;
    const subj = humanName(restr.n).toLowerCase();
    const pred = conseqPhrase(conseq, v);
    return { allPhrase: 'every ' + subj + ' ' + pred, subj, pred };
  }
  // ∃x (P(x) ∧ Q(x)): subject = first unary predicate about x, pred = rest
  function readRestricted2(v, andF) {
    const args = andF.t === 'and' ? andF.args : [andF];
    const subjIdx = args.findIndex((a) => a.t === 'pred' && a.args.length === 1 && sameVar(a.args[0], v));
    if (subjIdx < 0) return null;
    const subj = humanName(args[subjIdx].n).toLowerCase();
    const rest = args.filter((_, i) => i !== subjIdx);
    const pred = rest.length ? conseqPhrase(rest.length === 1 ? rest[0] : { t: 'and', args: rest }, v) : 'exists';
    return { subj, pred };
  }
  function conseqPhrase(c, v) {
    if (c.t === 'not' && c.a.t === 'pred') { const pp = predPhrase(c.a, v); if (pp.base) return 'does not ' + pp.base; }
    if (c.t === 'not') { const inner = conseqPhrase(c.a, v); return /^is\s/.test(inner) ? 'is not ' + stripIs(inner) : 'does not ' + inner.replace(/s\b/, ''); }
    if (c.t === 'and') return c.args.map((a) => conseqPhrase(a, v)).join(' and ');
    if (c.t === 'or') return c.args.map((a) => conseqPhrase(a, v)).join(' or ');
    if (c.t === 'pred') { const pp = predPhrase(c, v); return pp.text; }
    if (c.t === 'ex') return 'satisfies that there is some ' + c.v + ' with ' + sentence(c.body);
    if (c.t === 'all') return 'satisfies that for every ' + c.v + ', ' + sentence(c.body);
    return 'satisfies ' + show(c);
  }
  const stripIs = (s) => s.replace(/^is\s+/, '');

  // ───────────────────────────── translation-pattern notes ─────────────────────────────
  // Explain WHY a formula has its quantifier/connective pairing — the classroom rules.
  function patternNotes(f) {
    const notes = [];
    const walk = (g) => {
      if (g.t === 'all' && g.body.t === 'imp') notes.push('∀ pairs with ⇒: “every A is B” is ∀x (A(x) ⇒ B(x)). Writing ∀x (A(x) ∧ B(x)) would wrongly say everything is both A and B.');
      if (g.t === 'all' && g.body.t === 'and') notes.push('⚠ ∀ with ∧ here says everything satisfies both conjuncts — check this is really what you mean (usually ∀ should pair with ⇒).');
      if (g.t === 'ex' && g.body.t === 'and') notes.push('∃ pairs with ∧: “some A is B” is ∃x (A(x) ∧ B(x)).');
      if (g.t === 'ex' && g.body.t === 'imp') notes.push('⚠ ∃ with ⇒ is almost always a mistake: ∃x (A(x) ⇒ B(x)) is true as soon as one thing is not A, so it says almost nothing.');
      if (g.t === 'not' && g.a.t === 'all') notes.push('“not all …” is ¬∀x … ≡ ∃x ¬… (push ¬ through: ∀ becomes ∃).');
      if (g.t === 'not' && g.a.t === 'ex') notes.push('“no / none …” is ¬∃x … ≡ ∀x ¬… (push ¬ through: ∃ becomes ∀).');
      if (g.t === 'all') walk(g.body);
      else if (g.t === 'ex') walk(g.body);
      else if (g.t === 'not') walk(g.a);
      else if (g.t === 'and' || g.t === 'or') g.args.forEach(walk);
      else if (g.t === 'imp' || g.t === 'iff') { walk(g.l); walk(g.r); }
    };
    walk(f);
    // nested quantifier order
    const order = quantPrefix(f);
    if (order.length >= 2 && order.slice(0, 2).join('') === '∀∃') notes.push('Order ∀x∃y: each x may get its OWN y. (“Everyone loves someone” — the someone can differ per person.)');
    if (order.length >= 2 && order.slice(0, 2).join('') === '∃∀') notes.push('Order ∃y∀x: one SAME y works for every x. (“Someone is loved by everyone” — one fixed person.) Swapping ∀ and ∃ changes the meaning.');
    return [...new Set(notes)];
  }
  function quantPrefix(f) { const out = []; let g = f; while (g && (g.t === 'all' || g.t === 'ex')) { out.push(g.t === 'all' ? '∀' : '∃'); g = g.body; } return out; }

  // build the predicate/const/function glossary shown next to a formula
  function glossary(f) {
    const sig = signature(f);
    const preds = Object.entries(sig.preds).map(([n, a]) => ({ sym: n + (a ? '(' + 'xyzw'.slice(0, a).split('').join(',') + ')' : ''), gloss: predGloss(n, a) }));
    const funs = Object.entries(sig.funs).map(([n, a]) => ({ sym: n + '(' + 'xyzw'.slice(0, a).split('').join(',') + ')', gloss: 'the ' + humanName(n).toLowerCase() + ' of its argument(s) (a function, names an object)' }));
    const consts = sig.consts.map((n) => ({ sym: n, gloss: 'the object named ' + humanName(n) + ' (a constant)' }));
    return { preds, funs, consts };
  }
  function predGloss(n, a) {
    const h = humanName(n).toLowerCase();
    if (a === 0) return '“' + h + '” is true/false';
    if (a === 1) return 'x ' + unaryEng(h);
    if (a === 2) return 'x ' + verbN(h) + ' y (relation between x and y)';
    return h + ' holds of its ' + a + ' arguments';
  }

  // the FOL symbol legend, for the UI
  const SYMBOLS = [
    { s: '∀', name: 'for all (universal)', ex: '∀x King(x) ⇒ Person(x)' },
    { s: '∃', name: 'there exists (existential)', ex: '∃x King(x) ∧ Rich(x)' },
    { s: '¬', name: 'not', ex: '¬Fly(Tweety)' },
    { s: '∧', name: 'and', ex: 'Bird(x) ∧ ¬Fly(x)' },
    { s: '∨', name: 'or', ex: 'Male(x) ∨ Female(x)' },
    { s: '⇒', name: 'implies (if … then)', ex: 'King(x) ⇒ Person(x)' },
    { s: '⇔', name: 'if and only if', ex: 'Even(x) ⇔ ¬Odd(x)' },
    { s: '=', name: 'equals (same object)', ex: 'FatherOf(John) = George' },
  ];

  return {
    tokenize, parse: (s) => fixTerms(parse(s)), tryParse: (s) => { const r = tryParse(s); return r.ok ? { ok: true, f: fixTerms(r.f) } : r; },
    show, showTerm, key, same, signature,
    evalIn, enumModels, finiteEquivalent, finiteEntails, MAXDOM,
    toEnglish, patternNotes, glossary, predGloss, humanName, quantPrefix, SYMBOLS,
  };
});
