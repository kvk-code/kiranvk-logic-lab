# English ⇄ FOL — research notes (Logic Lab, PECST522 Module 3)

Written 2026-10-06, before/while building the "English ⇄ FOL" section. Records which existing engines and
parsers were considered for the three jobs — FOL parsing/pretty-printing, FOL → English, and equivalence
checking in practice mode — and the verdict on each.

## Constraints that decide everything

- The page is a **static, BYOK** page on shared cPanel hosting (kiranvk.me/ai/logic-lab/). The only server-side
  code is `ai.php`, a thin relay to NVIDIA NIM using the *student's own* key. There is no Python/Java/Prolog
  runtime we control, and no server process we can keep alive.
- So any "engine" must be either (a) a **free, CORS-callable hosted API**, or (b) something that runs **in the
  browser** (JS or WASM), or (c) done through the one NL call we already have (NVIDIA).
- It must work **offline / without a key** for everything except the English → FOL step (that one is inherently NL).

## Candidates considered

| Tool | What it does | CORS-callable free? | In-browser? | Verdict |
|---|---|---|---|---|
| **Grammatical Framework (GF)** | Grammar-based NL ⇄ logic, bidirectional | No hosted free CORS API; the GF runtime is Haskell/C (a `pgf.js`/WASM port exists but is heavy and the grammars for FOL are large) | Only as a big WASM payload + grammar | **Rejected** — payload and grammar authoring cost far exceed the need; a classroom FOL translator does not need a full CG grammar. |
| **Boxer + C&C** (DRT/λ-calculus semantics) | English → logical form | No free hosted CORS API; needs the C&C tools (C++/Prolog) server-side | No | **Rejected** — server runtime we do not have. |
| **NLTK `logic`** (`LogicParser`, `Expression`) | FOL parse + model/theorem via Prover9/Mace4 | Python library, not an API | No | **Rejected for runtime**; its **parser grammar and `\.` quantifier syntax were a useful reference** for our own parser (accepting `all`/`exists`, `->`, `&`). |
| **Stanford "Logic" / Epilog** | FOL tools, some web demos | Demos are not a stable CORS API | No | **Rejected** — not an API we can call. |
| **Tarski's World** | Teaching tool, models in a blocks world | Desktop app | No | **Rejected** — not callable; but its "find a world where they differ" idea is exactly the counter-model we show. |
| **Prover9 / Mace4** | Theorem prover + finite model finder | No free CORS API; native binaries | A Mace4-style search is trivial to reimplement | **Idea reused, tool rejected.** Mace4's *finite-model* method is the right one for equivalence over small domains — reimplemented in JS (see below). |
| **Z3 (z3-wasm / z3-solver)** | SMT; FOL with quantifiers via patterns | WASM exists | Yes, but **~5 MB** and quantified FOL is only semi-decidable | **Rejected** — megabytes of payload for an in-general-undecidable problem, on a page meant to load fast on a college phone. The finite-domain check below is a few kB and is *complete* for the small worlds a student reasons about. |

## Decisions

1. **FOL parsing + pretty-printing + FOL → English → deterministic, in-browser** (`fol-core.js`), built on the
   same AST conventions as the existing propositional `logic-core.js`. No dependency. The parser accepts Unicode
   (`∀ ∃ ¬ ∧ ∨ ⇒ ⇔`) and ASCII (`all exists not and or -> <->`, `[...]` grouping), with AIMA-correct precedence
   (¬ > ∧ > ∨ > ⇒ > ⇔, quantifier scope extends to the right — AIMA 4e Fig 8.3).

2. **Equivalence in practice mode → finite-model (Mace4-style) search in JS.** Over a fixed small domain
   (sizes 1..3) the models of a formula are finite and enumerable, so equivalence is decidable by looking for a
   model where the two formulas disagree. The implementation enumerates predicate truth-tables, function tables
   and constant assignments over the combined signature (guarded against blow-up), and returns a concrete
   counter-model to show the student. This is `finiteEquivalent` / `finiteEntails` in `fol-core.js`.
   *Limitation (stated in the UI):* it is complete only up to the domain cap — two formulas that differ only on
   larger/infinite models would be accepted. Acceptable for the Module 3 teaching cases.

3. **English → FOL → the NVIDIA relay (the one NL call), then validate deterministically.** The model is asked
   for a single formula; the deterministic parser must accept it (else it is sent back to repair, up to 3 tries),
   and the formula is **back-translated to English** by our FOL → English so the student can compare meaning. The
   AI proposes; the engine checks. Same verify-and-repair spirit as the existing tutor (`ai-verify.js`).

## What we ported / reused from inside this repo

- AST shape, parser/printer structure, truth-table style and the `key()` canonicalisation idea from
  `logic-core.js` (itself ported from aima-python, MIT).
- The verify-and-repair loop pattern from `ai.php` / `ai-verify.js` (Wumpus-justify lineage).
