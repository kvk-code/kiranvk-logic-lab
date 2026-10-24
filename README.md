# Logic Lab — step-by-step propositional {{TITLE}} first-order logic practice

**Live:** https://kiranvk.me/ai/logic-lab/  ·  free, no login

Students write a derivation one line at a time and every line gets an instant ✓ or × with a precise reason.
Tracks: reasoning patterns, CNF conversion, resolution refutation, forward/backward chaining, and an English ⇄ FOL section
(PECST522 Artificial Intelligence, Module 3, KTU 2024 scheme). **Unstuck** gives three levels of help; a handwriting pad
recognises logic symbols with a small in-browser CNN.

## Files
| File | Role |
|---|---|
| `logic-core.js` | Parser, equivalence laws, buggy-rule diagnosis, CNF, resolution, FC/BC, hint search |
| `lab-session.js` | One attempt as a state machine (shared by the page and the tests) |
| `exercises.js` | Exercise bank, each with a reference solution |
| `fol-core.js`, `fol-section.js`, `fol-examples.js` | English ⇄ FOL section |
| `ai-verify.js` | Checks every AI explanation against the logic engine before it is shown |
| `ink.js`, `ink-model.*` | Handwriting recogniser (int8 CNN, runs in the browser) |
| `ai.php` | Thin relay to NVIDIA NIM with the **student's own** key (never stored) |
| `ink-collect.php` | Optional opt-in handwriting samples (stored outside the web root) |
| `bench/` | Tests · `train/` | Training scripts for the ink model |

## Run it locally
```bash
git clone https://github.com/kvk-code/kiranvk-logic-lab.git && cd kiranvk-logic-lab
php -S localhost:8000        # then open http://localhost:8000/
```
```bash
node bench/test-exercises.mjs && node bench/test-mistakes.mjs && node bench/test-ai-verify.mjs && node bench/test-fol.mjs
```
`ai.php` expects the shared helper `../wumpus/lib.php` (from [kiranvk-wumpus-justify](https://github.com/kvk-code/kiranvk-wumpus-justify)); everything except the AI tutor works without it.

## AI features and secrets
The AI tutor is optional and *bring-your-own-key*: students paste a free NVIDIA key from build.nvidia.com; it is sent for one call and never stored or logged.
No key, password or log file is in this repository. Server-side settings live in a config directory **outside the web root** and are never published.

## Relationship to the website
This repo is an exact mirror of https://kiranvk.me/ai/logic-lab/. Every deploy of the site publishes the same files here (`sync:` commits).
Community pull requests are reviewed, merged into the site source, deployed, and then come back here with the next sync.

## Licence
Code: MIT (see `LICENSE`). Third-party components and data: see `THIRD_PARTY.md` where present.
Built by **Kiran V K**, Assistant Professor, Dept. of CSE, NSS College of Engineering, Palakkad, for KTU students. Live: https://kiranvk.me/ai/logic-lab/
