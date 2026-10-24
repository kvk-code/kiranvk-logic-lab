// FOL core must parse the Module 3 sentences, render English, and check equivalence over finite domains correctly.
//   node bench/test-fol.mjs
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
const F = require('../fol-core.js'), EX = require('../fol-examples.js');
let fail = 0;
const T = (n, got, want) => { const ok = want(got); if (!ok) fail++; console.log((ok ? 'ok ' : '✗  ') + n + (ok ? '' : '  → ' + JSON.stringify(got))); };

// ── parsing: every offline example parses (Unicode) and its ASCII-ish forms where applicable
for (const e of EX) T('parse: ' + e.fol, F.tryParse(e.fol), (r) => r.ok);

// ── ASCII input accepted and canonicalised
T('ascii all/-> parses', F.tryParse('all x Bird(x) -> Fly(x)'), (r) => r.ok);
T('ascii exists/& parses', F.tryParse('exists x Student(x) & Smart(x)'), (r) => r.ok);
T('ascii == same as unicode', F.same(F.parse('all x P(x) -> Q(x)'), F.parse('∀x P(x) ⇒ Q(x)')), (x) => x === true);

// ── quantifier scope: ∀x A(x) ⇒ B(x) means ∀x (A(x) ⇒ B(x)), not (∀x A(x)) ⇒ B(x)
T('quantifier scope extends right', F.show(F.parse('∀x Bird(x) ⇒ Fly(x)')), (s) => s === '∀x (Bird(x) ⇒ Fly(x))');

// ── pretty-printer round-trips
const rt = (s) => F.same(F.parse(s), F.parse(F.show(F.parse(s))));
T('round-trip nested', rt('∀x (∀y Animal(y) ⇒ Loves(x, y)) ⇒ (∃z Loves(z, x))'), (x) => x === true);
T('round-trip breezy', rt('∀r∀p (Adjacent(r,p) ∧ Pit(p)) ⇒ Breezy(r)'), (x) => x === true);

// ── English rendering keeps the key shapes recognisable
T('every..is..', /every bird/.test(F.toEnglish(F.parse('∀x Bird(x) ⇒ Fly(x)'))), (x) => x);
T('not all..', /not every bird/.test(F.toEnglish(F.parse('¬(∀x Bird(x) ⇒ Fly(x))'))), (x) => x);
T('no..', /^no bird/.test(F.toEnglish(F.parse('¬∃x Bird(x) ∧ Swim(x)'))), (x) => x);
T('some..', /some student/.test(F.toEnglish(F.parse('∃x Student(x) ∧ Smart(x)'))), (x) => x);

// ── pattern notes name the rule
T('∀⇒ note', F.patternNotes(F.parse('∀x Bird(x) ⇒ Fly(x)')).some((n) => /∀ pairs with ⇒/.test(n)), (x) => x);
T('∃∧ note', F.patternNotes(F.parse('∃x A(x) ∧ B(x)')).some((n) => /∃ pairs with ∧/.test(n)), (x) => x);
T('∃⇒ warning', F.patternNotes(F.parse('∃x A(x) ⇒ B(x)')).some((n) => /mistake/i.test(n)), (x) => x);
T('not-all note', F.patternNotes(F.parse('¬∀x A(x) ⇒ B(x)')).some((n) => /not all/i.test(n)), (x) => x);
T('∀∃ order note', F.patternNotes(F.parse('∀x ∃y L(x,y)')).some((n) => /own y/i.test(n)), (x) => x);
T('∃∀ order note', F.patternNotes(F.parse('∃y ∀x L(x,y)')).some((n) => /same y/i.test(n)), (x) => x);

// ── finite-domain equivalence (Mace4-style)
const eq = (a, b) => F.finiteEquivalent(F.parse(a), F.parse(b)).equivalent;
T('¬∀(A⇒B) ≡ ∃(A∧¬B)  (not-all)', eq('¬(∀x A(x) ⇒ B(x))', '∃x A(x) ∧ ¬B(x)'), (x) => x === true);
T('¬∃(A∧B) ≡ ∀(A⇒¬B)  (no)', eq('¬∃x A(x) ∧ B(x)', '∀x A(x) ⇒ ¬B(x)'), (x) => x === true);
T('double negation ≡', eq('∀x ¬¬P(x)', '∀x P(x)'), (x) => x === true);
T('commutativity of ∧ ≡', eq('∃x A(x) ∧ B(x)', '∃x B(x) ∧ A(x)'), (x) => x === true);
T('∀∃ NOT ≡ ∃∀', eq('∀x ∃y L(x,y)', '∃y ∀x L(x,y)'), (x) => x === false);
T('∀⇒ NOT ≡ ∀∧ (classic error)', eq('∀x A(x) ⇒ B(x)', '∀x A(x) ∧ B(x)'), (x) => x === false);
T('∃∧ NOT ≡ ∃⇒ (classic error)', eq('∃x A(x) ∧ B(x)', '∃x A(x) ⇒ B(x)'), (x) => x === false);

// ── one-directional entailment
T('∃∀ ⊨ ∀∃', F.finiteEntails(F.parse('∃y ∀x L(x,y)'), F.parse('∀x ∃y L(x,y)')).entails, (x) => x === true);
T('∀∃ ⊭ ∃∀', F.finiteEntails(F.parse('∀x ∃y L(x,y)'), F.parse('∃y ∀x L(x,y)')).entails, (x) => x === false);

// ── counter-model returned when not equivalent
const cm = F.finiteEquivalent(F.parse('∀x A(x) ⇒ B(x)'), F.parse('∀x A(x) ∧ B(x)'));
T('counter-model present for a false equivalence', cm, (r) => !r.equivalent && r.counter && r.counter.dom >= 1);

// ── glossary extraction
const g = F.glossary(F.parse('∀x King(x) ⇒ Person(x)'));
T('glossary lists predicates', g.preds.length === 2 && /king/.test(g.preds[0].gloss), (x) => x);
const g2 = F.glossary(F.parse('Rich(FatherOf(John))'));
T('glossary lists function + constant', g2.funs.length === 1 && g2.consts.length === 1, (x) => x);

// ── bad input rejected
T('unbalanced bracket rejected', F.tryParse('∀x (A(x) ⇒ B(x)'), (r) => !r.ok);
T('two operators rejected', F.tryParse('∀x A(x) ∧ ∨ B(x)'), (r) => !r.ok);
T('empty rejected', F.tryParse('   '), (r) => !r.ok);

console.log(fail ? `\n${fail} FAILURE(S)` : `\nALL FOL tests pass (${EX.length} examples + engine)`);
process.exit(fail ? 1 : 0);
