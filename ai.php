<?php
// Logic Lab — AI tutor relay. The student's own NVIDIA NIM key is relayed for ONE call and never stored or logged.
// Reuses the Wumpus Justify server library (config dir outside the web root, NVIDIA provider settings, usage file locking).
// POST JSON {test_key:"nvapi-…"}                                  → {ok, ms, model, error}
// POST JSON {user_key, kind:"explain"|"ask", context:{…}, question?} → {ok:true, text, model, ms} | {ok:false, reason, detail?}
// GET  ?info=1                                                    → {version, model}
declare(strict_types=1);
require __DIR__ . '/../wumpus/lib.php';
header('X-Content-Type-Options: nosniff');
const LL_VERSION = '1.0.0';

$cfg = wj_load_config();
$nv = wj_provider_by_id($cfg, 'nvidia');
$model = $nv ? (string)$nv['model'] : 'nvidia/nemotron-3-super-120b-a12b';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') wj_json(['version' => LL_VERSION, 'model' => $model]);
if ($_SERVER['REQUEST_METHOD'] !== 'POST') wj_json(['ok' => false, 'reason' => 'method'], 405);
$in = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($in)) wj_json(['ok' => false, 'reason' => 'bad-json'], 400);

$key = trim((string)($in['user_key'] ?? ($in['test_key'] ?? '')));
if (!wj_valid_user_key($key)) wj_json(['ok' => false, 'reason' => 'bad-key', 'detail' => 'An NVIDIA key looks like nvapi-… (get one free at build.nvidia.com).']);

// per-IP limit (hashed IP, no text stored): 150 calls / minute — a whole class shares one college NAT IP;
// each student's own key carries NVIDIA's per-key rate limit anyway

$ipOk = wj_with_usage(function (&$u) {
    $m = wj_minute_key(); $ip = wj_ip_hash();
    $u['lab_ip'] = array_filter($u['lab_ip'] ?? [], fn($v) => ($v['m'] ?? 0) === $m);
    $c = ($u['lab_ip'][$ip]['n'] ?? 0) + 1;
    if ($c > 150) return false;
    $u['lab_ip'][$ip] = ['m' => $m, 'n' => $c];
    return true;
});
if ($ipOk === false) wj_json(['ok' => false, 'reason' => 'slow-down', 'detail' => 'Too many questions in one minute — wait a moment.']);

function ll_system_prompt(): string {
    return <<<TXT
You are a patient logic tutor for engineering students in Kerala taking PECST522 Artificial Intelligence, Module 3
(KTU 2024 scheme; textbook: Russell & Norvig, AIMA 4th ed., Chapter 7). The student is working one exercise in a
step-by-step derivation tool. You receive JSON: the exercise, every line with the CHECKER's verdict (✓ or ×) and its
message, and the checker's own next step.

Hard rules:
1. The checker is always right. Its ✓/× come from truth tables and exact rule matching. Never contradict a verdict,
   never call a × line correct or a ✓ line wrong. If you think the checker is wrong, you are mistaken — explain its view.
2. Use the notation ¬ ∧ ∨ ⇒ ⇔ and the rule names of the textbook: Modus Ponens, Modus Tollens, And-Elimination,
   And-Introduction, Unit Resolution, Resolution, Biconditional elimination, Implication elimination, Contraposition,
   De Morgan, Double-negation elimination, Distribution, forward chaining, backward chaining.
3. Be short: at most 120 words, plain sentences, no headings, no tables, no markdown symbols like ** or #.
4. Teach, don't just answer. Point at the specific line numbers. Prefer a guiding question or the idea behind the next
   step. Give the next line itself only if the student explicitly asks for it — and then use exactly the checker's
   next step, never a different one.
5. If the question is not about this exercise or Module 3 logic, say in one sentence that you can only help with the
   derivation here.
6. Simple English. If the student mixes Malayalam, still answer in simple English.
TXT;
}

$kind = in_array($in['kind'] ?? '', ['explain', 'ask', 'notes', 'step'], true) ? $in['kind'] : null;
$lineNo = (int)($in['line'] ?? 0);
$isTest = isset($in['test_key']);
if (!$isTest && !$kind) wj_json(['ok' => false, 'reason' => 'bad-request'], 400);

$ctx = $in['context'] ?? [];
if (!is_array($ctx)) $ctx = [];
$ctxJson = mb_substr(json_encode($ctx, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 0, 9000);
$q = mb_substr(trim((string)($in['question'] ?? '')), 0, 600);
$user = $isTest ? 'Reply with exactly: ready'
    : ($kind === 'explain'
        ? "Exercise state:\n$ctxJson\n\nThe student pressed \"Explain\". Explain in plain words the IDEA behind the checker's next step (or why their last × line is wrong, if it is): name the law and say which part of which line it applies to. Do NOT write the resulting formula or line — the student must write it."
        : ($kind === 'step'
            ? "Exercise state:\n$ctxJson\n\nExplain line $lineNo to the student in at most 2 short sentences (max 45 words), using the ACTUAL formulas on the board, not α/β. If line $lineNo is ✓: name the rule and show how it applies here (what plays the role of each part, which cited lines give what), so the student sees why it is valid. If it is ×: say concretely what went wrong, following the checker's message, and hint at the fix without writing the correct line. No preamble, no line number at the start."
            : ($kind === 'notes'
            ? "Exercise state:\n$ctxJson\n\nThe student is exporting this derivation as study notes. Write, in this exact plain-text format and nothing else:\nSUMMARY: <2-3 sentences: the overall strategy of the derivation and the key idea a student should remember>\nThen one line per ✓ line that is NOT given, in order: STEP <n>: <one sentence: why this step is useful at this point, in plain words>\nIf there are × lines, add one final line: MISTAKE: <one sentence on the most instructive mistake and how to avoid it>.\nOnly describe lines that exist. Never contradict the checker. At most 260 words in total."
            : "Exercise state:\n$ctxJson\n\nStudent's question: $q")));

// verify-and-repair: the page's logic engine found problems in the previous draft → feed them back
$rep = $in['repair'] ?? null;
if (!$isTest && is_array($rep) && isset($rep['draft'], $rep['issues']) && is_array($rep['issues'])) {
    $iss = implode("\n", array_map(fn($x) => '- ' . mb_substr((string)$x, 0, 300), array_slice($rep['issues'], 0, 6)));
    $user .= "\n\nYour previous answer was:\n" . mb_substr((string)$rep['draft'], 0, 2500)
        . "\n\nThe logic engine checked it against truth tables and the checker's verdicts and found these problems:\n$iss\n\nRewrite the answer so that every problem is fixed. Keep everything that was correct, keep the same format and length limit, and do not mention this correction.";
}
$body = [
    'model' => $model, 'temperature' => 0.3, 'max_tokens' => $isTest ? 200 : ($kind === 'notes' ? 1400 : ($kind === 'step' ? 400 : 800)),   // reasoning tokens count too
    'messages' => [['role' => 'system', 'content' => ll_system_prompt()], ['role' => 'user', 'content' => $user]],
    'chat_template_kwargs' => ['enable_thinking' => false],   // thinking off: ~3 s instead of ~60 s (measured for Wumpus)
    'reasoning_effort' => 'low',                              // gpt-oss family (nemotron-3-super reached end of life 2026-10-03)
];
// primary model, then the provider's fallback_models (same chain as the Wumpus judge, lib.php wj_call_provider).
// Per-step explanations appear under every checked line, so Ultra gets only 7 s there before gpt-oss answers (Ultra measured 4–13 s on 2026-10-03).
$chain = array_values(array_unique(array_merge([$model], array_filter((array)($nv['fallback_models'] ?? []), 'is_string'))));
$t0 = microtime(true); $used = $model;
foreach ($chain as $ci => $m) {
    $body['model'] = $m; $used = $m;
    $ch = curl_init('https://integrate.api.nvidia.com/v1/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $key, 'Accept: application/json'],
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $ci < count($chain) - 1 ? ($kind === 'step' || $isTest ? 7 : (int)($nv['primary_timeout_s'] ?? 20)) : 45, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $raw = curl_exec($ch); $http = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE); $cerr = curl_error($ch); curl_close($ch);
    if ($http === 401 || $http === 403) break;                       // the key is bad on every model
    $jj = ($raw !== false && $http >= 200 && $http < 300) ? json_decode((string)$raw, true) : null;
    $cc = $jj['choices'][0]['message']['content'] ?? '';
    if (is_array($cc)) $cc = implode('', array_map(fn($x) => $x['text'] ?? '', $cc));
    if (trim((string)$cc) !== '') break;                             // got an answer
}
$ms = (int)round((microtime(true) - $t0) * 1000);
$model = $used;
$ok = false; $text = ''; $err = '';
if ($raw === false) $err = 'network: ' . substr($cerr, 0, 100);
elseif ($http === 401 || $http === 403) $err = 'NVIDIA rejected the key';
elseif ($http === 429) $err = 'NVIDIA rate limit — try again in a minute';
elseif ($http < 200 || $http >= 300) $err = 'NVIDIA error ' . $http;
else {
    $j = json_decode((string)$raw, true);
    $c = $j['choices'][0]['message']['content'] ?? '';
    if (is_array($c)) $c = implode('', array_map(fn($x) => $x['text'] ?? '', $c));
    $text = trim(preg_replace('/<think>.*?<\/think>/s', '', (string)$c));
    $text = preg_replace('/\*\*|^#+\s*/m', '', $text);
    // some models write LaTeX: \( … \), \neg, \land … → the plain symbols the page and the verifier read
    $text = strtr($text, ['\\(' => '', '\\)' => '', '\\[' => '', '\\]' => '', '\u{202F}' => ' ']);
    $text = preg_replace_callback('/\\\\(neg|lnot|land|wedge|lor|vee|Rightarrow|rightarrow|implies|to|Leftrightarrow|leftrightarrow|iff|equiv|top|bot)\b\s*/', fn($m) => ['neg' => '¬', 'lnot' => '¬', 'land' => '∧', 'wedge' => '∧', 'lor' => '∨', 'vee' => '∨', 'Rightarrow' => '⇒', 'rightarrow' => '⇒', 'implies' => '⇒', 'to' => '⇒', 'Leftrightarrow' => '⇔', 'leftrightarrow' => '⇔', 'iff' => '⇔', 'equiv' => '≡', 'top' => '⊤', 'bot' => '⊥'][$m[1]] . (in_array($m[1], ['neg', 'lnot']) ? '' : ' '), $text);
    $text = str_replace('$', '', $text);
    if ($text === '') $err = 'empty answer'; else $ok = true;
}
// usage counters only (no text, no key)
wj_with_usage(function (&$u) use ($ok, $isTest, $kind) {
    $d = &$u['days'][wj_today()];
    $k = $isTest ? 'tests' : $kind;
    $d['lab'][$k] = ($d['lab'][$k] ?? 0) + 1;
    if (!$ok) $d['lab']['errors'] = ($d['lab']['errors'] ?? 0) + 1;
    return true;
});
if (!$ok) wj_json(['ok' => false, 'reason' => 'provider', 'detail' => $err, 'ms' => $ms]);
wj_json(['ok' => true, 'text' => mb_substr($text, 0, $kind === 'notes' ? 3500 : 1500), 'model' => $model, 'ms' => $ms]);
