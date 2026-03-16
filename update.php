<?php
// Fehleranzeige aktivieren (hilft beim Finden von Problemen)
ini_set('display_errors', 1);
error_reporting(E_ALL);

// --- DATENBANK-KONFIGURATION ---
$db_host = 'database-5019970591.webspace-host.com'; 
$db_user = 'dbu4242856';
$db_pass = 'Klebe-25l0tt02026';
$db_name = 'dbs15413347';

$conn = new mysqli($db_host, $db_user, $db_pass, $db_name);
if ($conn->connect_error) { die("Datenbank-Fehler: " . $conn->connect_error); }

// Eure festen Daten
$meine_felder = [
    [8, 12, 13, 16, 25, 33], [11, 27, 30, 33, 41, 46],
    [3, 8, 19, 20, 30, 43], [7, 12, 17, 25, 27, 39],
    [10, 26, 36, 40, 45, 47], [19, 32, 38, 41, 43, 47],
    [4, 9, 11, 23, 39, 42], [3, 6, 15, 21, 36, 37]
];
$meine_losnummer = "9118100";
$meine_superzahl = 0;
$wochenpreis = 13.53;

// --- HILFSFUNKTION FÜR SICHEREN DOWNLOAD (cURL) ---
function hole_webseite($url) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    // Simuliert einen echten Webbrowser
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    $output = curl_exec($ch);
    curl_close($ch);
    return $output;
}

// Letzten Samstag ermitteln
$letzter_samstag = new DateTime('last Saturday');
$datum_key = $letzter_samstag->format('Y-m-d');

// 1. Prüfen: Wurde dieser Samstag schon berechnet?
// KORREKTUR: Wir fragen 'datum' ab, nicht 'id'
$check = $conn->query("SELECT datum FROM ziehungen WHERE datum = '$datum_key'");
if (!$check) { die("SQL-Fehler: " . $conn->error); }

if ($check->num_rows > 0) {
    die("Die Ziehung vom $datum_key wurde bereits erfolgreich abgerechnet.");
}

// 2. DATEN ABRUFEN (mit der neuen, sicheren Methode)
$html_lotto = hole_webseite("https://services.lotto-hessen.de/spielinformationen/gewinnzahlen/lotto");
$html_s6 = hole_webseite("https://services.lotto-hessen.de/spielinformationen/gewinnzahlen/super6");
$html_s77 = hole_webseite("https://services.lotto-hessen.de/spielinformationen/gewinnzahlen/spiel77");
$xml_quoten_raw = hole_webseite("https://services.lotto-hessen.de/spielinformationen/quoten/lotto");

if ($html_lotto && $xml_quoten_raw) {
    
    // --- ZAHLEN EXTRAHIEREN ---
    preg_match_all('/>([0-9]{1,2})</', $html_lotto, $matches_lotto);
    $gezogene_zahlen = array_slice($matches_lotto[1], 0, 6);
    $gezogene_superzahl = $matches_lotto[1][6] ?? 0;

    preg_match('/([0-9]{6})/', $html_s6, $match_s6);
    preg_match('/([0-9]{7})/', $html_s77, $match_s77);
    $gewinnzahl_s6 = $match_s6[1] ?? "000000";
    $gewinnzahl_s77 = $match_s77[1] ?? "0000000";

    // --- XML QUOTEN AUSLESEN ---
    $xml = simplexml_load_string($xml_quoten_raw);
    if (!$xml) { die("Fehler: Konnte die XML-Quoten nicht lesen."); }

    $exakte_quoten = [
        1 => (float)$xml->Gewinnklasse1,
        2 => (float)$xml->Gewinnklasse2,
        3 => (float)$xml->Gewinnklasse3,
        4 => (float)$xml->Gewinnklasse4,
        5 => (float)$xml->Gewinnklasse5,
        6 => (float)$xml->Gewinnklasse6,
        7 => (float)$xml->Gewinnklasse7,
        8 => (float)$xml->Gewinnklasse8,
        9 => (float)$xml->Gewinnklasse9
    ];

    $quoten_super6 = [0 => 0, 1 => 2.50, 2 => 6.00, 3 => 66.00, 4 => 666.00, 5 => 6666.00, 6 => 100000.00];
    $quoten_spiel77 = [0 => 0, 1 => 5.00, 2 => 17.00, 3 => 77.00, 4 => 777.00, 5 => 7777.00, 6 => 77777.00, 7 => 177777.00];

    $gesamtgewinn_woche = 0;

    // --- 3. ABGLEICH 6 AUS 49 ---
    foreach ($meine_felder as $feld) {
        $treffer = count(array_intersect($feld, $gezogene_zahlen));
        $hat_sz = ($gezogene_superzahl == $meine_superzahl);
        
        $gewinnklasse = 0;
        if ($treffer == 6 && $hat_sz) $gewinnklasse = 1;
        elseif ($treffer == 6 && !$hat_sz) $gewinnklasse = 2;
        elseif ($treffer == 5 && $hat_sz) $gewinnklasse = 3;
        elseif ($treffer == 5 && !$hat_sz) $gewinnklasse = 4;
        elseif ($treffer == 4 && $hat_sz) $gewinnklasse = 5;
        elseif ($treffer == 4 && !$hat_sz) $gewinnklasse = 6;
        elseif ($treffer == 3 && $hat_sz) $gewinnklasse = 7;
        elseif ($treffer == 3 && !$hat_sz) $gewinnklasse = 8;
        elseif ($treffer == 2 && $hat_sz) $gewinnklasse = 9;

        if ($gewinnklasse > 0) {
            $gesamtgewinn_woche += $exakte_quoten[$gewinnklasse];
        }
    }

    // --- 4. SUPER 6 ABGLEICHEN ---
    $treffer_s6 = 0;
    for ($i = 1; $i <= 6; $i++) {
        if (substr($meine_losnummer, -$i) === substr($gewinnzahl_s6, -$i)) { $treffer_s6 = $i; } 
        else { break; } 
    }
    $gesamtgewinn_woche += $quoten_super6[$treffer_s6];

    // --- 5. SPIEL 77 ABGLEICHEN ---
    $treffer_s77 = 0;
    for ($i = 1; $i <= 7; $i++) {
        if (substr($meine_losnummer, -$i) === substr($gewinnzahl_s77, -$i)) { $treffer_s77 = $i; } 
        else { break; }
    }
    $gesamtgewinn_woche += $quoten_spiel77[$treffer_s77];

    // --- 6. FINANZEN & HISTORIE BUCHEN ---
    $anteil_kosten = $wochenpreis / 3;
    $anteil_gewinn = $gesamtgewinn_woche / 3;
    $differenz = $anteil_gewinn - $anteil_kosten;

    $conn->query("UPDATE mitglieder SET kontostand = kontostand + $differenz");

    for ($m_id = 1; $m_id <= 3; $m_id++) {
        $conn->query("INSERT INTO transaktionen (mitglied_id, typ, betrag) VALUES ($m_id, 'Beitrag', -$anteil_kosten)");
        if ($anteil_gewinn > 0) {
            $conn->query("INSERT INTO transaktionen (mitglied_id, typ, betrag) VALUES ($m_id, 'Gewinn', $anteil_gewinn)");
        }
    }

    $z1 = $gezogene_zahlen[0] ?? null; $z2 = $gezogene_zahlen[1] ?? null;
    $z3 = $gezogene_zahlen[2] ?? null; $z4 = $gezogene_zahlen[3] ?? null;
    $z5 = $gezogene_zahlen[4] ?? null; $z6 = $gezogene_zahlen[5] ?? null;
    
    $conn->query("INSERT INTO ziehungen (datum, z1, z2, z3, z4, z5, z6, superzahl, spiel77, super6, gewinn_pro_feld, abgerechnet) 
                  VALUES ('$datum_key', '$z1', '$z2', '$z3', '$z4', '$z5', '$z6', '$gezogene_superzahl', '$gewinnzahl_s77', '$gewinnzahl_s6', '$gesamtgewinn_woche', 1)");

    echo "Erfolg: Ziehung für den $datum_key wurde abgerechnet! Gesamtgewinn: " . number_format($gesamtgewinn_woche, 2, ',', '.') . " €";

} else {
    echo "Fehler: Konnte Daten von Lotto Hessen nicht abrufen.";
}
?>