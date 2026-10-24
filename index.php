<?php
// Logic Lab shell — cache-busts every asset by mtime so a deploy is visible on the next load.
header('Cache-Control: no-cache, no-store, must-revalidate');
$v = fn($f) => $f . '?v=' . @filemtime(__DIR__ . '/' . $f);
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Logic Lab — Propositional Logic Derivations, CNF &amp; Resolution | PECST522 AI (KTU S5) · kiranvk.me</title>
<meta name="description" content="Practise propositional-logic derivations step by step: reasoning patterns, CNF, resolution, forward and backward chaining. Every step is checked instantly. A free in-browser proof lab for KTU PECST522 Artificial Intelligence, Module 3.">
<link rel="canonical" href="https://kiranvk.me/ai/logic-lab/">
<meta name="author" content="Kiran V.K.">
<meta name="keywords" content="propositional logic, first-order logic, CNF, resolution, forward chaining, backward chaining, Modus Ponens, natural deduction, KTU, PECST522, Artificial Intelligence, S5 CSE, knowledge representation, reasoning">
<meta name="robots" content="index, follow, max-image-preview:large">
<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="kiranvk.me">
<meta property="og:title" content="Logic Lab — Propositional Logic Derivations, CNF &amp; Resolution">
<meta property="og:description" content="A free in-browser proof lab for KTU PECST522 AI: build derivations line by line — CNF, resolution, chaining — each step checked instantly, with Unstuck hints and an optional AI tutor.">
<meta property="og:url" content="https://kiranvk.me/ai/logic-lab/">
<meta property="og:image" content="https://kiranvk.me/ai/logic-lab/og-logic-lab.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="627">
<meta property="og:locale" content="en_US">
<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Logic Lab — Propositional Logic Derivations | PECST522 AI">
<meta name="twitter:description" content="Build propositional-logic derivations step by step — CNF, resolution, forward/backward chaining. Every line checked instantly. KTU PECST522, Module 3.">
<meta name="twitter:image" content="https://kiranvk.me/ai/logic-lab/og-logic-lab.png">
<!-- JSON-LD -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": ["LearningResource", "WebApplication"],
      "@id": "https://kiranvk.me/ai/logic-lab/#app",
      "name": "Logic Lab",
      "url": "https://kiranvk.me/ai/logic-lab/",
      "description": "An in-browser proof lab for building propositional-logic derivations step by step — reasoning patterns, conversion to CNF, resolution refutation, and forward/backward chaining. Every line is checked instantly by truth tables and exact rule matching.",
      "applicationCategory": "EducationalApplication",
      "operatingSystem": "Any (web browser)",
      "browserRequirements": "Requires JavaScript; works in any modern browser",
      "isAccessibleForFree": true,
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "INR" },
      "inLanguage": "en",
      "learningResourceType": "Interactive proof assistant",
      "educationalLevel": "Undergraduate (KTU B.Tech, Semester 5)",
      "educationalUse": ["self-study", "practice", "formative assessment"],
      "teaches": [
        "Propositional logic",
        "Conjunctive normal form (CNF)",
        "Resolution refutation",
        "Forward and backward chaining",
        "Natural-deduction inference rules"
      ],
      "about": [
        { "@type": "Thing", "name": "First-order logic" },
        { "@type": "Thing", "name": "Conjunctive normal form" },
        { "@type": "Thing", "name": "Resolution" },
        { "@type": "Thing", "name": "KTU PECST522 Artificial Intelligence" }
      ],
      "author": { "@type": "Person", "name": "Kiran V.K.", "url": "https://kiranvk.me/" },
      "publisher": { "@type": "Person", "name": "Kiran V.K.", "url": "https://kiranvk.me/" },
      "isPartOf": { "@type": "Course", "name": "PECST522 Artificial Intelligence", "courseCode": "PECST522", "provider": { "@type": "CollegeOrUniversity", "name": "NSS College of Engineering, Palakkad" } }
    }
  ]
}
</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=JetBrains+Mono:wght@400;600&family=Noto+Sans+Math&display=swap" rel="stylesheet">
<link rel="stylesheet" href="<?= $v('style.css') ?>">
</head>
<body>
<noscript>
  <div style="max-width:720px;margin:2rem auto;padding:1rem 1.2rem;font-family:Georgia,serif;line-height:1.55">
    <h1>Logic Lab — Propositional-Logic Derivations</h1>
    <p>Logic Lab is a free, in-browser proof lab for <strong>KTU PECST522 Artificial Intelligence</strong> (Module 3: Knowledge Representation &amp; Reasoning, S5 CSE, NSS College of Engineering). Build propositional-logic derivations one line at a time and have every step checked instantly.</p>
    <p>It covers the core reasoning patterns (Modus Ponens, Modus Tollens, And-Elimination, resolution), conversion to <strong>conjunctive normal form (CNF)</strong>, <strong>resolution refutation</strong>, and <strong>forward and backward chaining</strong> — the same topics examined in first-order and propositional logic for PECST522. Each line is graded by truth tables and exact rule matching, with progressive “Unstuck” hints and an optional AI tutor that explains the reasoning.</p>
    <p><strong>This interactive lab needs JavaScript.</strong> Please enable it, or open the related <a href="/ai/wumpus/">Wumpus Justify</a> game and the <a href="/ai-s5/study-material/Module3_Knowledge_Reasoning.pdf">Module 3 study material</a>.</p>
  </div>
</noscript>
<header class="top">
  <div class="brand">Logic Lab<small>PECST522 · Module 3</small></div>
  <nav class="sectsw" id="sectsw" aria-label="Section">
    <button class="sect on" data-sec="deriv">Derivations</button>
    <button class="sect" data-sec="fol">English ⇄ FOL</button>
  </nav>
  <div class="grow"></div>
  <button class="chip-ai" id="ai-chip" title="AI tutor settings"><span class="dot"></span><span id="ai-chip-t">AI tutor: off</span></button>
</header>

<div id="deriv">
<nav class="tracks" id="tracks" aria-label="Tracks"></nav>
<div class="pills" id="pills" aria-label="Exercises"></div>

<section class="vidsec" aria-label="Walkthrough video">
  <div class="card vidcard">
    <div class="vidtext">
      <h2>Walkthrough <span class="vidlen">4½ min · watch first</span></h2>
      <p class="vidnote">The whole lab in one video: picking a track, writing a derivation line by line, reading the ✓/× verdicts, Unstuck hints, the English ⇄ FOL section, and the optional AI tutor.</p>
      <p class="vidlink"><a href="https://youtu.be/5qQF2ts93TU" target="_blank" rel="noopener">Watch on YouTube ↗</a></p>
    </div>
    <div class="vidframe"><iframe src="https://www.youtube-nocookie.com/embed/5qQF2ts93TU" title="Logic Lab walkthrough — derivations, CNF, resolution, chaining and English ⇄ FOL" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
  </div>
</section>

<main class="wrap">
  <section>
    <div class="card" id="excard"></div>
  </section>
  <aside class="help" id="help">
    <div class="sheet-bar"><span class="note">Your hints and answers stay here — minimise to see your lines.</span><button type="button" class="btn" id="sheet-min">▾ Minimise</button></div>
    <div class="card">
      <h2>Stuck?</h2>
      <p class="note" style="margin:4px 0 10px">Each tap goes one level deeper: ① a nudge → ② which rule (and lines) → ③ the next line.</p>
      <button class="unstuck" id="unstuck"><span>Unstuck</span><span class="meter" id="meter"><i></i><i></i><i></i></span></button>
      <div id="hint"></div>
    </div>
    <div class="card ask">
      <h2>Ask</h2>
      <div id="ask-off" class="note" style="margin:6px 0">Ask anything about your derivation. Needs your free NVIDIA key — <a href="#" id="ask-setup">set it up (2 min)</a>.</div>
      <div id="ask-on" class="hidden">
        <textarea id="ask-q" placeholder="e.g. Why can't I use Modus Ponens on line 3?"></textarea>
        <div class="actions"><button class="btn primary" id="ask-go">Ask</button><button class="btn ghost" id="explain-go" title="Explain the idea behind the next step">Explain next step</button></div>
      </div>
      <div class="thread" id="thread"></div>
    </div>
    <div class="card">
      <details class="laws"><summary>Rules &amp; laws used here</summary><ul id="laws"></ul></details>
    </div>
  </aside>
</main>
<button class="fab" id="fab">Unstuck · Ask</button>
</div>

<section id="fol" class="fol-panel hidden" aria-label="English to First-Order Logic"></section>

<footer>
  Every ✓ and × is decided by the checker (truth tables and exact rule matching), never by the AI — the AI tutor only explains.
  Algorithms ported from <a href="https://github.com/aimacode/aima-python" rel="noopener">aima-python</a> (MIT); step diagnosis and “buggy rules” after
  <a href="https://github.com/ideas-edu/ideas" rel="noopener">IDEAS / LogEx</a> (Open Universiteit). Your work stays in this browser.
  · <a href="#" id="exp">Export progress</a> · <a href="#" id="imp">Import</a>
</footer>

<div class="modal hidden" id="modal"><div class="box">
  <h3>AI tutor (optional)</h3>
  <p style="font-size:14px;margin-top:0">The checker works fully without any key (✓/×, the reasons, Unstuck). A key adds an AI tutor that knows everything on your board: a plain-English explanation under every step, the <b>Ask</b> box, <b>Explain next step</b>, and AI study notes in the PDF. It uses NVIDIA’s free API under your own account.</p>
  <ol>
    <li>Open <a href="https://build.nvidia.com/" target="_blank" rel="noopener">build.nvidia.com</a> and sign in (Google login is fine).</li>
    <li>Open any model page (e.g. <i>nemotron</i>) → <b>Get API Key</b> → <b>Generate Key</b>.</li>
    <li>Copy the key (it starts with <code>nvapi-</code>) and paste it here.</li>
  </ol>
  <div class="vidframe modal-vid"><iframe src="https://www.youtube-nocookie.com/embed/qy1mGmAkTbY" title="Get your free NVIDIA API key — step by step" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
  <p class="vidlink">Prefer to watch? <a href="https://youtu.be/qy1mGmAkTbY" target="_blank" rel="noopener">Get your free NVIDIA API key — step by step (3 min) ↗</a></p>
  <input class="fin" id="key" placeholder="nvapi-…" autocomplete="off" spellcheck="false">
  <label class="xo"><input type="checkbox" id="auto-ex" checked> Explain every step automatically — after each line you check, the AI tutor writes 1–2 sentences under it using your actual formulas (for ✗ lines: what went wrong)</label>
  <p class="note">Stored only in this browser. Sent to this site’s relay for each question and passed straight to NVIDIA — never saved on the server, never logged.</p>
  <div class="actions"><button class="btn primary" id="key-save">Save &amp; test</button><button class="btn" id="key-clear">Remove key</button><button class="btn ghost" id="key-close">Close</button></div>
  <div id="key-st" class="note" style="margin-top:8px"></div>
</div></div>
<div class="modal hidden" id="xmodal"><div class="box">
  <h3>Export as PDF</h3>
  <p style="font-size:14px;margin-top:0">A clean study sheet of this derivation: the statements, every step with its rule and the law written out, and the checker’s notes. Your browser’s print window opens — choose <b>Save as PDF</b>.</p>
  <label class="xo"><input type="checkbox" id="x-wrong" checked> Include my wrong attempts (with what was wrong)</label>
  <label class="xo"><input type="checkbox" id="x-ai"> Add AI study notes — a strategy summary, and a “why” for every step (the step explanations you saw on screen) <span class="note" id="x-ai-note"></span></label>
  <label class="xo"><input type="checkbox" id="x-qa"> Include my Ask questions and answers</label>
  <div class="actions"><button class="btn primary" id="x-go">Create PDF</button><button class="btn ghost" id="x-close">Close</button></div>
  <div id="x-st" class="note" style="margin-top:8px"></div>
</div></div>
<div id="print" aria-hidden="true"></div>
<input type="file" id="impfile" accept=".json,application/json" class="hidden">

<script src="<?= $v('logic-core.js') ?>"></script>
<script src="<?= $v('exercises.js') ?>"></script>
<script src="<?= $v('lab-session.js') ?>"></script>
<script src="<?= $v('ai-verify.js') ?>"></script>
<script src="<?= $v('fol-core.js') ?>"></script>
<script src="<?= $v('fol-examples.js') ?>"></script>
<script>window.INK_V = <?= (int)@filemtime(__DIR__ . '/ink-model.bin') ?>;</script>
<script src="<?= $v('ink.js') ?>"></script>
<script src="<?= $v('app.js') ?>"></script>
<script src="<?= $v('fol-section.js') ?>"></script>
<script>(function(){var sw=document.getElementById('sectsw'),dv=document.getElementById('deriv'),fo=document.getElementById('fol');if(!sw)return;function pick(sec){dv.classList.toggle('hidden',sec!=='deriv');fo.classList.toggle('hidden',sec!=='fol');sw.querySelectorAll('.sect').forEach(function(b){b.classList.toggle('on',b.dataset.sec===sec);});if(sec==='fol'&&window.FOLSection)window.FOLSection.show();try{localStorage.setItem('logiclab.v1.section',sec);}catch(e){}}sw.querySelectorAll('.sect').forEach(function(b){b.onclick=function(){pick(b.dataset.sec);window.scrollTo(0,0);};});var saved='deriv';try{saved=localStorage.getItem('logiclab.v1.section')||'deriv';}catch(e){}if(saved==='fol')pick('fol');})();</script>
</body>
</html>
