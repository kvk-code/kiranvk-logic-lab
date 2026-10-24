/* Logic Lab — offline English ⇄ FOL examples, sourced from the PECST522 Module 3 slides (KTU 2024).
 * Every example works WITHOUT an NVIDIA key: the formula, glossary, English reading and pattern notes are all
 * produced deterministically by fol-core.js. The `teach` note names the translation rule a student should learn.
 * Slide provenance is in `from` (slides/module3/sNN_*.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FOLExamples = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return [
    { en: 'Every student is smart.', fol: '∀x Student(x) ⇒ Smart(x)', teach: '∀ pairs with ⇒.', from: 's22', tags: ['∀', '⇒'] },
    { en: 'Some student is smart.', fol: '∃x Student(x) ∧ Smart(x)', teach: '∃ pairs with ∧.', from: 's22', tags: ['∃', '∧'] },
    { en: 'All kings are persons.', fol: '∀x King(x) ⇒ Person(x)', teach: '∀ … ⇒ … (the universal workhorse).', from: 's21', tags: ['∀', '⇒'] },
    { en: 'There is a king who is rich.', fol: '∃x King(x) ∧ Rich(x)', teach: '∃ … ∧ …', from: 's21', tags: ['∃', '∧'] },
    { en: 'Everyone loves someone.', fol: '∀x ∃y Loves(x, y)', teach: '∀x∃y — each person may love a different someone.', from: 's22', tags: ['∀', '∃', 'order'] },
    { en: 'Someone is loved by everyone.', fol: '∃y ∀x Loves(x, y)', teach: '∃y∀x — one same person loved by all. Swapping ∀/∃ changes the meaning.', from: 's22', tags: ['∃', '∀', 'order'] },
    { en: 'Not all birds fly.', fol: '¬(∀x Bird(x) ⇒ Fly(x))', teach: '“not all …” = ¬∀ ≡ ∃x Bird(x) ∧ ¬Fly(x).', from: 's22', tags: ['¬', '∀', 'not-all'] },
    { en: 'No bird can swim.', fol: '¬∃x Bird(x) ∧ Swim(x)', teach: '“no …” = ¬∃ ≡ ∀x Bird(x) ⇒ ¬Swim(x).', from: 's22', tags: ['¬', '∃', 'no'] },
    { en: 'A room is breezy if an adjacent room has a pit.', fol: '∀r∀p (Adjacent(r,p) ∧ Pit(p)) ⇒ Breezy(r)', teach: 'The Wumpus breezy rule: two ∀, body is (∧) ⇒ consequent.', from: 's05/s22', tags: ['∀', '⇒', 'wumpus'] },
    { en: "John's father is rich.", fol: 'Rich(FatherOf(John))', teach: 'A function term FatherOf(John) names an object — no quantifier needed.', from: 's22', tags: ['function'] },
    { en: 'Every student who studies passes.', fol: '∀x (Student(x) ∧ Studies(x)) ⇒ Pass(x)', teach: 'Restriction can be a conjunction on the LEFT of ⇒.', from: 's22', tags: ['∀', '⇒'] },
    { en: 'No student likes Monday.', fol: '∀x Student(x) ⇒ ¬Likes(x, Monday)', teach: '“no X does Y” as ∀x X(x) ⇒ ¬Y(x). Monday is a constant.', from: 's22', tags: ['∀', '¬'] },
    { en: 'John has a crown on his head.', fol: '∃c Crown(c) ∧ On(c, HeadOf(John))', teach: '∃ for the crown; HeadOf(John) is a function term.', from: 's22', tags: ['∃', '∧', 'function'] },
    { en: 'John likes all food.', fol: '∀x Food(x) ⇒ Likes(John, x)', teach: '“likes all food” — ∀ over food, John fixed.', from: 's24', tags: ['∀', '⇒'] },
    { en: 'Everyone who loves all animals is loved by someone.', fol: '∀x (∀y Animal(y) ⇒ Loves(x, y)) ⇒ (∃z Loves(z, x))', teach: 'The AIMA “loves all animals” sentence: a ∀ inside the restriction of a ∀.', from: 's24', tags: ['∀', '∃', 'nested'] },
    { en: 'Anyone who kills an animal is loved by no one.', fol: '∀x (∃y Animal(y) ∧ Kills(x, y)) ⇒ ¬(∃z Loves(z, x))', teach: 'The companion sentence: ∃ in the restriction, ¬∃ in the consequent.', from: 's24', tags: ['∀', '∃', '¬', 'nested'] },
    { en: 'Cats are killed by everyone who is curious.', fol: '∀x∀y (Cat(x) ∧ Curious(y)) ⇒ Kill(y, x)', teach: 'Two universals, binary predicate Kill(y, x).', from: 's24', tags: ['∀', '⇒'] },
    { en: 'Every number is even or odd.', fol: '∀x Number(x) ⇒ (Even(x) ∨ Odd(x))', teach: '∨ sits inside the consequent of ∀ … ⇒ ….', from: 's21', tags: ['∀', '∨'] },
    { en: 'Something is both red and round.', fol: '∃x Red(x) ∧ Round(x)', teach: '∃ … ∧ … for “something is both …”.', from: 's21', tags: ['∃', '∧'] },
    { en: 'Every dog is an animal.', fol: '∀x Dog(x) ⇒ Animal(x)', teach: 'The simplest “every A is a B”. The template for most ∀ translations.', from: 's21', tags: ['∀', '⇒'] },
  ];
});
