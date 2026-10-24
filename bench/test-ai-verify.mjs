// The engine must accept faithful AI explanations and catch false ones. node bench/test-ai-verify.mjs
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
const LS = require('../lab-session.js'), V = require('../ai-verify.js'), X = require('../exercises.js');
let fail = 0; const T = (n, got, want) => { const ok = want(got); if (!ok) fail++; console.log((ok ? 'ok ' : '✗  ') + n + (ok ? '' : '  → ' + JSON.stringify(got))); };
// a board: Exam ⇒ Study, Study ∧ Sleep ⇒ Pass, ¬Pass, Sleep ⊢ ¬Exam
const s = LS.create('patterns', { premises: ['Exam => Study', 'Study & Sleep => Pass', '~Pass', 'Sleep'], goal: '~Exam' });
s.add({ f: '~(Study & Sleep)', rule: 'mt', cites: [2, 3] });        // line 5 ✓
s.add({ f: 'Exam', rule: 'mp', cites: [1, 5] });                     // line 6 ×
T('faithful MT explanation passes', V.verify('Modus Tollens: line 2 says Study ∧ Sleep ⇒ Pass and line 3 says ¬Pass, so ¬(Study ∧ Sleep) must hold.', s, { kind: 'step', line: 5 }), (r) => !r.issues.length);
T('wrong rule name caught', V.verify('This is Modus Ponens on lines 2 and 3: we get ¬(Study ∧ Sleep).', s, { kind: 'step', line: 5 }), (r) => r.issues.some((i) => /Modus Tollens/.test(i)));
T('false formula claim caught', V.verify('From this we also get ¬Sleep ∧ Study, which is useful.', s, { kind: 'ask' }), (r) => r.issues.some((i) => /does NOT follow/.test(i)));
T('entailed but off-board formula allowed', V.verify('Since Sleep is true, ¬Study follows, and then ¬Exam.', s, { kind: 'ask' }), (r) => !r.issues.length);
T('"X is false" checked as ¬X', V.verify('So Study ∧ Sleep is false.', s, { kind: 'ask' }), (r) => !r.issues.length);
T('wrong "X is false" caught', V.verify('So Exam ⇒ Study is false.', s, { kind: 'ask' }), (r) => r.issues.length > 0);
T('calling × line correct caught', V.verify('Line 6 is correct — nice use of Modus Ponens.', s, { kind: 'ask' }), (r) => r.issues.some((i) => /× wrong/.test(i)));
T('calling ✓ line wrong caught', V.verify('Line 5 is wrong because you cannot negate a conjunction.', s, { kind: 'ask' }), (r) => r.issues.length > 0);
T('honest × explanation passes', V.verify('You cannot use Modus Ponens here: line 5 is ¬(Study ∧ Sleep), which is not the left side of Exam ⇒ Study.', s, { kind: 'step', line: 6 }), (r) => !r.issues.length);
// CNF board
const c = LS.create('cnf', X.cnf.find((e) => e.id === 'c8'));
c.add({ f: '(A => (B | C)) & ((B | C) => A)', rule: 'biconditional' });
T('cnf: equivalent rewrite of a part passes', V.verify('Next, A ⇒ (B ∨ C) becomes ¬A ∨ B ∨ C by implication elimination.', c, { kind: 'explain' }), (r) => !r.issues.length);
T('cnf: non-equivalent claim caught', V.verify('Then (B ∨ C) ⇒ A becomes B ∨ C ∨ ¬A.', c, { kind: 'explain' }), (r) => r.issues.length > 0);
console.log(V.extractFormulas('line 2 says Study ∧ Sleep ⇒ Pass and line 3 says ¬Pass, so ¬(Study ∧ Sleep) must hold.').map((x) => x.text));
console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL ai-verify tests pass'); process.exit(fail ? 1 : 0);
