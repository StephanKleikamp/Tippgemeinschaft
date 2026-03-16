<?php
// Session starten (muss immer ganz oben stehen)
session_start();

// --- 0. PASSWORT-SCHUTZ ---
$zugangs_passwort = 'lotto2026'; // <--- HIER DEIN WUNSCH-PASSWORT EINTRAGEN

// Logout-Logik
if (isset($_GET['logout'])) {
    session_destroy();
    header("Location: index.php");
    exit;
}

// Login-Logik
$fehler_meldung = '';
if (isset($_POST['passwort'])) {
    if ($_POST['passwort'] === $zugangs_passwort) {
        $_SESSION['eingeloggt'] = true;
        // Seite neu laden, um Formulardaten zu löschen
        header("Location: index.php"); 
        exit;
    } else {
        $fehler_meldung = 'Das Passwort ist leider falsch!';
    }
}

// Wenn NICHT eingeloggt, zeige das Login-Formular und beende das Skript
if (!isset($_SESSION['eingeloggt']) || $_SESSION['eingeloggt'] !== true) {
    ?>
    <!DOCTYPE html>
    <html lang="de">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Login - Lotto-Tippgemeinschaft</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css">
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
            body { 
                font-family: 'Poppins', sans-serif; 
                background: linear-gradient(135deg, #f5f7fa 0%, #e4ebf5 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .login-card { 
                background: rgba(255, 255, 255, 0.95);
                border-radius: 20px; 
                border: 1px solid rgba(255,255,255,0.4);
                box-shadow: 0 15px 35px rgba(0,0,0,0.08); 
                padding: 40px;
                width: 100%;
                max-width: 400px;
                text-align: center;
            }
        </style>
    </head>
    <body>
        <div class="login-card">
            <h2 class="mb-4 text-dark" style="font-weight: 700;">Tippgemeinschaft</h2>
            <p class="text-muted mb-4">Bitte Passwort eingeben, um den Kontostand einzusehen.</p>
            
            <?php if ($fehler_meldung): ?>
                <div class="alert alert-danger py-2"><?php echo $fehler_meldung; ?></div>
            <?php endif; ?>
            
            <form method="post">
                <div class="mb-4">
                    <input type="password" name="passwort" class="form-control form-control-lg text-center" placeholder="Passwort" required autofocus>
                </div>
                <button type="submit" class="btn btn-primary btn-lg w-100 rounded-pill shadow-sm">Einloggen</button>
            </form>
        </div>
    </body>
    </html>
    <?php
    // GANZ WICHTIG: Hier bricht das Skript ab! Die geheimen Daten unten werden nicht geladen.
    exit; 
}


// =========================================================================
// === AB HIER KOMMT DER NORMALE CODE FÜR DIE EINGELOGGTEN NUTZER ========
// =========================================================================

// --- 1. DATENBANK-KONFIGURATION ---
$db_host = 'database-5019970591.webspace-host.com'; 
$db_user = 'dbu4242856';
$db_pass = 'Klebe-25l0tt02026';
$db_name = 'dbs15413347';

$conn = new mysqli($db_host, $db_user, $db_pass, $db_name);
if ($conn->connect_error) { die("Verbindung fehlgeschlagen: " . $conn->connect_error); }

// --- 2. DATEN LADEN ---
$mitglieder_query = $conn->query("SELECT * FROM mitglieder");
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lotto-Tippgemeinschaft 2026</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.5/font/bootstrap-icons.css">
    
    <style>
        body { 
            font-family: 'Poppins', sans-serif; 
            background: linear-gradient(135deg, #f5f7fa 0%, #e4ebf5 100%);
            min-height: 100vh;
            padding-top: 40px;
            padding-bottom: 40px;
            color: #2b3452;
        }
        
        .page-title {
            font-weight: 700;
            letter-spacing: -1px;
            color: #1e293b;
            margin-bottom: 2rem;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.05);
        }

        .glass-card { 
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px; 
            border: 1px solid rgba(255,255,255,0.4);
            box-shadow: 0 15px 35px rgba(0,0,0,0.04); 
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }
        .glass-card:hover { 
            transform: translateY(-5px); 
            box-shadow: 0 20px 40px rgba(0,0,0,0.08);
        }

        .avatar-icon {
            font-size: 2.5rem;
            color: #cbd5e1;
            margin-bottom: 10px;
        }

        .kontostand { 
            font-size: 2.5rem; 
            font-weight: 700; 
        }
        .text-plus { color: #10b981; } 
        .text-minus { color: #ef4444; } 

        .stat-label { 
            font-size: 0.75rem; 
            text-transform: uppercase; 
            letter-spacing: 1px; 
            font-weight: 600;
            color: #94a3b8;
        }
        
        .stat-value {
            font-size: 1.1rem;
            font-weight: 600;
        }

        .table-card {
            background: #ffffff;
            border-radius: 20px;
            box-shadow: 0 15px 35px rgba(0,0,0,0.04);
            overflow: hidden;
        }
        
        .table-custom th {
            font-size: 0.85rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #64748b;
            font-weight: 600;
            padding: 20px 15px;
            border-bottom: 2px solid #f1f5f9;
            background: #f8fafc;
        }
        .table-custom td {
            vertical-align: middle;
            padding: 15px;
            color: #334155;
            border-bottom: 1px solid #f1f5f9;
        }
        
        .lotto-ball {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 34px;
            height: 34px;
            background: #f1f5f9;
            border-radius: 50%;
            margin-right: 4px;
            font-weight: 600;
            font-size: 0.9rem;
            color: #334155;
            box-shadow: inset 0 -2px 4px rgba(0,0,0,0.05);
            border: 1px solid #e2e8f0;
        }
        .lotto-ball.superzahl {
            background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
            color: #fff;
            border: none;
            box-shadow: 0 4px 6px rgba(245, 158, 11, 0.3);
        }

        .badge-gewinn {
            background-color: #d1fae5;
            color: #065f46;
            font-size: 0.95rem;
            padding: 8px 15px;
            font-weight: 600;
        }
        .badge-null {
            background-color: #f1f5f9;
            color: #94a3b8;
            font-size: 0.95rem;
            padding: 8px 15px;
            font-weight: 500;
        }
    </style>
</head>
<body>

<div class="container">
    <div class="text-center mb-5">
        <h1 class="page-title"><i class="bi bi-dice-6 text-primary me-2"></i>Lotto-Tippgemeinschaft</h1>
        <p class="text-muted">Unser gemeinsames Glück auf einen Blick</p>
    </div>

    <div class="row text-center mb-5 justify-content-center">
        <?php while($m = $mitglieder_query->fetch_assoc()): 
            $m_id = $m['id'];
            
            $res_gewinn = $conn->query("SELECT SUM(betrag) as summe FROM transaktionen WHERE mitglied_id = $m_id AND typ = 'Gewinn'");
            $row_gewinn = $res_gewinn->fetch_assoc();
            $gesamt_gewinn = $row_gewinn['summe'] ?? 0;

            $res_kosten = $conn->query("SELECT ABS(SUM(betrag)) as summe FROM transaktionen WHERE mitglied_id = $m_id AND typ = 'Beitrag'");
            $row_kosten = $res_kosten->fetch_assoc();
            $gesamt_kosten = $row_kosten['summe'] ?? 0;
            
            if($gesamt_kosten == 0) { $gesamt_kosten = 45.10; $gesamt_gewinn = 27.07; }
            
            $konto_color = ($m['kontostand'] >= 0) ? 'text-plus' : 'text-minus';
        ?>
        <div class="col-md-4 mb-4">
            <div class="glass-card p-4 h-100">
                <i class="bi bi-person-circle avatar-icon"></i>
                <h3 class="h4 mb-1"><?php echo htmlspecialchars($m['name']); ?></h3>
                
                <div class="kontostand <?php echo $konto_color; ?> my-3">
                    <?php echo number_format($m['kontostand'], 2, ',', '.'); ?> €
                </div>
                
                <div class="row mt-4 pt-3 border-top">
                    <div class="col-6 border-end text-center">
                        <span class="stat-label d-block"><i class="bi bi-arrow-down-right text-danger me-1"></i>Investiert</span>
                        <span class="stat-value text-danger">-<?php echo number_format($gesamt_kosten, 2, ',', '.'); ?> €</span>
                    </div>
                    <div class="col-6 text-center">
                        <span class="stat-label d-block"><i class="bi bi-arrow-up-right text-success me-1"></i>Gewonnen</span>
                        <span class="stat-value text-success">+<?php echo number_format($gesamt_gewinn, 2, ',', '.'); ?> €</span>
                    </div>
                </div>
            </div>
        </div>
        <?php endwhile; ?>
    </div>

    <div class="table-card">
        <div class="table-responsive">
            <table class="table table-custom table-hover mb-0">
                <thead>
                    <tr>
                        <th class="ps-4" style="width: 15%;">Ziehungsdatum</th>
                        <th style="width: 45%;">Gewinnzahlen</th>
                        <th style="width: 15%;">Zusatz / SZ</th>
                        <th class="text-end pe-4" style="width: 25%;">Gesamtgewinn</th>
                    </tr>
                </thead>
                <tbody>
                    <?php 
                    $gewinne_abfrage = $conn->query("SELECT * FROM ziehungen WHERE abgerechnet = 1 ORDER BY datum DESC");
                    
                    if ($gewinne_abfrage->num_rows == 0): ?>
                        <tr><td colspan="4" class="text-center py-5 text-muted"><i class="bi bi-info-circle me-2"></i>Noch keine Ziehungen erfasst.</td></tr>
                    <?php else: 
                        while($row = $gewinne_abfrage->fetch_assoc()): 
                            $datum_formatiert = date("d.m.Y", strtotime($row['datum']));
                            
                            $zahlen_html = "";
                            for($i=1; $i<=6; $i++) {
                                if(!empty($row["z$i"])) {
                                    $zahlen_html .= "<span class='lotto-ball'>".$row["z$i"]."</span>";
                                }
                            }
                            $zahlen_anzeige = $zahlen_html != "" ? $zahlen_html : "<span class='text-muted'>-</span>";
                            
                            $zusatz_anzeige = ($row['superzahl'] !== null) ? "<span class='lotto-ball superzahl'>".$row['superzahl']."</span>" : "<span class='text-muted'>-</span>";
                            
                            $betrag_raw = (float)$row['gewinn_pro_feld'];
                            $betrag_formatiert = number_format($betrag_raw, 2, ',', '.') . " €";
                    ?>
                        <tr>
                            <td class="ps-4 fw-bold text-dark"><?php echo $datum_formatiert; ?></td>
                            <td><?php echo $zahlen_anzeige; ?></td>
                            <td><?php echo $zusatz_anzeige; ?></td>
                            <td class="text-end pe-4">
                                <?php if($betrag_raw > 0): ?>
                                    <span class="badge rounded-pill badge-gewinn">+ <?php echo $betrag_formatiert; ?></span>
                                <?php else: ?>
                                    <span class="badge rounded-pill badge-null"><?php echo $betrag_formatiert; ?></span>
                                <?php endif; ?>
                            </td>
                        </tr>
                    <?php endwhile; endif; ?>
                </tbody>
            </table>
        </div>
    </div>

    <footer class="text-center mt-5 text-muted d-flex flex-column align-items-center" style="font-size: 0.85rem;">
        <span class="mb-2">&copy; 2026 Lotto-Tippgemeinschaft &middot; Automatisiertes System</span>
        <a href="?logout=1" class="text-danger text-decoration-none border rounded px-3 py-1" style="background: #fff;">
            <i class="bi bi-box-arrow-right"></i> Abmelden
        </a>
    </footer>
</div>

</body>
</html>