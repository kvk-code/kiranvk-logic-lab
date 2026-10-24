/* Logic Lab — one exercise attempt as a state machine (shared by the page and the tests).
 *   s = LabSession.create(track, exercise)
 *   s.premiseLines()            → the numbered lines that are given
 *   s.add({f, rule, cites})     → {ok, verdict, msg, …}  (the line is kept either way; a × line cannot be cited)
 *   s.undo()                    → drops the last line
 *   s.hint(level)               → {level, text, line?}   level 1 nudge · 2 which rule/lines · 3 the next line itself
 *   s.solved                    → true once the goal is reached
 *   s.context()                 → compact JSON for the AI tutor (statement, lines + verdicts, the checker's next step)
 * Line numbers shown to the student are 1-based over (given lines + student lines).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic-core.js'));
  else root.LabSession = factory(root.LogicCore);
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';
  const P = (s) => L.flat(L.parse(s));
  const S = (f) => L.show(f);

  const RULE_MENUS = {
    patterns: ['mp', 'mt', 'andelim', 'andintro', 'unitres', 'resolution', 'biconditional', 'implication', 'contraposition', 'demorgan', 'doubleneg', 'distribution'],
    cnf: ['biconditional', 'implication', 'demorgan', 'doubleneg', 'distribution', 'simplify'],
  };
  const NUDGE_CNF = {
    biconditional: 'There is still a ⇔ in the line. CNF has no ⇔ — what is the first law in the CNF recipe?',
    implication: 'All ⇔ are gone, but a ⇒ is still there. CNF only allows ¬, ∧ and ∨.',
    demorgan: 'A ¬ is sitting in front of a bracket. In CNF a ¬ may only touch a single symbol.',
    doubleneg: 'Look for two ¬ in a row.',
    distribution: 'No ⇒ and no stray ¬ left. But somewhere an ∨ has an ∧ inside it — CNF needs ∧ on the outside.',
    simplify: 'It is CNF already, but something is repeated (or a clause contains both P and ¬P).',
  };
  const NUDGE_INFER = {
    mp: 'You have an implication α ⇒ β and you already know α. What does that give you?',
    mt: 'You have an implication α ⇒ β and you know β is false. What must be false too?',
    andelim: 'One of your lines is a conjunction (∧). Each part of it is true on its own.',
    andintro: 'The rule you need has an ∧ on its left side. Can you build that conjunction from lines you have?',
    unitres: 'You have a disjunction (∨), and one of its parts is known to be false. What is left?',
    biconditional: 'A ⇔ is hard to use directly. Break it into its two implications.',
    contraposition: 'You know the right-hand side is false, not the left. Flip the implication (both sides negated).',
    demorgan: 'A ¬ is in front of a bracket. Push it inside.',
    implication: 'Rewrite the ⇒ as a disjunction.',
    doubleneg: 'Two ¬ in a row cancel.',
    distribution: 'Distribute ∨ over ∧.',
  };

  function create(track, ex) {
    const s = { track, ex, lines: [], solved: false, hintsUsed: 0, maxHint: 0 };

    // ───────── given lines per track
    if (track === 'patterns') {
      s.given = ex.premises.map((t) => ({ f: P(t), rule: 'premise', given: true, ok: true }));
      s.goal = ex.goal ? P(ex.goal) : null;   // own boards may have no goal: free derivation
    } else if (track === 'cnf') {
      s.given = [{ f: P(ex.start), rule: 'start', given: true, ok: true }];
    } else if (track === 'resolution') {
      s.kb = ex.kb.map(P); s.alpha = P(ex.alpha); s.negAlpha = L.flat(L.Not(s.alpha));
      s.target = L.flat(L.And(...s.kb, s.negAlpha));
      s.given = ex.given ? ex.clauses.map((t) => ({ f: P(t), c: L.clauseOf(P(t)), rule: 'given', given: true, ok: true })) : [];
    } else if (track === 'fc' || track === 'bc') {
      s.rules = ex.rules.map(L.parseDefinite);
      s.facts = new Set(s.rules.filter((r) => !r.body.length).map((r) => r.head));
      s.given = [];
      if (track === 'bc') s.tree = { sym: ex.query, kids: null, closed: false, parent: null, how: null };
    }
    const all = () => s.given.concat(s.lines);
    s.premiseLines = () => s.given;
    s.all = all;
    s.known = () => { // fc: facts + correctly inferred heads
      const k = new Set(s.facts); for (const l of s.lines) if (l.ok && l.head) k.add(l.head); return k;
    };

    // ───────── adding a line
    s.add = function (input) {
      const res = check(input);
      const line = Object.assign({}, input, res);
      s.lines.push(line);
      afterAdd(line);
      return res;
    };
    s.undo = function () {
      const l = s.lines.pop(); if (!l) return;
      if (track === 'bc' && l.ok && l.node) { l.node.kids = null; l.node.closed = false; l.node.how = null; recloseTree(); }
      s.solved = isSolved();
    };
    function afterAdd(line) { s.solved = isSolved(); line.solves = s.solved && !s.lines.slice(0, -1).some((x) => x.solves); }

    function citeLines(cites) {
      const A = all(); const out = [];
      for (const n of cites || []) {
        const l = A[n - 1];
        if (!l) return { err: `There is no line ${n}.` };
        if (!l.ok) return { err: `Line ${n} is marked ×, so it cannot be used.` };
        if (A.indexOf(l) >= A.length) return { err: `Line ${n} comes later.` };
        out.push(l);
      }
      return { lines: out };
    }
    function parseOr(f) { if (f && typeof f === 'object' && f.t) return { f: L.flat(f) }; const r = L.tryParse(f); return r.ok ? { f: L.flat(r.f) } : { err: r.error }; }

    function check(input) {
      if (track === 'patterns') {
        const p = parseOr(input.f); if (p.err) return { ok: false, verdict: 'syntax', msg: p.err };
        input.f = p.f;
        const c = citeLines(input.cites); if (c.err) return { ok: false, verdict: 'cite', msg: c.err };
        const kbAll = all().filter((l) => l.ok).map((l) => l.f);
        const d = L.diagnoseInference({ f: p.f, rule: input.rule }, c.lines.map((l) => l.f), kbAll);
        if (d.ok && s.goal && L.same(p.f, s.goal)) d.msg += ' 🎯 That is the goal — proof complete.';
        return d;
      }
      if (track === 'cnf') {
        const p = parseOr(input.f); if (p.err) return { ok: false, verdict: 'syntax', msg: p.err };
        input.f = p.f;
        const prev = lastGood();
        const d = L.diagnoseRewrite(prev.f, p.f, input.rule, { track: 'cnf' });
        if (d.ok && L.isCNF(p.f) && !L.cnfNextRule(p.f)) d.msg += ' 🎯 This is in CNF — done.';
        else if (d.ok && L.isCNF(p.f)) d.msg += ' It is CNF already; you can still simplify.';
        return d;
      }
      if (track === 'resolution') {
        const p = parseOr(input.f); if (p.err) return { ok: false, verdict: 'syntax', msg: p.err };
        input.f = p.f;
        const c = L.clauseOf(p.f);
        if (!c) return { ok: false, verdict: 'notclause', msg: 'A clause is a disjunction of literals (like ¬P ∨ Q ∨ R), or □ for the empty clause. Convert to CNF first.' };
        input.c = c;
        if (input.rule === 'clause') {
          if (s.ex.given) return { ok: false, verdict: 'given', msg: 'The clauses are already given for this exercise — resolve them.' };
          if (all().some((l) => l.ok && l.c && L.clauseKey(l.c) === L.clauseKey(c))) return { ok: false, verdict: 'dup', msg: 'You already have this clause.' };
          // a setup clause must come from ONE KB sentence (or from ¬α) on its own — reasoning across sentences is resolution's job
          // (KB ∧ ¬α itself is unsatisfiable, so "entailed by KB ∧ ¬α" would accept anything)
          const src = [...s.kb, s.negAlpha].findIndex((k) => { try { return L.entails([k], p.f); } catch (e) { return false; } });
          if (src < 0) {
            let fromKB = false; try { fromKB = L.entails(s.kb, p.f); } catch (e) { }
            return { ok: false, verdict: 'unsound', msg: L.same(p.f, s.alpha) ? 'That is α itself — what you want to prove. Proof by contradiction adds its NEGATION ¬α instead.'
              : fromKB ? 'This clause does follow from the KB, but only by combining several sentences — that is what the resolution steps are for. In the setup, convert each KB sentence (and ¬α) to CNF on its own.'
              : 'This clause does not come from any KB sentence or from ¬α. Convert each one to CNF and copy its clauses.' };
          }
          const isNeg = L.same(p.f, s.negAlpha) || L.equivalent(p.f, s.negAlpha);
          return { ok: true, verdict: 'correct', msg: isNeg ? 'Correct: this is ¬α, the negated goal — the heart of proof by contradiction.' : 'Correct: this clause is part of the CNF of KB ∧ ¬α.' };
        }
        // resolve
        const cl = citeLines(input.cites); if (cl.err) return { ok: false, verdict: 'cite', msg: cl.err };
        if (cl.lines.length !== 2) return { ok: false, verdict: 'cite', msg: 'Resolution takes exactly two clauses: cite two line numbers.' };
        if (cl.lines.some((l) => !l.c)) return { ok: false, verdict: 'cite', msg: 'Both cited lines must be clauses.' };
        const r = L.checkResolution(cl.lines[0].c, cl.lines[1].c, c);
        if (r.ok && all().some((l) => l.ok && l.c && L.clauseKey(l.c) === L.clauseKey(c))) r.msg += ' (You already had this clause — it adds nothing new.)';
        return Object.assign({ verdict: r.ok ? 'correct' : r.bug ? 'buggy' : 'notresolvent' }, r);
      }
      if (track === 'fc') {
        const i = Number(input.ruleNo) - 1; const h = canonSym(input.head);
        const r = L.checkFire(s.rules, s.known(), i, h);
        return Object.assign({ verdict: r.ok ? 'correct' : 'notfire', head: r.ok ? h : null }, r, r.ok && h === s.ex.query ? { msg: r.msg + ' 🎯 The query is inferred — KB ⊨ ' + L.prettyName(h) + '.' } : {});
      }
      if (track === 'bc') {
        const h = canonSym(input.goal);
        const node = openLeaves().find((n) => n.sym === h);
        if (!node) return { ok: false, verdict: 'notopen', msg: openLeaves().length ? `${L.prettyName(h)} is not an open goal. Open goals: ${openLeaves().map((n) => L.prettyName(n.sym)).join(', ')}.` : 'There are no open goals.' };
        for (let a = node.parent; a; a = a.parent) if (a.sym === h) return { ok: false, verdict: 'loop', msg: `Loop! ${L.prettyName(h)} is already being proved higher up in this branch. BC must not try to prove a goal that is already on the goal stack — choose another rule higher up.` };
        if (input.ruleNo === 'fact') {
          if (!s.facts.has(h)) return { ok: false, verdict: 'notfact', msg: `${L.prettyName(h)} is not a fact in the KB. Pick a rule that concludes it.` };
          node.kids = []; node.how = 'fact'; recloseTree();
          return { ok: true, verdict: 'correct', node, msg: `${L.prettyName(h)} is a known fact — this goal is closed.` + solvedNote() };
        }
        if (input.ruleNo === 'proved') {
          if (!provedSyms().has(h)) return { ok: false, verdict: 'notproved', msg: `${L.prettyName(h)} has not been proved anywhere in the tree yet.` };
          node.kids = []; node.how = 'proved'; recloseTree();
          return { ok: true, verdict: 'correct', node, msg: `${L.prettyName(h)} was already proved — reuse it.` + solvedNote() };
        }
        const i = Number(input.ruleNo) - 1, r = s.rules[i];
        if (!r || !r.body.length) return { ok: false, verdict: 'norule', msg: 'Pick a rule (not a fact) by its number.' };
        if (r.head !== h) return { ok: false, verdict: 'wronghead', msg: `Rule ${i + 1} concludes ${L.prettyName(r.head)}, not ${L.prettyName(h)}. In BC you may only use a rule whose conclusion matches the goal.` };
        const closure = L.fcClosure(s.rules);
        const dead = r.body.filter((b) => !closure.has(b));
        if (dead.length) return { ok: false, verdict: 'deadend', msg: `Rule ${i + 1} matches, but ${dead.map(L.prettyName).join(', ')} can never be proved from this KB — this branch fails. Backtrack: try another rule for ${L.prettyName(h)}.` };
        const loopy = r.body.filter((b) => { for (let a = node; a; a = a.parent) if (a.sym === b) return true; return false; });
        if (loopy.length) return { ok: false, verdict: 'loop', msg: `Rule ${i + 1} needs ${loopy.map(L.prettyName).join(', ')}, which is already being proved higher up in this branch — an infinite loop. Pick another rule for ${L.prettyName(h)}.` };
        node.kids = r.body.map((b) => ({ sym: b, kids: null, closed: false, parent: node, how: null })); node.how = i; recloseTree();
        return { ok: true, verdict: 'correct', node, msg: `Correct: rule ${i + 1} concludes ${L.prettyName(h)}. New sub-goals: ${r.body.map(L.prettyName).join(', ')}.` };
      }
      return { ok: false, msg: 'Unknown track.' };
    }
    const canonSym = (x) => String(x || '').trim().replace(/[,_\s]/g, '');
    function lastGood() { const A = all(); for (let i = A.length - 1; i >= 0; i--) if (A[i].ok) return A[i]; return A[0]; }
    // bc tree helpers
    function walk(n, cb) { cb(n); (n.kids || []).forEach((k) => walk(k, cb)); }
    function openLeaves() { const out = []; if (!s.tree) return out; walk(s.tree, (n) => { if (n.kids === null) out.push(n); }); return out; }
    function recloseTree() { const f = (n) => (n.closed = n.kids !== null && n.kids.every(f)); if (s.tree) f(s.tree); }
    function provedSyms() { const p = new Set(); if (s.tree) walk(s.tree, (n) => { if (n.closed) p.add(n.sym); }); return p; }
    const solvedNote = () => (s.tree && s.tree.closed ? ` 🎯 Every goal is closed — ${L.prettyName(s.ex.query)} is proved.` : '');
    s.openLeaves = openLeaves;

    function isSolved() {
      if (track === 'patterns') return !!s.goal && all().some((l) => l.ok && L.same(l.f, s.goal));
      if (track === 'cnf') { const g = lastGood(); return !g.given && L.isCNF(g.f) && !L.cnfNextRule(g.f); }
      if (track === 'resolution') return all().some((l) => l.ok && l.c && l.c.length === 0);
      if (track === 'fc') return s.known().has(s.ex.query);
      if (track === 'bc') { recloseTree(); return s.tree.closed; }
      return false;
    }

    // ───────── the checker's own next step (used by Unstuck and handed to the AI tutor)
    s.nextStep = function () {
      if (s.solved) return null;
      const A = all();
      if (track === 'patterns') {
        if (!s.goal) return null;
        const good = A.filter((l) => l.ok);
        const h = L.proofHint(good.map((l) => l.f), s.goal, 6);
        if (!h || !h.first) return null;
        const cites = h.first.cites.map((k) => A.indexOf(good[k]) + 1);
        return { rule: h.first.rule, f: h.first.f, cites, text: `${S(h.first.f)}    [${L.ruleName(h.first.rule)}, from line${cites.length > 1 ? 's' : ''} ${cites.join(', ')}]` };
      }
      if (track === 'cnf') {
        const n = L.cnfNextLine(lastGood().f); if (!n) return null;
        return { rule: n.rule, f: n.f, text: `${S(n.f)}    [${L.RULES[n.rule].name}]` };
      }
      if (track === 'resolution') {
        const have = A.filter((l) => l.ok && l.c);
        if (!s.ex.given) { // setup phase: offer the next missing clause of CNF(KB ∧ ¬α)
          const want = s.ex.clauses.map(P).map((f) => ({ f, c: L.clauseOf(f) }));
          const keys = new Set(have.map((l) => L.clauseKey(l.c)));
          const negFirst = want.find((w) => L.same(w.f, s.negAlpha));
          if (negFirst && !keys.has(L.clauseKey(negFirst.c))) return { rule: 'clause', f: negFirst.f, text: `${S(negFirst.f)}    [clause: ¬α, the negated goal]`, setup: true, neg: true };
          const proof = L.refute(have.map((l) => l.c));
          if (!proof) { const miss = want.find((w) => !keys.has(L.clauseKey(w.c))); if (miss) return { rule: 'clause', f: miss.f, text: `${S(miss.f)}    [clause from CNF of the KB]`, setup: true }; }
        }
        const proof = L.refute(have.map((l) => l.c));
        if (!proof) return null;
        for (const st of proof) {
          const ia = have.findIndex((l) => L.clauseKey(l.c) === L.clauseKey(st.a)), ib = have.findIndex((l) => L.clauseKey(l.c) === L.clauseKey(st.b));
          if (ia < 0 || ib < 0) continue;
          if (have.some((l) => L.clauseKey(l.c) === L.clauseKey(st.c))) continue;
          const na = A.indexOf(have[ia]) + 1, nb = A.indexOf(have[ib]) + 1;
          return { rule: 'resolve', f: L.clauseFormula(st.c), cites: [na, nb], on: st.on, text: `${L.clauseText(st.c)}    [resolve ${na} and ${nb} on ${L.prettyName(st.on)}]` };
        }
        return null;
      }
      if (track === 'fc') {
        const k = s.known(); const closure = L.fcClosure(s.rules);
        // prefer a rule that lies on a derivation of the query (avoid irrelevant firings)
        const useful = relevantFor(s.ex.query);
        const cand = s.rules.map((r, i) => ({ r, i })).filter(({ r }) => r.body.length && !k.has(r.head) && r.body.every((b) => k.has(b)) && closure.has(r.head));
        const pick = cand.find(({ r }) => useful.has(r.head)) || cand[0];
        if (!pick) return null;
        return { ruleNo: pick.i + 1, head: pick.r.head, text: `Fire rule ${pick.i + 1} (${L.ruleText(pick.r)}) ⇒ infer ${L.prettyName(pick.r.head)}` };
      }
      if (track === 'bc') {
        const leaf = openLeaves()[0]; if (!leaf) return null;
        if (s.facts.has(leaf.sym)) return { goal: leaf.sym, ruleNo: 'fact', text: `${L.prettyName(leaf.sym)} — known fact` };
        if (provedSyms().has(leaf.sym)) return { goal: leaf.sym, ruleNo: 'proved', text: `${L.prettyName(leaf.sym)} — already proved, reuse it` };
        const closure = L.fcClosure(s.rules);
        const ok = s.rules.map((r, i) => ({ r, i })).filter(({ r }) => r.head === leaf.sym && r.body.every((b) => closure.has(b)) && !r.body.some((b) => { for (let a = leaf; a; a = a.parent) if (a.sym === b) return true; return false; }));
        if (!ok.length) return null;
        return { goal: leaf.sym, ruleNo: ok[0].i + 1, text: `Goal ${L.prettyName(leaf.sym)} ← rule ${ok[0].i + 1} (${L.ruleText(ok[0].r)}): new sub-goals ${ok[0].r.body.map(L.prettyName).join(', ')}` };
      }
      return null;
    };
    function relevantFor(q) { // symbols on some derivation path of q
      const out = new Set([q]); let ch = true;
      while (ch) { ch = false; for (const r of s.rules) if (out.has(r.head)) for (const b of r.body) if (!out.has(b)) { out.add(b); ch = true; } }
      return out;
    }

    // ───────── "what follows next?" — every one-step move the rules allow right now (free boards, and stuck students)
    s.possibilities = function (max) {
      if (track !== 'patterns') return [];
      const A = all(); const good = A.filter((l) => l.ok);
      const have = new Set(good.map((l) => L.key(l.f))); const seen = new Set(); const out = [];
      for (const m of L.proofSuccessors(good.map((l) => l.f))) {
        const k = L.key(m.f); if (have.has(k) || seen.has(k) || L.size(m.f) > 16) continue; seen.add(k);
        out.push({ rule: m.rule, f: m.f, cites: m.cites.map((i) => A.indexOf(good[i]) + 1) });
      }
      const rank = { mp: 0, mt: 0, unitres: 1, andintro: 1, andelim: 2, biconditional: 3, demorgan: 3, doubleneg: 3, contraposition: 4, implication: 5, distribution: 6 };
      out.sort((a, b) => (rank[a.rule] ?? 9) - (rank[b.rule] ?? 9));
      return out.slice(0, max || 8);
    };
    // does the goal follow at all? (truth table — the honest answer when no short proof is found)
    s.goalStatus = function () {
      if (track !== 'patterns' || !s.goal) return null;
      const kb = s.given.map((l) => l.f);
      let ent = null; try { ent = L.entails(kb, s.goal); } catch (e) { return { unknown: true }; }
      if (ent) return { follows: true };
      let cx = null; try { cx = L.countermodel(kb, s.goal); } catch (e) { }
      return { follows: false, counter: cx };
    };

    // ───────── Unstuck: three levels (LogEx: "next step" beats a vague hint, so level 3 always exists)
    s.hint = function (level) {
      const n = s.nextStep();
      // count STEPS where help was needed (not taps): three taps on one step is one hinted step
      s._hinted = s._hinted || new Set(); if (!s._hinted.has(s.lines.length)) { s._hinted.add(s.lines.length); s.hintsUsed++; }
      s.maxHint = Math.max(s.maxHint, level);
      const last = s.lines[s.lines.length - 1];
      if (s.solved) return { level, text: 'Already solved. Try the next exercise, or undo lines and find a shorter route.' };
      if (last && !last.ok && level === 1) return { level, text: `Start with your last line: it is marked ×. ${last.msg} Fix it (or undo it) before going further.` };
      if (!n && track === 'patterns') {
        const ps = s.possibilities(8);
        if (s.goal) {
          const g = s.goalStatus();
          if (g && g.follows === false) return { level, text: `Your goal does NOT follow from your statements, so no derivation can reach it. Counter-example: ${g.counter ? Object.entries(g.counter).map(([k, v]) => `${L.prettyName(k)} = ${v ? 'T' : 'F'}`).join(', ') : '—'} makes every statement true and the goal false. Check the statements or the goal.` };
          if (g && g.follows) return { level, text: `The goal does follow (truth table says so), but I can’t find a short proof with these rules from here. Undo a step, or try the same statements in Resolution mode.`, moves: ps };
        }
        if (!ps.length) return { level, text: 'No rule applies to your lines any more. Nothing new follows in one step.' };
        if (level === 1) return { level, text: 'Rules you can apply right now: ' + [...new Set(ps.map((m) => `${L.ruleName(m.rule)} (line${m.cites.length > 1 ? 's' : ''} ${m.cites.join(',')})`))].slice(0, 6).join(' · ') + '.' };
        return { level, text: 'What follows next — pick any:', moves: ps, line: level === 3 ? Object.assign({ text: '' }, ps[0]) : null };
      }
      if (!n) return { level, text: 'I can’t find a way forward from here with the rules of this track. Undo a step or two.' };
      if (track === 'cnf') {
        if (level === 1) return { level, text: NUDGE_CNF[n.rule] };
        if (level === 2) return { level, text: `Use ${L.RULES[n.rule].name}:  ${L.RULES[n.rule].law}` };
        return { level, text: n.text, line: n };
      }
      if (track === 'patterns') {
        if (level === 1) return { level, text: NUDGE_INFER[n.rule] || 'Look at which of your lines mention the symbols in the goal.' };
        if (level === 2) return { level, text: `Use ${L.ruleName(n.rule)} on line${n.cites.length > 1 ? 's' : ''} ${n.cites.join(' and ')}.  (${(L.INFER[n.rule] || L.RULES[n.rule]).law})` };
        return { level, text: n.text, line: n };
      }
      if (track === 'resolution') {
        if (n.setup) {
          if (level === 1) return { level, text: n.neg ? 'Proof by contradiction starts by assuming the opposite of what you want: add ¬α as a clause.' : 'You still need the rest of KB ∧ ¬α as clauses. Convert each KB sentence to CNF and add its clauses one per line.' };
          if (level === 2) return { level, text: n.neg ? `α is ${S(s.alpha)}, so the clause to add is its negation.` : 'Take the next KB sentence: eliminate ⇔/⇒, push ¬ in, distribute — each conjunct becomes one clause.' };
          return { level, text: n.text, line: n };
        }
        if (level === 1) return { level, text: `Look for two clauses where one contains ${L.prettyName(n.on)} and the other contains ¬${L.prettyName(n.on)}.` };
        if (level === 2) return { level, text: `Resolve line ${n.cites[0]} with line ${n.cites[1]} on ${L.prettyName(n.on)}.` };
        return { level, text: n.text, line: n };
      }
      if (track === 'fc') {
        if (level === 1) return { level, text: 'Which rule has ALL of its premises among the known facts right now? (Its count has dropped to 0.)' };
        if (level === 2) return { level, text: `Rule ${n.ruleNo} can fire.` };
        return { level, text: n.text, line: n };
      }
      if (track === 'bc') {
        if (level === 1) return { level, text: `Work on the leftmost open goal, ${L.prettyName(n.goal)}. Is it a fact, or which rules conclude it?` };
        if (level === 2) return { level, text: n.ruleNo === 'fact' ? `${L.prettyName(n.goal)} is a fact.` : n.ruleNo === 'proved' ? `${L.prettyName(n.goal)} is already proved elsewhere in the tree.` : `Use rule ${n.ruleNo} for ${L.prettyName(n.goal)}.` };
        return { level, text: n.text, line: n };
      }
      return { level, text: '' };
    };

    // ───────── context for the AI tutor (no student identity)
    s.statement = function () {
      if (track === 'patterns') return `Premises: ${ex.premises.map((p, i) => `(${i + 1}) ${p}`).join('  ')}. ${ex.goal ? 'Goal: ' + ex.goal + '.' : 'No goal: the student is deriving freely to see what follows.'}` + (ex.story ? ' ' + ex.story : '');
      if (track === 'cnf') return `Convert to CNF: ${ex.start}`;
      if (track === 'resolution') return `KB: ${ex.kb.join(' ; ')}. Prove α = ${ex.alpha} by resolution refutation.` + (ex.given ? ' (Clauses of KB ∧ ¬α are given.)' : ' (Student must first write the clauses of KB ∧ ¬α.)');
      if (track === 'fc' || track === 'bc') return `Definite-clause KB: ${ex.rules.map((r, i) => `(${i + 1}) ${r}`).join('  ')}. Query: ${ex.query}. Method: ${track === 'fc' ? 'forward chaining' : 'backward chaining'}.`;
    };
    s.context = function () {
      const A = all(); const n = s.nextStep();
      return {
        course: 'PECST522 Artificial Intelligence, Module 3 (KTU 2024 scheme); textbook AIMA 4e Ch. 7',
        track, exercise: ex.title, statement: s.statement(),
        lines: A.map((l, i) => ({ n: i + 1, text: lineText(l), rule: l.rule || null, cites: l.cites || null, given: !!l.given, verdict: l.given ? 'given' : l.ok ? '✓' : '×', checker_says: l.msg || null })),
        solved: s.solved,
        checker_next_step: n ? n.text : null,
      };
    };
    function lineText(l) {
      if (track === 'fc') return l.ok ? `fire rule ${l.ruleNo} ⇒ ${l.head}` : `fire rule ${l.ruleNo} ⇒ ${l.head || '?'}`;
      if (track === 'bc') return `goal ${l.goal} ← ${l.ruleNo === 'fact' ? 'fact' : l.ruleNo === 'proved' ? 'already proved' : 'rule ' + l.ruleNo}`;
      try { return l.f && l.f.t ? S(l.f) : String(l.f); } catch (e) { return String(l.f); }
    }
    s.lineText = lineText;
    return s;
  }

  return { create, RULE_MENUS };
});
