// Browser-Test (Headless-Chromium) gegen eine laufende Instanz.
// Aufruf: E2E_PASSWORD=... E2E_ADMIN_PASSWORD=... node scripts/e2e.mjs [url] [--schreiben] [--shots <ordner>]
//   E2E_PASSWORD         Passwort der Mitglieder, E2E_ADMIN_PASSWORD das des Admins. Es genügt eines von beiden,
//                        Tests für die fehlende Rolle werden übersprungen.
//   E2E_AUTH=benutzer:passwort   nur für Vorschauen mit HTTP-Basic-Auth in Coolify
//   --schreiben                  erlaubt Änderungen (Korrekturbuchung anlegen und löschen, Einstellungen ändern und zurücksetzen);
//                                nie gegen die echte Instanz verwenden. Ohne diese Option wird nur gelesen.
// Voraussetzung: Playwright mit Chromium im Projekt oder unter /root/tools/browser-check.
// Geprüft wird auch, dass keine Konsolenfehler und keine CSP-Verstöße auftreten.

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = await import('/root/tools/browser-check/node_modules/playwright/index.mjs'));
}

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:3000/';
const schreiben = args.includes('--schreiben');
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const passwoerter = { mitglied: process.env.E2E_PASSWORD, admin: process.env.E2E_ADMIN_PASSWORD };
if (!passwoerter.mitglied && !passwoerter.admin) throw new Error('E2E_PASSWORD oder E2E_ADMIN_PASSWORD fehlt.');
const standard = passwoerter.mitglied ? 'mitglied' : 'admin'; // Rolle für alle Tests, die keine bestimmte brauchen
const passwort = passwoerter[standard];
const [authUser, authPass] = (process.env.E2E_AUTH ?? '').split(':');
if (shots) mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ channel: 'chromium' });
const results = [];

async function offen({ size = { width: 1280, height: 900 }, anmelden = true, rolle = standard } = {}) {
  const context = await browser.newContext({
    viewport: size,
    httpCredentials: authUser ? { username: authUser, password: authPass } : undefined,
  });
  const page = await context.newPage();
  const probleme = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) probleme.push(`[console.${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => probleme.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => probleme.push(`[requestfailed] ${r.url()}`));
  await page.goto(url);
  if (anmelden) {
    await page.fill('#passwort', passwoerter[rolle]);
    await page.click('#anmeldeformular button[type=submit]');
    await page.waitForSelector('#karten .karte');
  }
  return { page, context, probleme };
}

async function test(name, fn, optionen = {}) {
  if (name.startsWith('Schreiben:') && !schreiben) return;
  if (!passwoerter[optionen.rolle ?? standard]) {
    results.push({ name, ok: true, uebersprungen: true, ms: 0 });
    return;
  }
  const t0 = Date.now();
  const s = await offen(optionen);
  try {
    await fn(s);
    // 401 bei der Sitzungsprüfung vor der Anmeldung ist erwartet und kein Fehler der Seite
    // Absichtlich ausgelöste Fehlerantworten (zum Beispiel 400 bei falschen Eingaben) meldet der Browser als Konsolenfehler
    const echte = s.probleme.filter((p) => !/status of 401/.test(p) && !(optionen.erwartet && optionen.erwartet.test(p)));
    assert.deepEqual(echte, [], `Konsolenfehler oder CSP-Verstöße:\n${echte.join('\n')}`);
    results.push({ name, ok: true, ms: Date.now() - t0 });
  } catch (e) {
    if (shots) await s.page.screenshot({ path: `${shots}/FEHLER-${name.replace(/\W+/g, '_')}.png`, fullPage: true }).catch(() => {});
    results.push({ name, ok: false, ms: Date.now() - t0, fehler: e.message });
  } finally {
    await s.context.close();
  }
}

const text = (page, sel) => page.locator(sel).innerText();

await test('Anmeldung: falsches Passwort wird abgelehnt, richtiges öffnet die App', async ({ page }) => {
  await page.waitForSelector('#anmeldung', { state: 'visible' }); // die Seite prüft zuerst, ob schon eine Sitzung besteht
  await page.fill('#passwort', 'ganz-sicher-falsch');
  await page.click('#anmeldeformular button[type=submit]');
  await page.waitForFunction(() => document.getElementById('anmeldefehler').textContent.length > 0);
  assert.match(await text(page, '#anmeldefehler'), /Falsches Passwort|Zu viele Versuche/);
  assert.equal(await page.isVisible('#app'), false);
  await page.fill('#passwort', passwort);
  await page.click('#anmeldeformular button[type=submit]');
  await page.waitForSelector('#karten .karte');
  assert.equal(await page.isVisible('#anmeldung'), false);
}, { anmelden: false });

await test('Übersicht: vier Karten, Abgleich, Mitspieler, Verlauf, Fußzeile mit Impressum und Datenschutz', async ({ page, context }) => {
  assert.equal(await page.locator('#karten .karte').count(), 4);
  assert.match(await text(page, '#karten'), /€/);
  assert.ok(await page.locator('#abgleich .abgleich').count());
  assert.ok((await page.locator('#spieler-tabelle tbody tr').count()) >= 3);
  const links = await page.locator('footer a').evaluateAll((as) => as.map((a) => a.href));
  assert.ok(links.some((l) => l.endsWith('/#impressum')));
  assert.ok(links.some((l) => l.endsWith('/datenschutz.html')));
  // Sitzung bleibt nach dem Neuladen erhalten
  await page.reload();
  await page.waitForSelector('#karten .karte');
  const cookies = await context.cookies();
  const sitzung = cookies.find((c) => c.name === 'tipp_session');
  assert.ok(sitzung?.httpOnly, 'Sitzungscookie ist HttpOnly');
  assert.equal(sitzung.sameSite, 'Lax');
});

await test('Abgleich: Ziehungen durchblättern, Treffer und Zusatzlotterien sichtbar', async ({ page }) => {
  const felder = await page.locator('#abgleich .feld').count();
  if (felder === 0) return; // noch kein Tippschein eingetragen
  assert.ok(felder >= 1 && felder <= 8);
  assert.equal(await page.locator('#abgleich .gezogen .kugel').count(), 7, '6 Zahlen und die Superzahl');
  const alt = await text(page, '#abgleich .abgleich-kopf h2');
  if (await page.locator('[data-aktion=aelter]:not([disabled])').count()) {
    await page.click('[data-aktion=aelter]');
    assert.notEqual(await text(page, '#abgleich .abgleich-kopf h2'), alt);
    await page.click('[data-aktion=neuer]');
    assert.equal(await text(page, '#abgleich .abgleich-kopf h2'), alt);
  }
  const optionen = await page.locator('#abgleich-datum option').evaluateAll((o) => o.map((x) => x.value));
  await page.selectOption('#abgleich-datum', optionen[optionen.length - 1]);
  assert.match(await text(page, '#abgleich .abgleich-kopf h2'), /Abgleich:/);
  // Treffer sind markiert, wenn es welche gibt: Anzahl grüner Kugeln entspricht den Treffern der Texte
  const treffer = await page.locator('#abgleich .tippschein .kugel.treffer:not(.sz)').count();
  const summeTexte = await page.locator('#abgleich .feld .ergebnis').evaluateAll((els) =>
    els.reduce((s, e) => s + Number(/(\d) Treffer/.exec(e.innerText)?.[1] ?? 0), 0));
  assert.equal(treffer, summeTexte, 'markierte Kugeln und genannte Treffer stimmen überein');
});

await test('Verlauf: Klick auf eine Zeile wählt die Ziehung, „Alle anzeigen“ klappt auf und zu', async ({ page }) => {
  const zeilen = page.locator('#verlauf-tabelle tbody tr.klickbar');
  if ((await zeilen.count()) < 2) return;
  const datum = await zeilen.nth(1).getAttribute('data-datum');
  await zeilen.nth(1).click();
  assert.equal(await page.locator('#abgleich-datum').inputValue(), datum);
  assert.ok(await page.locator('#verlauf-tabelle tr.gewaehlt').count());
  if (await page.locator('#verlauf-umschalten').count()) {
    const vorher = await zeilen.count();
    await page.click('#verlauf-umschalten');
    assert.ok((await page.locator('#verlauf-tabelle tbody tr.klickbar').count()) > vorher);
    await page.click('#verlauf-umschalten');
    assert.equal(await page.locator('#verlauf-tabelle tbody tr.klickbar').count(), vorher);
  }
});

await test('Dialog: Tippschein zeigt die gespeicherten Daten und schließt mit Abbrechen', async ({ page }) => {
  await page.click('#knopf-schein');
  assert.equal(await page.isVisible('#dialog-schein'), true);
  assert.equal(await page.locator('#schein-felder tr').count(), 8);
  assert.match(await page.inputValue('#schein-kosten'), /^\d/);
  await page.click('#dialog-schein [data-schliessen]');
  assert.equal(await page.isVisible('#dialog-schein'), false);
}, { rolle: 'admin' });

await test('Rollen: Mitglied kann nichts ändern, sieht aber alles, und der Server verweigert Änderungen ebenfalls', async ({ page }) => {
  for (const knopf of ['#knopf-einstellungen', '#knopf-schein', '#knopf-korrektur', '#admin-marke']) {
    assert.equal(await page.isVisible(knopf), false, `${knopf} ist für Mitglieder sichtbar`);
  }
  assert.equal(await page.locator('[data-loeschen]').count(), 0, 'keine Löschknöpfe bei den Buchungen');
  assert.equal(await page.isVisible('#knopf-abruf'), true, '„Jetzt prüfen“ bleibt');
  assert.ok(await page.locator('#abgleich .abgleich').count(), 'Abgleich bleibt sichtbar');
  const status = await page.evaluate(async () => {
    const senden = (pfad, body, methode = 'PUT') => fetch(pfad, { method: methode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status);
    return {
      einstellungen: await senden('/api/einstellungen', { spieler: ['A', 'B'], startDatum: '2026-01-03' }),
      passwort: await senden('/api/passwort', { neu: 'ein-neues-passwort' }),
      admin: await senden('/api/admin-passwort', { aktuell: 'x', neu: 'ein-neues-passwort' }),
      schein: await senden('/api/scheine', { gueltigAb: '2099-01-01' }, 'POST'),
      buchung: await senden('/api/korrekturen', { datum: '2026-01-03', lotto: 1 }, 'POST'),
      loeschen: await fetch('/api/korrekturen/1', { method: 'DELETE' }).then((r) => r.status),
    };
  });
  assert.deepEqual(status, { einstellungen: 403, passwort: 403, admin: 403, schein: 403, buchung: 403, loeschen: 403 });
}, { rolle: 'mitglied', erwartet: /status of 403/ });

await test('Rollen: Admin sieht Einstellungen mit Mitspielern, Startdatum und beiden Passwort-Formularen', async ({ page }) => {
  for (const knopf of ['#knopf-einstellungen', '#knopf-schein', '#knopf-korrektur', '#admin-marke']) {
    assert.equal(await page.isVisible(knopf), true, `${knopf} fehlt beim Admin`);
  }
  await page.click('#knopf-einstellungen');
  assert.ok((await page.inputValue('#einst-spieler')).split('\n').length >= 2);
  assert.match(await page.inputValue('#einst-start'), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(await page.isVisible('#pw-neu'), true);
  assert.equal(await page.isVisible('#adm-neu'), true);
  await page.check('#pw-zeigen');
  assert.equal(await page.getAttribute('#pw-neu', 'type'), 'text');
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('#dialog-einstellungen'), false);
}, { rolle: 'admin' });

await test('Abmelden führt zurück zur Anmeldung, die Schnittstelle ist danach gesperrt', async ({ page }) => {
  await page.click('#knopf-abmelden');
  await page.waitForSelector('#anmeldung', { state: 'visible' });
  const status = await page.evaluate(async () => (await fetch('/api/zustand')).status);
  assert.equal(status, 401);
});

await test('Sicherheit: Kopfzeilen und kein Zugriff auf Daten ohne Anmeldung', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const seite = await fetch('/');
    const api = await fetch('/api/zustand');
    return {
      csp: seite.headers.get('content-security-policy'),
      robots: seite.headers.get('x-robots-tag'),
      nosniff: seite.headers.get('x-content-type-options'),
      status: api.status,
    };
  });
  assert.match(r.csp, /default-src 'self'/);
  assert.match(r.csp, /frame-ancestors 'none'/);
  assert.equal(r.robots, 'noindex, nofollow');
  assert.equal(r.nosniff, 'nosniff');
});

await test('Handy (390 px): kein seitliches Scrollen, Abgleich lesbar', async ({ page }) => {
  const breite = await page.evaluate(() => ({ dok: document.documentElement.scrollWidth, fenster: window.innerWidth }));
  assert.ok(breite.dok <= breite.fenster, `Seite ist ${breite.dok}px breit bei ${breite.fenster}px Fenster`);
  if (shots) await page.screenshot({ path: `${shots}/handy.png`, fullPage: true });
}, { size: { width: 390, height: 844 } });

await test('Schreiben: Korrekturbuchung anlegen, in den Summen sehen, wieder löschen', async ({ page }) => {
  const vorher = await text(page, '#karten .karte:nth-child(2) .karte-wert');
  await page.click('#knopf-korrektur');
  await page.fill('#k-lotto', '12.34');
  await page.fill('#k-notiz', 'E2E-Test');
  await page.click('#korrektur-formular button[type=submit]');
  await page.waitForSelector('#korrektur-tabelle td:has-text("E2E-Test")');
  assert.notEqual(await text(page, '#karten .karte:nth-child(2) .karte-wert'), vorher);
  page.once('dialog', (d) => d.accept());
  await page.click('#korrektur-tabelle tr:has-text("E2E-Test") [data-loeschen]');
  await page.waitForFunction(() => !document.getElementById('korrektur-tabelle').textContent.includes('E2E-Test'));
  assert.equal(await text(page, '#karten .karte:nth-child(2) .karte-wert'), vorher);
}, { rolle: 'admin' });

await test('Schreiben: Tippschein-Dialog meldet falsche Eingaben verständlich', async ({ page }) => {
  await page.click('#knopf-schein');
  await page.fill('#sf-nums-0', '1 2 3');
  await page.fill('#sf-sz-0', '5');
  await page.click('#schein-speichern');
  await page.waitForFunction(() => document.getElementById('schein-fehler').textContent.length > 0);
  assert.match(await text(page, '#schein-fehler'), /genau 6 Zahlen/);
  await page.fill('#sf-nums-0', '1 2 3 4 5 5');
  await page.click('#schein-speichern');
  await page.waitForFunction(() => /doppelt/.test(document.getElementById('schein-fehler').textContent));
  assert.equal(await page.isVisible('#dialog-schein'), true, 'Dialog bleibt offen');
}, { rolle: 'admin', erwartet: /status of 400/ });

await test('Schreiben: Admin ändert die Mitspieler und stellt sie wieder her', async ({ page }) => {
  await page.click('#knopf-einstellungen');
  const vorher = await page.inputValue('#einst-spieler');
  await page.fill('#einst-spieler', 'E2E Eins\nE2E Zwei');
  await page.click('#einstellungen-formular button[type=submit]');
  await page.waitForFunction(() => document.getElementById('spieler-tabelle').textContent.includes('E2E Eins'));
  await page.click('#knopf-einstellungen');
  await page.fill('#einst-spieler', vorher);
  await page.click('#einstellungen-formular button[type=submit]');
  await page.waitForFunction(() => !document.getElementById('spieler-tabelle').textContent.includes('E2E Eins'));
  await page.click('#knopf-einstellungen');
  assert.equal(await page.inputValue('#einst-spieler'), vorher);
}, { rolle: 'admin' });

await browser.close();

for (const r of results) {
  if (r.uebersprungen) console.log(`- ${r.name} (übersprungen, kein Passwort für diese Rolle)`);
  else console.log(`${r.ok ? '✔' : '✖'} ${r.name} (${r.ms} ms)${r.ok ? '' : `\n    ${r.fehler.replace(/\n/g, '\n    ')}`}`);
}
const bad = results.filter((r) => !r.ok).length;
const uebersprungen = results.filter((r) => r.uebersprungen).length;
console.log(`\n${results.length - bad - uebersprungen} von ${results.length - uebersprungen} Browser-Tests bestanden`
  + `${uebersprungen ? `, ${uebersprungen} übersprungen` : ''}${schreiben ? '' : ' (nur lesend, --schreiben für alle)'}`);
process.exit(bad ? 1 : 0);
