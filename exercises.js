/* Logic Lab — exercise bank, v1 (propositional half of Module 3, PECST522).
 * Every exercise carries a reference solution (`ref`); bench/test-exercises.mjs replays each one through the
 * checker in logic-core.js and fails the build if any reference step is not accepted or does not reach the goal.
 * Sources: AIMA 4e Ch. 7 (T1) worked examples, the Module 3 deck, the M3 CNF practice sheet, KTU-style questions.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LabExercises = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TRACKS = [
    { id: 'patterns', title: 'Reasoning patterns', syllabus: 'Reasoning Patterns in Propositional Logic',
      blurb: 'Derive the goal from the premises one rule at a time: Modus Ponens, And-Elimination, ⇔-elimination, De Morgan, Unit Resolution…' },
    { id: 'cnf', title: 'CNF conversion', syllabus: 'Propositional Logic → Conjunctive Normal Form',
      blurb: 'Rewrite the sentence into CNF using one equivalence law per line: ⇔-elim → ⇒-elim → push ¬ in → distribute ∨ over ∧.' },
    { id: 'resolution', title: 'Resolution refutation', syllabus: 'Reasoning Patterns — Resolution (proof by contradiction)',
      blurb: 'To prove KB ⊨ α: write KB ∧ ¬α as clauses, then resolve pairs until you reach the empty clause □.' },
    { id: 'fc', title: 'Forward chaining', syllabus: 'Forward chaining (definite clauses)',
      blurb: 'Data-driven: fire any rule whose premises are all known, add its conclusion, repeat until the query appears.' },
    { id: 'bc', title: 'Backward chaining', syllabus: 'Backward chaining (definite clauses)',
      blurb: 'Goal-driven: start from the query, pick a rule that concludes it, and prove each of its premises in turn.' },
  ];

  // ── Reasoning patterns: premises ⊢ goal.  ref: [formula, rule, [cited line numbers, 1-based over premises+steps]]
  const patterns = [
    { id: 'p1', level: 1, title: 'Modus Ponens', premises: ['P ⇒ Q', 'P'], goal: 'Q',
      ref: [['Q', 'mp', [1, 2]]] },
    { id: 'p2', level: 1, title: 'And-Elimination, then MP', premises: ['P ∧ Q', 'Q ⇒ R'], goal: 'R',
      ref: [['Q', 'andelim', [1]], ['R', 'mp', [2, 3]]] },
    { id: 'p3', level: 1, title: 'Modus Tollens', premises: ['P ⇒ Q', '¬Q'], goal: '¬P',
      ref: [['¬P', 'mt', [1, 2]]] },
    { id: 'p4', level: 1, title: 'Unit Resolution', premises: ['P ∨ Q', '¬P'], goal: 'Q',
      ref: [['Q', 'unitres', [1, 2]]] },
    { id: 'p5', level: 2, title: 'Chain of rules', story: 'If it rains (R) the ground is wet (W). If the ground is wet the match is cancelled (M). It rains.',
      premises: ['R ⇒ W', 'W ⇒ M', 'R'], goal: 'M',
      ref: [['W', 'mp', [1, 3]], ['M', 'mp', [2, 4]]] },
    { id: 'p6', level: 2, title: 'And-Introduction', premises: ['A ∧ B ⇒ C', 'A', 'B'], goal: 'C',
      ref: [['A ∧ B', 'andintro', [2, 3]], ['C', 'mp', [1, 4]]] },
    { id: 'p7', level: 2, title: 'Modus Tollens twice', premises: ['P ⇒ Q', 'Q ⇒ R', '¬R'], goal: '¬P',
      ref: [['¬Q', 'mt', [2, 3]], ['¬P', 'mt', [1, 4]]] },
    { id: 'p8', level: 2, title: 'De Morgan in a proof', premises: ['¬(P ∨ Q)', 'R ⇒ P'], goal: '¬R',
      ref: [['¬P ∧ ¬Q', 'demorgan', [1]], ['¬P', 'andelim', [3]], ['¬R', 'mt', [2, 4]]] },
    { id: 'p9', level: 3, title: 'Wumpus world: no pit in [1,2]', story: 'AIMA §7.5.1 (Module 3 deck). R₁ … R₅ are the agent’s KB after visiting [1,1] and [2,1]: no breeze in [1,1], breeze in [2,1].',
      premises: ['¬P1,1', 'B1,1 ⇔ (P1,2 ∨ P2,1)', 'B2,1 ⇔ (P1,1 ∨ P2,2 ∨ P3,1)', '¬B1,1', 'B2,1'], goal: '¬P1,2',
      ref: [['(B1,1 ⇒ (P1,2 ∨ P2,1)) ∧ ((P1,2 ∨ P2,1) ⇒ B1,1)', 'biconditional', [2]],
        ['(P1,2 ∨ P2,1) ⇒ B1,1', 'andelim', [6]],
        ['¬B1,1 ⇒ ¬(P1,2 ∨ P2,1)', 'contraposition', [7]],
        ['¬(P1,2 ∨ P2,1)', 'mp', [8, 4]],
        ['¬P1,2 ∧ ¬P2,1', 'demorgan', [9]],
        ['¬P1,2', 'andelim', [10]]] },
    { id: 'p10', level: 3, title: 'Wumpus world: no pit in [2,1] either', story: 'Same start as before, but now show that [2,1] is pit-free too. Try it with Modus Tollens instead of contraposition.',
      premises: ['B1,1 ⇔ (P1,2 ∨ P2,1)', '¬B1,1'], goal: '¬P2,1',
      ref: [['(B1,1 ⇒ (P1,2 ∨ P2,1)) ∧ ((P1,2 ∨ P2,1) ⇒ B1,1)', 'biconditional', [1]],
        ['(P1,2 ∨ P2,1) ⇒ B1,1', 'andelim', [3]],
        ['¬(P1,2 ∨ P2,1)', 'mt', [4, 2]],
        ['¬P1,2 ∧ ¬P2,1', 'demorgan', [5]],
        ['¬P2,1', 'andelim', [6]]] },
    { id: 'p11', level: 3, title: 'Exam style', story: 'Given: if the battery is dead (D) the car won’t start (S is “starts”). Either the battery is dead or the fuel is empty (E). The fuel is not empty. Show the car does not start.',
      premises: ['D ⇒ ¬S', 'D ∨ E', '¬E'], goal: '¬S',
      ref: [['D', 'unitres', [2, 3]], ['¬S', 'mp', [1, 4]]] },
  ];

  // ── CNF conversion: one law per line. ref = the AIMA strategy trace (generated, not hand-typed — see test).
  const cnf = [
    { id: 'c1', level: 1, title: '⇒-elimination', start: 'P ⇒ Q' },
    { id: 'c2', level: 1, title: 'De Morgan', start: '¬(P ∧ Q)' },
    { id: 'c3', level: 1, title: 'Biconditional', start: 'P ⇔ Q', note: 'Warm-up sample A on the CNF practice sheet.' },
    { id: 'c4', level: 2, title: 'Distribution', start: 'A ⇒ (B ∧ C)', note: 'Sample B on the CNF practice sheet.' },
    { id: 'c5', level: 2, title: 'Negated implication', start: '¬(A ⇒ B)' },
    { id: 'c6', level: 2, title: 'Practice sheet Q1', start: '¬(P ∨ ¬Q) ⇒ R' },
    { id: 'c7', level: 2, title: 'Wumpus breeze rule', start: 'B1,1 ⇔ (P1,2 ∨ P2,1)', note: 'The textbook example (AIMA §7.5.2).' },
    { id: 'c8', level: 3, title: 'Practice sheet Q2', start: 'A ⇔ (B ∨ C)' },
    { id: 'c9', level: 3, title: 'Practice sheet Q3', start: '(P ∨ Q) ⇒ (R ∧ S)' },
    { id: 'c10', level: 3, title: 'Two conjunctions', start: '(A ∧ B) ∨ (C ∧ D)' },
    { id: 'c11', level: 3, title: 'Biconditional with ∧', start: 'P ⇔ (Q ∧ R)' },
  ];

  // ── Resolution refutation. kb: sentences; alpha: query. given: true → the clause set of KB ∧ ¬α is handed out.
  //    ref: list of [i, j] pairs (1-based line numbers over the clause list, then the resolvents in order).
  const resolution = [
    { id: 'r1', level: 1, title: 'Two clauses', kb: ['P ∨ Q', '¬P'], alpha: 'Q', given: true,
      clauses: ['P ∨ Q', '¬P', '¬Q'], ref: [[1, 2], [3, 4]] },
    { id: 'r2', level: 1, title: 'Proof by cases', kb: ['P ∨ Q', '¬P ∨ R', '¬Q ∨ R'], alpha: 'R', given: true,
      clauses: ['P ∨ Q', '¬P ∨ R', '¬Q ∨ R', '¬R'], ref: [[1, 2], [5, 3], [6, 4]] },
    { id: 'r3', level: 2, title: 'Wumpus: no pit in [1,2]', story: 'AIMA §7.5.2: KB = R₂ ∧ R₄, prove ¬P1,2. The clauses of KB ∧ ¬α are given.',
      kb: ['B1,1 ⇔ (P1,2 ∨ P2,1)', '¬B1,1'], alpha: '¬P1,2', given: true,
      clauses: ['¬B1,1 ∨ P1,2 ∨ P2,1', '¬P1,2 ∨ B1,1', '¬P2,1 ∨ B1,1', '¬B1,1', 'P1,2'], ref: [[2, 5], [4, 6]] },
    { id: 'r4', level: 2, title: 'Write the clauses yourself', kb: ['P ⇒ Q', 'Q ⇒ R', 'P'], alpha: 'R', given: false,
      clauses: ['¬P ∨ Q', '¬Q ∨ R', 'P', '¬R'], ref: [[1, 3], [2, 5], [6, 4]] },
    { id: 'r5', level: 2, title: 'Conjunction in the premise', kb: ['P ∧ Q ⇒ R', 'P', 'Q'], alpha: 'R', given: false,
      clauses: ['¬P ∨ ¬Q ∨ R', 'P', 'Q', '¬R'], ref: [[1, 2], [5, 3], [6, 4]] },
    { id: 'r6', level: 3, title: 'Exam style: a chain', story: 'A ⇒ B, B ⇒ C, C ⇒ D and A are given. Prove D by resolution.',
      kb: ['A ⇒ B', 'B ⇒ C', 'C ⇒ D', 'A'], alpha: 'D', given: false,
      clauses: ['¬A ∨ B', '¬B ∨ C', '¬C ∨ D', 'A', '¬D'], ref: [[1, 4], [2, 6], [3, 7], [8, 5]] },
    { id: 'r7', level: 3, title: 'Two ways to the same place', kb: ['P ∨ Q', 'P ⇒ R', 'Q ⇒ R'], alpha: 'R', given: false,
      clauses: ['P ∨ Q', '¬P ∨ R', '¬Q ∨ R', '¬R'], ref: [[2, 4], [3, 4], [1, 5], [7, 6]] },
  ];

  // ── Forward / backward chaining on definite clauses. ref (fc): rule numbers fired in order. ref (bc): [goal, rule|'fact'].
  const AIMA_716 = ['P ⇒ Q', 'L ∧ M ⇒ P', 'B ∧ L ⇒ M', 'A ∧ P ⇒ L', 'A ∧ B ⇒ L', 'A', 'B'];
  const FROG = ['Croaks ∧ EatsFlies ⇒ Frog', 'Chirps ∧ Sings ⇒ Canary', 'Frog ⇒ Green', 'Canary ⇒ Yellow', 'Croaks', 'EatsFlies'];
  const WUMPUS_DC = ['NoBreeze11 ⇒ Safe12', 'NoBreeze11 ⇒ Safe21', 'NoStench11 ∧ Safe12 ⇒ OK12', 'Safe21 ∧ NoStench21 ⇒ OK21', 'OK12 ∧ OK21 ⇒ Explore', 'NoBreeze11', 'NoStench11', 'NoStench21'];
  const fc = [
    { id: 'f1', level: 1, title: 'Frog or canary?', story: 'The classic expert-system example. Is the pet green?', rules: FROG, query: 'Green', ref: [1, 3] },
    { id: 'f2', level: 2, title: 'AIMA Figure 7.16', story: 'The textbook FC example (Module 3 deck). Fire rules until Q is inferred.', rules: AIMA_716, query: 'Q', ref: [5, 3, 2, 1] },
    { id: 'f3', level: 2, title: 'Wumpus as rules', story: 'A simplified Wumpus KB written as definite clauses.', rules: WUMPUS_DC, query: 'Explore', ref: [1, 2, 3, 4, 5] },
  ];
  const bc = [
    { id: 'b1', level: 1, title: 'Frog or canary?', story: 'Same KB as in forward chaining — now work backwards from the query.', rules: FROG, query: 'Green',
      ref: [['Green', 3], ['Frog', 1], ['Croaks', 'fact'], ['EatsFlies', 'fact']] },
    { id: 'b2', level: 2, title: 'AIMA Figure 7.16', story: 'The textbook BC example. Watch out: rule 4 needs P, and proving P needs L — a loop. Pick the rule for L that avoids it.',
      rules: AIMA_716, query: 'Q',
      ref: [['Q', 1], ['P', 2], ['L', 5], ['A', 'fact'], ['B', 'fact'], ['M', 3], ['B', 'fact'], ['L', 5], ['A', 'fact'], ['B', 'fact']] },
  ];

  return { TRACKS, patterns, cnf, resolution, fc, bc };
});
