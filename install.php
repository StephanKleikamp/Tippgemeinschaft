<?php
/**
 * Tippgemeinschaft – Ersteinrichtung
 *
 * Diese Datei einmal aufrufen, um die Datenbank einzurichten.
 * DANACH SOFORT LOESCHEN oder in .htaccess blockieren!
 */

$error   = '';
$success = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $password = $_POST['password'] ?? '';
    $confirm  = $_POST['confirm'] ?? '';
    $dbHost   = trim($_POST['db_host'] ?? '');
    $dbName   = trim($_POST['db_name'] ?? '');
    $dbUser   = trim($_POST['db_user'] ?? '');
    $dbPass   = $_POST['db_pass'] ?? '';

    if (strlen($password) < 4) {
        $error = 'Passwort muss mindestens 4 Zeichen lang sein.';
    } elseif ($password !== $confirm) {
        $error = 'Passwörter stimmen nicht überein.';
    } elseif (!$dbHost || !$dbName || !$dbUser) {
        $error = 'Bitte alle Datenbankfelder ausfüllen.';
    } else {
        try {
            // Test connection
            $pdo = new PDO(
                "mysql:host=$dbHost;dbname=$dbName;charset=utf8mb4",
                $dbUser, $dbPass,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
            );

            // Create tables
            $pdo->exec("
                CREATE TABLE IF NOT EXISTS tg_settings (
                    id INT NOT NULL DEFAULT 1,
                    players JSON NOT NULL,
                    weekly_cost DECIMAL(10,2) NOT NULL DEFAULT 13.35,
                    start_date DATE NOT NULL DEFAULT '2026-01-03',
                    password_hash VARCHAR(255) NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            ");

            $pdo->exec("
                CREATE TABLE IF NOT EXISTS tg_spielfelder (
                    slot_index TINYINT NOT NULL,
                    nums JSON DEFAULT NULL,
                    superzahl TINYINT DEFAULT NULL,
                    PRIMARY KEY (slot_index)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            ");

            $pdo->exec("
                CREATE TABLE IF NOT EXISTS tg_entries (
                    id INT AUTO_INCREMENT,
                    draw_date DATE NOT NULL,
                    win_6aus49 DECIMAL(10,2) NOT NULL DEFAULT 0,
                    win_spiel77 DECIMAL(10,2) NOT NULL DEFAULT 0,
                    win_super6 DECIMAL(10,2) NOT NULL DEFAULT 0,
                    note VARCHAR(80) DEFAULT '',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            ");

            $pdo->exec("
                CREATE TABLE IF NOT EXISTS tg_draw_cache (
                    draw_date DATE NOT NULL,
                    nums JSON NOT NULL,
                    superzahl TINYINT NOT NULL,
                    quoten JSON DEFAULT NULL,
                    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (draw_date)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            ");

            // Insert default settings with password
            $hash = password_hash($password, PASSWORD_DEFAULT);
            $stmt = $pdo->prepare(
                "INSERT INTO tg_settings (id, players, weekly_cost, start_date, password_hash)
                 VALUES (1, ?, 13.35, '2026-01-03', ?)
                 ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)"
            );
            $stmt->execute([json_encode(['Max', 'Moritz', 'Klaus']), $hash]);

            // Write config.php
            $configContent = "<?php\n"
                . "define('DB_HOST', " . var_export($dbHost, true) . ");\n"
                . "define('DB_NAME', " . var_export($dbName, true) . ");\n"
                . "define('DB_USER', " . var_export($dbUser, true) . ");\n"
                . "define('DB_PASS', " . var_export($dbPass, true) . ");\n";

            file_put_contents(__DIR__ . '/config.php', $configContent);

            $success = true;

        } catch (PDOException $e) {
            $error = 'Datenbankfehler: ' . $e->getMessage();
        }
    }
}
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tippgemeinschaft – Installation</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
               background: #f0f4f8; min-height: 100vh; display: flex; align-items: center;
               justify-content: center; padding: 20px; }
        .box { background: white; border-radius: 16px; padding: 40px; max-width: 480px;
               width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
        h1 { font-size: 1.3rem; color: #2c3e50; margin-bottom: 8px; }
        .sub { font-size: 0.85rem; color: #7f8c8d; margin-bottom: 24px; }
        label { display: block; font-size: 0.78rem; font-weight: 700; text-transform: uppercase;
                color: #7f8c8d; margin-bottom: 4px; margin-top: 14px; }
        input { width: 100%; padding: 10px 14px; border: 1px solid #dde3eb; border-radius: 8px;
                font-size: 0.95rem; outline: none; }
        input:focus { border-color: #27ae60; }
        .sep { border-top: 1px solid #dde3eb; margin: 20px 0; }
        .btn { display: block; width: 100%; padding: 12px; background: #27ae60; color: white;
               border: none; border-radius: 8px; font-size: 1rem; font-weight: 600;
               cursor: pointer; margin-top: 24px; }
        .btn:hover { background: #1e8449; }
        .error { background: #fdecea; color: #e74c3c; padding: 10px 14px; border-radius: 8px;
                 font-size: 0.88rem; margin-top: 14px; }
        .ok { background: #d5f5e3; color: #1e8449; padding: 14px; border-radius: 8px;
              font-size: 0.9rem; line-height: 1.5; }
        .ok strong { display: block; margin-bottom: 6px; }
        .warn { background: #fef9e7; color: #7d6608; padding: 10px 14px; border-radius: 8px;
                font-size: 0.82rem; margin-top: 14px; }
    </style>
</head>
<body>
<div class="box">
<?php if ($success): ?>
    <div class="ok">
        <strong>&#10004; Installation erfolgreich!</strong>
        Datenbank-Tabellen wurden erstellt und config.php wurde geschrieben.<br><br>
        <strong>WICHTIG:</strong> Bitte diese Datei (install.php) jetzt vom Server l&ouml;schen!<br><br>
        <a href="index.html" style="color:#1e8449;font-weight:700">&#8594; Zur Tippgemeinschaft</a>
    </div>
<?php else: ?>
    <h1>&#127920; Tippgemeinschaft – Installation</h1>
    <p class="sub">Datenbank einrichten und Zugangspasswort festlegen</p>

    <?php if ($error): ?>
        <div class="error"><?= htmlspecialchars($error) ?></div>
    <?php endif; ?>

    <form method="post">
        <label>MySQL-Host</label>
        <input name="db_host" value="<?= htmlspecialchars($_POST['db_host'] ?? 'rdbms.strato.de') ?>" required>

        <label>Datenbankname</label>
        <input name="db_name" value="<?= htmlspecialchars($_POST['db_name'] ?? '') ?>" placeholder="z.B. DB1234567" required>

        <label>Datenbankbenutzer</label>
        <input name="db_user" value="<?= htmlspecialchars($_POST['db_user'] ?? '') ?>" placeholder="z.B. U1234567" required>

        <label>Datenbankpasswort</label>
        <input name="db_pass" type="password" value="" required>

        <div class="sep"></div>

        <label>Zugangspasswort f&uuml;r die Tippgemeinschaft</label>
        <input name="password" type="password" placeholder="Min. 4 Zeichen" required>

        <label>Passwort wiederholen</label>
        <input name="confirm" type="password" required>

        <button type="submit" class="btn">Installieren</button>
    </form>

    <div class="warn">
        &#9888; Diese Seite nach der Installation sofort l&ouml;schen (install.php vom Server entfernen)!
    </div>
<?php endif; ?>
</div>
</body>
</html>
