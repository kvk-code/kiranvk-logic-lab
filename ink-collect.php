<?php
// Logic Lab ✍ pad — handwriting collector (training data for the on-device recogniser).
// POST JSON {cid, recs:[…]}  → appends one JSONL line per record to $HOME/logiclab-ink/YYYY-MM-DD.jsonl (outside the web root)
// POST JSON {cid, forget:1}  → files a deletion request for that browser id (purged by the nightly job, Phase 3)
// GET                        → {ok, version}
// Stores no names, roll numbers or IP addresses. The per-IP rate limit keeps only a daily-rotating hash, in a separate file.
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
const IC_VERSION = '1.0.0';
const IC_MAX_BODY = 600000;              // bytes per request
const IC_MAX_REC = 150000;               // bytes per record
const IC_MAX_RECS = 40;                  // records per request
const IC_DAY_CAP = 40 * 1024 * 1024;     // per day file
const IC_TOTAL_CAP = 600 * 1024 * 1024;  // whole store
const IC_PER_HOUR = 2000;                // records per IP hash per hour (a class shares one college NAT IP)

function ic_out(array $o, int $code = 200): void { http_response_code($code); echo json_encode($o, JSON_UNESCAPED_SLASHES); exit; }
function ic_dir(): string {
    $home = getenv('HOME');
    if (!$home && !empty($_SERVER['DOCUMENT_ROOT'])) $home = dirname($_SERVER['DOCUMENT_ROOT']);
    if (!$home) $home = dirname(__DIR__, 3);
    $d = rtrim($home, '/') . '/logiclab-ink';
    if (!is_dir($d)) { @mkdir($d, 0700, true); }
    return $d;
}
function ic_today(): string { return (new DateTime('now', new DateTimeZone('Asia/Kolkata')))->format('Y-m-d'); }

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'GET') ic_out(['ok' => true, 'version' => IC_VERSION]);
if ($method !== 'POST') ic_out(['ok' => false, 'reason' => 'method'], 405);
$raw = (string)file_get_contents('php://input', false, null, 0, IC_MAX_BODY + 1);
if (strlen($raw) > IC_MAX_BODY) ic_out(['ok' => false, 'reason' => 'too-big'], 413);
$in = json_decode($raw, true);
if (!is_array($in)) ic_out(['ok' => false, 'reason' => 'bad-json'], 400);
$cid = (string)($in['cid'] ?? '');
if (!preg_match('/^[a-f0-9]{16,32}$/', $cid)) ic_out(['ok' => false, 'reason' => 'bad-cid'], 400);
$dir = ic_dir();
if (!is_dir($dir) || !is_writable($dir)) ic_out(['ok' => false, 'reason' => 'store'], 500);

// deletion request: recorded now, applied by the nightly job (which also drops the id from every later pull)
if (!empty($in['forget'])) {
    $line = json_encode(['cid' => $cid, 'at' => gmdate('c')]) . "\n";
    file_put_contents($dir . '/forget.jsonl', $line, FILE_APPEND | LOCK_EX);
    @chmod($dir . '/forget.jsonl', 0600);
    ic_out(['ok' => true, 'forget' => true]);
}

$recs = $in['recs'] ?? null;
if (!is_array($recs) || !$recs || count($recs) > IC_MAX_RECS) ic_out(['ok' => false, 'reason' => 'bad-recs'], 400);

// rate limit per hashed IP (daily-rotating hash; the raw IP is never written)
$ip = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? '0';
$ih = substr(hash('sha256', $ip . '|' . ic_today() . '|ink'), 0, 16);
$hour = intdiv(time(), 3600);
$uf = $dir . '/.rate.json';
$h = fopen($uf, 'c+');
if ($h) {
    flock($h, LOCK_EX);
    $u = json_decode((string)stream_get_contents($h), true) ?: [];
    foreach ($u as $k => $v) if (($v['h'] ?? 0) !== $hour) unset($u[$k]);
    $n = ($u[$ih]['n'] ?? 0) + count($recs);
    $over = $n > IC_PER_HOUR;
    if (!$over) $u[$ih] = ['h' => $hour, 'n' => $n];
    ftruncate($h, 0); rewind($h); fwrite($h, json_encode($u)); fflush($h); flock($h, LOCK_UN); fclose($h);
    @chmod($uf, 0600);
    if ($over) ic_out(['ok' => false, 'reason' => 'slow-down'], 429);
}

// size caps
$total = 0; foreach (glob($dir . '/*.jsonl') ?: [] as $f) $total += (int)@filesize($f);
$day = $dir . '/' . ic_today() . '.jsonl';
$dayNow = is_file($day) ? (int)filesize($day) : 0;

$lines = ''; $kept = 0; $ids = [];
foreach ($recs as $r) {
    if (!is_array($r) || !isset($r['strokes']) || !is_array($r['strokes'])) continue;
    $rid = (string)($r['rid'] ?? '');
    if (!preg_match('/^[a-f0-9]{8,32}$/', $rid)) continue;
    // keep only the fields we defined; anything else (and any accidental identifier) is dropped
    $keep = ['v', 'rid', 'at', 'dev', 'ctx', 'model', 'lex', 'strokes', 'shown', 'top', 'pick', 'chips', 'typed', 'text', 'verdict', 'tier', 'consent', 'events', 'prefix', 'pmode'];
    $o = ['cid' => $cid, 'rx' => gmdate('c')];
    foreach ($keep as $k) if (array_key_exists($k, $r)) $o[$k] = $r[$k];
    $j = json_encode($o, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($j === false || strlen($j) > IC_MAX_REC) continue;
    $lines .= $j . "\n"; $kept++; $ids[] = $rid;
}
if (!$kept) ic_out(['ok' => false, 'reason' => 'no-valid-records'], 400);
if ($dayNow + strlen($lines) > IC_DAY_CAP || $total + strlen($lines) > IC_TOTAL_CAP) ic_out(['ok' => false, 'reason' => 'store-full'], 507);
if (file_put_contents($day, $lines, FILE_APPEND | LOCK_EX) === false) ic_out(['ok' => false, 'reason' => 'write'], 500);
@chmod($day, 0600);
ic_out(['ok' => true, 'n' => $kept, 'ids' => $ids]);
