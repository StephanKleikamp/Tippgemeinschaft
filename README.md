# Tippgemeinschaft

Lotto-Tippgemeinschaft für **6aus49** (mit Spiel 77 und Super 6) und **Eurojackpot**: Die App holt die amtlichen Ziehungen
samt Quoten, gleicht sie mit dem Tippschein ab und rechnet Gewinne, Kosten und Bilanz je Mitspieler aus.

Dieser Branch (`coolify`) ist die Fassung für den eigenen Server (Coolify, Node + SQLite). Die ursprüngliche
PHP/MySQL-Fassung für Strato liegt unverändert auf dem Standard-Branch.

**Eine Codebasis, zwei Instanzen:** Welches Spiel eine Instanz rechnet, bestimmt die Umgebungsvariable `SPIEL`
(`lotto`, Standard, oder `eurojackpot`). Jede Instanz hat eigenes Volume, eigene Passwörter, eigene Mitspieler und Adresse.
Alles Spielspezifische (Zahlenbereiche, Wochentag, Uhrzeiten, Gewinnklassen, Quellen) steht in `server/spiele.js` und
`server/rules.js`.

## Die Idee: Tatsachen speichern, alles andere rechnen

Die PHP-Fassung trug Gewinne als „Einträge“ in die Datenbank ein, sobald ein Skript sie fand. Das war fehleranfällig:
Quoten kamen aus dem Quelltext von lotto.de (die Seite gibt es so nicht mehr), Spiel 77 und Super 6 mussten von Hand
eingetragen werden, und eine Korrektur am Schein änderte die Vergangenheit nicht.

Hier werden nur **Tatsachen** gespeichert: Tippscheine, amtliche Ziehungen mit Quoten, Einstellungen und
Korrekturbuchungen. Gewinne, Kosten und Bilanz berechnet `server/rules.js` bei jeder Anfrage neu.

- **Jede Ziehung wird vollständig ausgewertet**: 6aus49 je Feld (Treffer, Superzahl, Klasse, Betrag) sowie Spiel 77 und
  Super 6 über die Endziffern der Scheinnummer (von rechts, 7 beziehungsweise 6 Stellen).
- **Vorläufig und endgültig**: Die Zahlen kommen am Ziehungsabend, die Quoten laut Stichprobe erst bis zum Montagmorgen.
  Bis dahin gelten die festen Beträge (6aus49 Klasse 9, Spiel 77 Klasse 2 bis 7, Super 6) als sicher, offene Klassen
  werden nur als „≈ Schätzung“ (Median der letzten 8 Ziehungen) angezeigt und nicht in die Summen gerechnet.
- **Zwei Quellen**: lotto.de liefert alles, auch rückwirkend. Die neueste Ziehung wird mit Lotto Hessen gegengeprüft
  („✔ bestätigt“, bei Abweichung eine Warnung). Fällt lotto.de aus, springen Lotto Hessen und das GitHub-Archiv ein.
- **Tippscheine mit Gültigkeit**: Ändert die Gruppe ihre Zahlen oder den Preis, gilt ein neuer Schein ab einem
  Spieltag. Frühere Wochen bleiben mit den alten Zahlen abgerechnet. Eine Korrektur am ersten Schein rechnet
  alles neu.
- **Nachvollziehbar**: Die Ansicht „Abgleich“ zeigt je Ziehung den Tippschein mit markierten Treffern, die Ziffern von
  Spiel 77 und Super 6 und die Rechnung bis zur Bilanz.
- **Korrekturbuchungen** bleiben für alles, was von den amtlichen Zahlen abweicht (zum Beispiel eine Gutschrift der
  Annahmestelle).

## Betrieb

| | |
| --- | --- |
| Adressen | 6aus49: https://lotto.stephan-kleikamp.de (Samstag, 8 Felder, Spiel 77, Super 6) · Eurojackpot: https://eurojackpot.stephan-kleikamp.de (Freitag, 5 aus 50 + 2 aus 12, bis zu 12 Felder) |
| Dienst | Node 24, Express 5, SQLite (`node:sqlite`), keine weiteren Abhängigkeiten, kein Build-Schritt |
| Daten | Volume auf `/data`: `tipp.db`, tägliche Sicherungen in `/data/backups` (7 Tage, ab 3 Uhr) |
| Variablen | `SPIEL`: `lotto` (Standard) oder `eurojackpot`. `INITIAL_PASSWORD` (Mitglieder) und `ADMIN_PASSWORD` (Admin): Passwörter beim ersten Start. Danach zählen nur die Hashwerte in der Datenbank, geändert wird in den Einstellungen oder per CLI |
| Zeitplan | Ab Samstag 19:45 Uhr fragt der Server alle 15 bis 20 Minuten nach, bis alle Quoten der Ziehung da sind (laut Stichprobe Montagmorgen), danach nur noch einmal am Tag. „Jetzt prüfen“ löst einen Abruf von Hand aus (30 Sekunden Pause). Eine offene Seite frischt sich alle 5 Minuten selbst auf |
| Verwaltung | im Container: `node server/cli.js passwort <neues>` (Mitglieder), `admin-passwort <neues>` und `status` |

- **Zwei Rollen, ein Eingabefeld:** Mitglieder sehen alles (Abgleich, Verlauf, Buchungen, Tippschein) und können „Jetzt prüfen“
  auslösen, ändern aber nichts. Mit dem Admin-Passwort erscheinen zusätzlich „Einstellungen“ (Mitspieler, Startdatum,
  Passwort der Mitglieder, Admin-Passwort), „Tippschein“ und „+ Buchung“ samt Löschen. Der Server prüft die Rolle bei jeder
  Änderung selbst (`403` für Mitglieder), das Ausblenden im Browser ist nur Bedienkomfort. Setzt der Admin das
  Mitglieder-Passwort neu, werden die Mitglieder abgemeldet. Beide Passwörter müssen sich unterscheiden.
- Anmeldung mit gemeinsamem Passwort je Rolle (scrypt-Hash). Das Sitzungscookie `tipp_session` ist HttpOnly, SameSite=Lax,
  Secure und 30 Tage gültig. Nach 8 Fehlversuchen gilt 10 Minuten Sperre (nur ein Hash der IP-Adresse im Arbeitsspeicher).
- Kein Zugriffsprotokoll, keine externen Schriften oder Skripte, `noindex`. Strenge CSP, Schreibzugriffe nur von der
  eigenen Adresse.
- Sicherung zurückspielen: Datei aus `/data/backups` als `/data/tipp.db` einsetzen (und `tipp.db-wal`/`-shm` löschen).
- Gespielt wird nur am Spieltag des Spiels (6aus49 samstags, Eurojackpot freitags). Die Ziehungen der anderen Tage
  (Mittwoch beziehungsweise Dienstag) werden nicht geholt.
- Eurojackpot hat zwölf Gewinnklassen (5+2 bis 2+1), alle schwanken mit der Zahl der Gewinner. Es gibt dort keine
  Scheinnummer, kein Spiel 77, kein Super 6 und kein Archiv als dritte Quelle.

## Datenquellen

| Quelle | Wofür |
| --- | --- |
| `https://www.lotto.de/api/stats/entities.lotto/history/<Jahr>` und `/draws/<Datum>` (Eurojackpot: `entities.eurojackpot`, `/draw/<Datum>`) | alle Ziehungstage, Zahlen, Spiel 77, Super 6 und Quoten. Schnittstelle der lotto.de-Webseite, nicht dokumentiert |
| `https://services.lotto-hessen.de/spielinformationen/…` | nur die letzte Ziehung: Gegenprüfung und Ersatz |
| `https://johannesfriedrich.github.io/LottoNumberArchive/` | Zahlen seit 1955 ohne Quoten, letzter Notnagel |

Der Server fragt nur Gewinnzahlen ab. Es werden keine Angaben der Tippgemeinschaft an diese Dienste übertragen.
Ändert lotto.de die Schnittstelle, melden die Statuszeile und die Ziehungsansicht das (Quelle „Lotto Hessen“ oder
„Archiv“); die Normalisierung steht in `server/sources.js` und wird mit echten Antworten in `test/fixtures` geprüft.

## Entwicklung

```bash
npm install
INITIAL_PASSWORD=geheim-1234 DATA_DIR=.data PORT=3000 COOKIE_INSECURE=1 npm start
SPIEL=eurojackpot INITIAL_PASSWORD=... ADMIN_PASSWORD=... DATA_DIR=.data-euro PORT=3001 COOKIE_INSECURE=1 npm start   # Eurojackpot-Instanz
npm test                                    # 78 Tests: Regeln beider Spiele, Quellen, Abruf, Sicherung, Rollen, Schnittstelle
E2E_PASSWORD=geheim-1234 E2E_ADMIN_PASSWORD=... npm run e2e -- http://127.0.0.1:3000/ [--schreiben]   # 14 Browser-Tests (Playwright), erkennen das Spiel selbst
```

Die E2E-Tests mit `--schreiben` legen Buchungen an und löschen sie wieder. Gegen die echte Instanz nur ohne diese Option
laufen lassen. Für Vorschauen mit HTTP-Basic-Auth `E2E_AUTH=benutzer:passwort` setzen.

## Datenschutz

Die Datenschutzerklärung unter https://stephan-kleikamp.de/datenschutz.html enthält seit dem 06.10.2026 den Abschnitt 16
zu dieser App (Mitspielernamen, Tippschein, Scheinnummer, Abrechnung auf dem eigenen Server, Sitzungscookie nach der
Anmeldung, Abruf öffentlicher Gewinnzahlen ohne Übermittlung von Nutzerdaten, Sicherungen 7 Tage). Kommt Datenverarbeitung
hinzu (Benachrichtigungen, Konten je Mitspieler, externe Dienste), zuerst den Abschnitt ändern. Der frühere Entwurf liegt
noch in `docs/datenschutz-abschnitt.html`.
