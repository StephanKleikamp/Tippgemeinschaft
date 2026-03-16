<?php
$db_host = 'database-5019970591.webspace-host.com'; // Meistens bei Strato so
$db_user = 'dbu4242856';
$db_pass = 'Klebe-25l0tt02026';
$db_name = 'dbs15413347';
$admin_passwort = 'Klebe-25'; // HIER ÄNDERN!

$conn = new mysqli($db_host, $db_user, $db_pass, $db_name);
session_start();

// Login-Logik
if (isset($_POST['login'])) {
    if ($_POST['pw'] == $admin_passwort) { $_SESSION['loggedin'] = true; }
}

if (!isset($_SESSION['loggedin'])): ?>
    <form method="post" style="text-align:center; margin-top:100px;">
        <h2>Admin Login</h2>
        <input type="password" name="pw"> <button type="submit" name="login">Login</button>
    </form>
<?php else: 
    // Einzahlung buchen
    if (isset($_POST['pay'])) {
        $m_id = $_POST['m_id'];
        $betrag = str_replace(',', '.', $_POST['betrag']);
        $conn->query("UPDATE mitglieder SET kontostand = kontostand + $betrag WHERE id = $m_id");
        $conn->query("INSERT INTO transaktionen (mitglied_id, typ, betrag) VALUES ($m_id, 'Einzahlung', $betrag)");
        echo "<div style='color:green;'>Erfolgreich gebucht!</div>";
    }
    
    $mitglieder = $conn->query("SELECT * FROM mitglieder");
?>
    <!DOCTYPE html>
    <html lang="de">
    <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css">
        <title>Lotto Admin</title>
    </head>
    <body class="p-5">
        <h1>Einzahlung buchen</h1>
        <form method="post" class="mb-5">
            <select name="m_id" class="form-select mb-2">
                <?php while($m = $mitglieder->fetch_assoc()): ?>
                    <option value="<?php echo $m['id']; ?>"><?php echo $m['name']; ?> (Stand: <?php echo $m['kontostand']; ?> €)</option>
                <?php endwhile; ?>
            </select>
            <input type="text" name="betrag" class="form-control mb-2" placeholder="Betrag (z.B. 50.00)">
            <button type="submit" name="pay" class="btn btn-primary">Geldeingang speichern</button>
        </form>
        <a href="index.php">Zurück zur Hauptseite</a>
    </body>
    </html>
<?php endif; ?>