// Known student mistakes must be REJECTED with the right diagnosis; known-good shortcuts accepted. node bench/test-mistakes.mjs
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
const L = require('../logic-core.js'), X = require('../exercises.js'), LS = require('../lab-session.js');
const ex = (t, id) => X[t].find((e) => e.id === id);
let fail = 0; const T = (name, got, want) => { const ok = want(got); if (!ok) fail++; console.log((ok ? 'ok ' : '✗  ') + name + (ok ? '' : '  → ' + JSON.stringify(got).slice(0, 220))); };
const rw = (a, b, r) => L.diagnoseRewrite(L.parse(a), L.parse(b), r, { track: 'cnf' });
T('De Morgan without flipping', rw('~(P & Q)', '~P & ~Q', 'demorgan'), (d) => d.bug === 'demorgan-noflip');
T('⇒-elim negating the wrong side', rw('P => Q', 'P | ~Q', 'implication'), (d) => d.bug === 'imp-wrong-side');
T('converse is not equivalent', rw('P => Q', 'Q => P', 'contraposition'), (d) => d.bug === 'converse');
T('inverse is not equivalent', rw('P => Q', '~P => ~Q', 'contraposition'), (d) => d.bug === 'inverse');
T('⇔ as ∨ of implications', rw('A <=> B', '(A => B) | (B => A)', 'biconditional'), (d) => d.bug === 'bicond-or');
T('distribution dropping a copy', rw('P | (Q & R)', '(P | Q) & R', 'distribution'), (d) => d.bug === 'distr-drop');
T('¬(A⇒B) as ¬A⇒¬B', rw('~(A => B)', '~A => ~B', 'demorgan'), (d) => d.bug === 'neg-imp');
T('right line, wrong rule name', rw('~(P | Q)', '~P & ~Q', 'implication'), (d) => d.verdict === 'wrongrule' && d.ok);
T('combined steps accepted with note', rw('A <=> B', '(~A | B) & (~B | A)', 'biconditional'), (d) => d.ok && d.verdict === 'combined');
T('not equivalent gives counterexample', rw('P | Q', 'P & Q', 'distribution'), (d) => !d.ok && d.counter);
// inference
const s1 = LS.create('patterns', { premises: ['P => Q', 'Q'], goal: 'P' });
T('affirming the consequent', s1.add({ f: 'P', rule: 'mp', cites: [1, 2] }), (d) => d.bug === 'affirm-consequent');
const s2 = LS.create('patterns', { premises: ['P => Q', '~P'], goal: '~Q' });
T('denying the antecedent', s2.add({ f: '~Q', rule: 'mt', cites: [1, 2] }), (d) => d.bug === 'deny-antecedent');
const s3 = LS.create('patterns', ex('patterns', 'p2'));
T('wrong citation flagged', s3.add({ f: 'R', rule: 'mp', cites: [2] }), (d) => !d.ok);
T('× line cannot be cited', (s3.add({ f: 'R', rule: 'mp', cites: [2, 3] })), (d) => !d.ok && /marked ×/.test(d.msg));
// resolution
const r4 = LS.create('resolution', ex('resolution', 'r4'));
T('setup: adding α instead of ¬α', r4.add({ f: 'R', rule: 'clause' }), (d) => !d.ok && /NEGATION/.test(d.msg));
T('setup: a cross-sentence consequence is not a setup clause', r4.add({ f: 'Q', rule: 'clause' }), (d) => !d.ok && /combining several/.test(d.msg));
T('setup: ¬α accepted', r4.add({ f: '~R', rule: 'clause' }), (d) => d.ok && /negated goal/.test(d.msg));
const r2 = LS.create('resolution', ex('resolution', 'r2'));
T('resolve: clauses with no clash', r2.add({ f: 'P | R', rule: 'resolve', cites: [2, 3] }), (d) => !d.ok);
T('two pairs at once', L.checkResolution(L.clauseOf(L.parse('P | Q')), L.clauseOf(L.parse('~P | ~Q')), []), (d) => d.bug === 'two-pairs');
// fc / bc
const f2 = LS.create('fc', ex('fc', 'f2'));
T('fc: rule fired too early', f2.add({ ruleNo: 2, head: 'P' }), (d) => !d.ok && /cannot fire yet/.test(d.msg));
const b2 = LS.create('bc', ex('bc', 'b2'));
b2.add({ goal: 'Q', ruleNo: 1 }); b2.add({ goal: 'P', ruleNo: 2 });
T('bc: loop via rule 4 (L needs P)', b2.add({ goal: 'L', ruleNo: 4 }), (d) => !d.ok && d.verdict === 'loop');
// parser
for (const s of ['P1,2 ∨ ¬B1,1', 'A <-> (B v C)', 'not P and Q implies R', '(P', 'P Q', '']) { const r = L.tryParse(s); console.log('   parse', JSON.stringify(s), '→', r.ok ? L.show(r.f) : 'error: ' + r.error); }
console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL mistake tests pass'); process.exit(fail ? 1 : 0);
