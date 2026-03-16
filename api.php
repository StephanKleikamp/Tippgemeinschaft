<?php
/**
 * Tippgemeinschaft – Backend API
 *
 * Endpoints:
 *   POST   ?action=login          { password }
 *   GET    ?action=check-auth
 *   GET    ?action=logout
 *   GET    ?action=settings
 *   POST   ?action=settings       { players, weeklyCost, startDate }
 *   GET    ?action=spielfelder
 *   POST   ?action=spielfelder    [ {nums, superzahl}, ... ]
 *   GET    ?action=entries
 *   POST   ?action=entries        { date, win6aus49, winSpiel77, winSuper6, note }
 *   DELETE ?action=entries&id=X
 *   GET    ?action=auto-check     Run full archive analysis
 *   GET    ?action=draw&date=X    Get cached draw data for date
 */

// ── Bootstrap ──────────────────────────────────────────────────────
error_reporting(E_ALL);
ini_set('display_errors', '0');

if (!file_exists(__DIR__ . '/config.php')) {
    http_response_code(500);
    die(json_encode(['error' => 'config.php fehlt. Bitte install.php aufrufen.']));
}
require_once __DIR__ . '/config.php';

session_set_cookie_params([
    'lifetime' => 30 * 24 * 3600,
    'path'     => '/',
    'secure'   => isset($_SERVER['HTTPS']),
    'httponly'  => true,
    'samesite'  => 'Lax',
]);
session_start();

header('Content-Type: application/json; charset=utf-8');

// ── Database connection ─────────────────────────────────────────────
try {
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER,
        DB_PASS,
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]
    );
} catch (PDOException $e) {
    http_response_code(500);
    die(json_encode(['error' => 'Datenbankverbindung fehlgeschlagen.']));
}

// ── Routing ─────────────────────────────────────────────────────────
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// Login doesn't require auth
if ($action === 'login' && $method === 'POST') {
    handleLogin($pdo);
    exit;
}
if ($action === 'check-auth') {
    echo json_encode(['ok' => !empty($_SESSION['tg_auth'])]);
    exit;
}

// All other endpoints require authentication
if (empty($_SESSION['tg_auth'])) {
    http_response_code(401);
    echo json_encode(['error' => 'Nicht angemeldet']);
    exit;
}

switch ($action) {
    case 'logout':
        $_SESSION = [];
        session_destroy();
        echo json_encode(['ok' => true]);
        break;

    case 'settings':
        if ($method === 'POST') saveSettings($pdo);
        else                    getSettings($pdo);
        break;

    case 'spielfelder':
        if ($method === 'POST') saveSpielfelder($pdo);
        else                    getSpielfelder($pdo);
        break;

    case 'entries':
        if ($method === 'POST')   addEntry($pdo);
        elseif ($method === 'DELETE') deleteEntry($pdo);
        else                      getEntries($pdo);
        break;

    case 'auto-check':
        echo json_encode(autoCheckArchive($pdo));
        break;

    case 'draw':
        $date = $_GET['date'] ?? '';
        echo json_encode(getDrawForDate($pdo, $date));
        break;

    default:
        http_response_code(400);
        echo json_encode(['error' => 'Unbekannte Aktion: ' . $action]);
}

// ── Auth ────────────────────────────────────────────────────────────
function handleLogin(PDO $pdo) {
    $input = json_decode(file_get_contents('php://input'), true);
    $password = $input['password'] ?? '';

    $stmt = $pdo->query("SELECT password_hash FROM tg_settings WHERE id = 1");
    $row = $stmt->fetch();

    if ($row && password_verify($password, $row['password_hash'])) {
        $_SESSION['tg_auth'] = true;
        echo json_encode(['ok' => true]);
    } else {
        http_response_code(401);
        echo json_encode(['error' => 'Falsches Passwort']);
    }
}

// ── Settings ────────────────────────────────────────────────────────
function getSettings(PDO $pdo) {
    $row = $pdo->query("SELECT players, weekly_cost, start_date FROM tg_settings WHERE id = 1")->fetch();
    if (!$row) {
        echo json_encode(['players' => ['Max','Moritz','Klaus'], 'weeklyCost' => 13.35, 'startDate' => '2026-01-03']);
        return;
    }
    echo json_encode([
        'players'    => json_decode($row['players'], true),
        'weeklyCost' => (float) $row['weekly_cost'],
        'startDate'  => $row['start_date'],
    ]);
}

function saveSettings(PDO $pdo) {
    $input = json_decode(file_get_contents('php://input'), true);
    $players    = $input['players'] ?? [];
    $weeklyCost = (float) ($input['weeklyCost'] ?? 0);
    $startDate  = $input['startDate'] ?? '';

    if (count($players) < 2 || !$weeklyCost || !$startDate) {
        http_response_code(400);
        echo json_encode(['error' => 'Ungültige Einstellungen']);
        return;
    }

    $stmt = $pdo->prepare(
        "UPDATE tg_settings SET players = ?, weekly_cost = ?, start_date = ? WHERE id = 1"
    );
    $stmt->execute([json_encode($players), $weeklyCost, $startDate]);
    echo json_encode(['ok' => true]);
}

// ── Spielfelder ─────────────────────────────────────────────────────
function getSpielfelder(PDO $pdo) {
    $rows = $pdo->query("SELECT slot_index, nums, superzahl FROM tg_spielfelder ORDER BY slot_index")->fetchAll();
    $result = [];
    for ($i = 0; $i < 8; $i++) {
        $found = null;
        foreach ($rows as $r) {
            if ((int)$r['slot_index'] === $i) { $found = $r; break; }
        }
        if ($found && $found['nums']) {
            $result[] = ['nums' => json_decode($found['nums'], true), 'superzahl' => (int)$found['superzahl']];
        } else {
            $result[] = ['nums' => [], 'superzahl' => null];
        }
    }
    echo json_encode($result);
}

function saveSpielfelder(PDO $pdo) {
    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) {
        http_response_code(400);
        echo json_encode(['error' => 'Ungültige Daten']);
        return;
    }

    $pdo->exec("DELETE FROM tg_spielfelder");
    $stmt = $pdo->prepare("INSERT INTO tg_spielfelder (slot_index, nums, superzahl) VALUES (?, ?, ?)");

    for ($i = 0; $i < min(8, count($input)); $i++) {
        $sf = $input[$i];
        $nums = $sf['nums'] ?? [];
        $sz   = $sf['superzahl'] ?? null;
        if (is_array($nums) && count($nums) === 6 && $sz !== null) {
            $stmt->execute([$i, json_encode(array_map('intval', $nums)), (int)$sz]);
        }
    }

    echo json_encode(['ok' => true]);
}

// ── Entries ─────────────────────────────────────────────────────────
function getEntries(PDO $pdo) {
    $rows = $pdo->query(
        "SELECT id, draw_date, win_6aus49, win_spiel77, win_super6, note, created_at
         FROM tg_entries ORDER BY draw_date DESC"
    )->fetchAll();

    $result = [];
    foreach ($rows as $r) {
        $result[] = [
            'id'         => (int) $r['id'],
            'date'       => $r['draw_date'],
            'win6aus49'  => (float) $r['win_6aus49'],
            'winSpiel77' => (float) $r['win_spiel77'],
            'winSuper6'  => (float) $r['win_super6'],
            'note'       => $r['note'] ?? '',
        ];
    }
    echo json_encode($result);
}

function addEntry(PDO $pdo) {
    $input = json_decode(file_get_contents('php://input'), true);
    $date   = $input['date'] ?? '';
    $v6     = (float) ($input['win6aus49'] ?? 0);
    $v77    = (float) ($input['winSpiel77'] ?? 0);
    $vs6    = (float) ($input['winSuper6'] ?? 0);
    $note   = mb_substr($input['note'] ?? '', 0, 80);

    if (!$date || ($v6 + $v77 + $vs6) <= 0) {
        http_response_code(400);
        echo json_encode(['error' => 'Ungültige Eingabe']);
        return;
    }

    $stmt = $pdo->prepare(
        "INSERT INTO tg_entries (draw_date, win_6aus49, win_spiel77, win_super6, note) VALUES (?, ?, ?, ?, ?)"
    );
    $stmt->execute([$date, $v6, $v77, $vs6, $note]);
    echo json_encode(['ok' => true, 'id' => (int) $pdo->lastInsertId()]);
}

function deleteEntry(PDO $pdo) {
    $id = (int) ($_GET['id'] ?? 0);
    if (!$id) {
        http_response_code(400);
        echo json_encode(['error' => 'Keine ID angegeben']);
        return;
    }
    $stmt = $pdo->prepare("DELETE FROM tg_entries WHERE id = ?");
    $stmt->execute([$id]);
    echo json_encode(['ok' => true]);
}

// ── HTTP Helper ─────────────────────────────────────────────────────
function httpGet(string $url, int $timeout = 15): ?string {
    // Try curl first (most reliable on Strato)
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 3,
            CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; TippgemeinschaftBot/1.0)',
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $result   = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($httpCode >= 200 && $httpCode < 300 && $result !== false) {
            return $result;
        }
    }

    // Fallback: file_get_contents
    $ctx = stream_context_create([
        'http' => [
            'timeout'    => $timeout,
            'user_agent' => 'Mozilla/5.0 (compatible; TippgemeinschaftBot/1.0)',
        ],
    ]);
    $result = @file_get_contents($url, false, $ctx);
    return $result !== false ? $result : null;
}

// ── Draw Data: Fetch & Cache ────────────────────────────────────────
function syncArchive(PDO $pdo): int {
    $json = httpGet('https://johannesfriedrich.github.io/LottoNumberArchive/Lottonumbers_complete.json', 30);
    if (!$json) return 0;

    $archive = json_decode($json, true);
    $draws = $archive['data'] ?? [];
    if (empty($draws)) return 0;

    $stmt = $pdo->prepare(
        "INSERT INTO tg_draw_cache (draw_date, nums, superzahl)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE nums = VALUES(nums), superzahl = VALUES(superzahl), fetched_at = NOW()"
    );

    $count = 0;
    foreach ($draws as $d) {
        $dateDE = $d['date'] ?? '';
        $iso    = deToISO($dateDE);
        if (!$iso) continue;
        $nums = $d['Lottozahl'] ?? [];
        $sz   = $d['Superzahl'] ?? null;
        if (count($nums) !== 6 || $sz === null) continue;

        $stmt->execute([$iso, json_encode($nums), (int)$sz]);
        $count++;
    }
    return $count;
}

function syncQuoten(PDO $pdo): int {
    $html = httpGet('https://www.lotto.de/lotto-6aus49/gewinnzahlen', 15);
    if (!$html) return 0;

    if (!preg_match('/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s', $html, $m)) return 0;
    $nextData = json_decode($m[1], true);
    if (!$nextData) return 0;

    $wnData = $nextData['props']['pageProps']['winningNumbersData'] ?? null;
    if (!$wnData || !is_array($wnData)) return 0;

    $count = 0;
    $stmt = $pdo->prepare(
        "UPDATE tg_draw_cache SET quoten = ? WHERE draw_date = ?"
    );

    foreach ($wnData as $items) {
        if (!is_array($items)) $items = [$items];
        // Handle both indexed arrays and single objects
        $first = reset($items);
        if (isset($first['gameType'])) {
            // Single object wrapped in array
        } elseif (is_array($first)) {
            // Already an array of objects
        } else {
            // $items itself is the draw object
            $items = [$items];
        }

        foreach ($items as $draw) {
            if (!is_array($draw)) continue;
            $name = $draw['gameType']['name'] ?? '';
            if (strpos($name, '6aus49') === false) continue;

            // Parse date
            $rawDate = $draw['drawDate'] ?? $draw['date'] ?? $draw['datum'] ?? '';
            $iso = null;
            if (preg_match('/(\d{4})-(\d{2})-(\d{2})/', $rawDate, $dm)) {
                $iso = $dm[0];
            } elseif (preg_match('/(\d{2})\.(\d{2})\.(\d{4})/', $rawDate, $dm)) {
                $iso = $dm[3] . '-' . $dm[2] . '-' . $dm[1];
            }
            if (!$iso) continue;

            // Extract quoten
            $odds = $draw['odds'] ?? $draw['quoten'] ?? $draw['gewinnquoten']
                 ?? $draw['prizeTiers'] ?? $draw['winningClasses'] ?? [];
            if (!is_array($odds) || empty($odds)) continue;

            $q = [];
            foreach ($odds as $tier) {
                if (!is_array($tier)) continue;
                $kl  = $tier['class'] ?? $tier['klasse'] ?? $tier['prizeClass']
                    ?? $tier['tierNumber'] ?? $tier['className'] ?? null;
                $amt = $tier['amount'] ?? $tier['prize'] ?? $tier['prizeAmount']
                    ?? $tier['quote'] ?? $tier['gewinnbetrag'] ?? null;
                $klNum  = intval($kl);
                $amtNum = floatval($amt);
                if ($klNum >= 1 && $klNum <= 9 && $amtNum > 0) {
                    $q[$klNum] = $amtNum;
                }
            }

            if (!empty($q)) {
                $stmt->execute([json_encode($q), $iso]);
                $count++;
            }
        }
    }
    return $count;
}

function getDrawForDate(PDO $pdo, string $date): array {
    $stmt = $pdo->prepare("SELECT nums, superzahl, quoten FROM tg_draw_cache WHERE draw_date = ?");
    $stmt->execute([$date]);
    $row = $stmt->fetch();
    if (!$row) return ['found' => false];
    return [
        'found'     => true,
        'nums'      => json_decode($row['nums'], true),
        'superzahl' => (int) $row['superzahl'],
        'quoten'    => $row['quoten'] ? json_decode($row['quoten'], true) : null,
    ];
}

// ── Prize Calculation ───────────────────────────────────────────────
function getPrizeKlasse(int $matches, bool $hasSZ): ?int {
    if ($matches === 6 && $hasSZ)  return 1;
    if ($matches === 6)            return 2;
    if ($matches === 5 && $hasSZ)  return 3;
    if ($matches === 5)            return 4;
    if ($matches === 4 && $hasSZ)  return 5;
    if ($matches === 4)            return 6;
    if ($matches === 3 && $hasSZ)  return 7;
    if ($matches === 3)            return 8;
    if ($matches === 2 && $hasSZ)  return 9;
    return null;
}

// Klasse 9 = 6,00 EUR fest; alle anderen variabel
function getFixedAmount(int $klasse): ?float {
    return $klasse === 9 ? 6.00 : null;
}

$KLASSE_LABELS = [
    1 => '6 Richtige + SZ', 2 => '6 Richtige', 3 => '5 Richtige + SZ',
    4 => '5 Richtige', 5 => '4 Richtige + SZ', 6 => '4 Richtige',
    7 => '3 Richtige + SZ', 8 => '3 Richtige', 9 => '2 Richtige + SZ',
];

// ── Auto-Check: Full Archive Analysis ───────────────────────────────
function autoCheckArchive(PDO $pdo): array {
    global $KLASSE_LABELS;

    // 1. Load settings
    $sRow = $pdo->query("SELECT start_date FROM tg_settings WHERE id = 1")->fetch();
    $startDate = $sRow['start_date'] ?? '2026-01-03';

    // 2. Load Spielfelder
    $sfRows = $pdo->query("SELECT slot_index, nums, superzahl FROM tg_spielfelder ORDER BY slot_index")->fetchAll();
    $spielfelder = [];
    foreach ($sfRows as $r) {
        if ($r['nums']) {
            $spielfelder[] = [
                'slot'      => (int) $r['slot_index'],
                'nums'      => json_decode($r['nums'], true),
                'superzahl' => (int) $r['superzahl'],
            ];
        }
    }

    if (empty($spielfelder)) {
        return ['status' => 'error', 'message' => 'Keine Spielfelder hinterlegt.', 'results' => []];
    }

    // 3. Sync archive from GitHub
    $syncCount = syncArchive($pdo);

    // 4. Try to sync Gewinnquoten from lotto.de
    $quotenCount = syncQuoten($pdo);

    // 5. Get all Saturdays from draw_cache since start_date
    $stmt = $pdo->prepare(
        "SELECT draw_date, nums, superzahl, quoten FROM tg_draw_cache
         WHERE draw_date >= ? AND DAYOFWEEK(draw_date) = 7
         ORDER BY draw_date"
    );
    $stmt->execute([$startDate]);
    $draws = $stmt->fetchAll();

    // 6. Get existing entries
    $existingDates = [];
    foreach ($pdo->query("SELECT draw_date FROM tg_entries")->fetchAll() as $r) {
        $existingDates[$r['draw_date']] = true;
    }

    // 7. Check each Saturday
    $insertStmt = $pdo->prepare(
        "INSERT INTO tg_entries (draw_date, win_6aus49, note) VALUES (?, ?, ?)"
    );

    $results = [];
    $newEntries = 0;
    $pendingEntries = 0;

    foreach ($draws as $draw) {
        $date = $draw['draw_date'];
        if (isset($existingDates[$date])) continue;

        $drawnNums = json_decode($draw['nums'], true);
        $drawnSZ   = (int) $draw['superzahl'];
        $quoten    = $draw['quoten'] ? json_decode($draw['quoten'], true) : null;

        $totalAmount = 0;
        $allKnown    = true;
        $wins        = [];

        foreach ($spielfelder as $sf) {
            $matches = count(array_intersect($sf['nums'], $drawnNums));
            $hasSZ   = $sf['superzahl'] === $drawnSZ;
            $klasse  = getPrizeKlasse($matches, $hasSZ);

            if ($klasse === null) continue;

            $amount = getFixedAmount($klasse);
            if ($amount === null && $quoten && isset($quoten[$klasse])) {
                $amount = (float) $quoten[$klasse];
            }

            if ($amount !== null) {
                $totalAmount += $amount;
            } else {
                $allKnown = false;
            }

            $wins[] = [
                'sf'      => $sf['slot'] + 1,
                'klasse'  => $klasse,
                'label'   => $KLASSE_LABELS[$klasse] ?? "Klasse $klasse",
                'amount'  => $amount,
                'matches' => $matches,
            ];
        }

        if (empty($wins)) continue;

        $noteStr = implode(', ', array_map(function($w) {
            $a = $w['amount'] !== null ? number_format($w['amount'], 2, ',', '.') . '€' : '?';
            return "SF{$w['sf']}:Kl.{$w['klasse']}={$a}";
        }, $wins));

        if ($allKnown && $totalAmount > 0) {
            $insertStmt->execute([$date, $totalAmount, mb_substr('Auto: ' . $noteStr, 0, 80)]);
            $newEntries++;
            $results[] = [
                'date'   => $date,
                'wins'   => $wins,
                'amount' => $totalAmount,
                'saved'  => true,
            ];
        } else {
            $pendingEntries++;
            $results[] = [
                'date'   => $date,
                'wins'   => $wins,
                'amount' => $totalAmount,
                'saved'  => false,
            ];
        }
    }

    return [
        'status'         => 'ok',
        'archiveSynced'  => $syncCount,
        'quotenSynced'   => $quotenCount,
        'drawsChecked'   => count($draws),
        'newEntries'     => $newEntries,
        'pendingEntries' => $pendingEntries,
        'results'        => $results,
    ];
}

// ── Helpers ─────────────────────────────────────────────────────────
function deToISO(string $de): ?string {
    $parts = explode('.', $de);
    if (count($parts) !== 3) return null;
    return sprintf('%s-%s-%s',
        str_pad($parts[2], 4, '0', STR_PAD_LEFT),
        str_pad($parts[1], 2, '0', STR_PAD_LEFT),
        str_pad($parts[0], 2, '0', STR_PAD_LEFT)
    );
}
