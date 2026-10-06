import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { erstelleApp } from '../server/app.js';
import { erstelleSync } from '../server/sync.js';
import { neuerStore, stubQuellen, ziehung, stilleLogs, SCHEIN_BODY } from './helpers.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const DI = Date.parse('2026-10-06T10:00:00Z');

async function starteServer({ quellen = stubQuellen(), sicheresCookie = false } = {}) {
  const store = await neuerStore({ passwort: 'geheim-1234' });
  store.speichereEinstellungen({ spieler: ['Anna', 'Bernd', 'Cora'], startDatum: '2026-09-26' });
  const sync = erstelleSync({ store, quellen, jetzt: () => DI, log: stilleLogs, pause: 0 });
  const app = erstelleApp({ store, sync, jetzt: () => DI, sicheresCookie, publicDir: PUBLIC });
  const server = app.listen(0, '127.0.0.1');
  server.unref(); // schlägt ein Test fehl, bevor er den Server schließt, darf der Testlauf trotzdem enden
  await new Promise((r) => server.once('listening', r));
  const basis = `http://127.0.0.1:${server.address().port}`;
  const client = (cookie = '') => {
    const anfrage = async (methode, pfad, body, kopf = {}) => {
      const antwort = await fetch(basis + pfad, {
        method: methode,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...kopf },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const set = antwort.headers.get('set-cookie');
      if (set && set.includes('tipp_session=') && !set.includes('Max-Age=0')) cookie = set.split(';')[0];
      const text = await antwort.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* keine JSON-Antwort */ }
      return { status: antwort.status, json, text, headers: antwort.headers };
    };
    return { get: (p, k) => anfrage('GET', p, undefined, k), post: (p, b, k) => anfrage('POST', p, b ?? {}, k), put: (p, b, k) => anfrage('PUT', p, b, k), del: (p) => anfrage('DELETE', p), cookie: () => cookie };
  };
  const angemeldet = async (passwort = 'geheim-1234') => {
    const c = client();
    assert.equal((await c.post('/api/anmelden', { passwort })).status, 200);
    return c;
  };
  const alsAdmin = () => angemeldet('admin-test-5678');
  return { store, sync, basis, client, angemeldet, alsAdmin, schliessen: () => new Promise((r) => server.close(r)) };
}

test('Ohne Anmeldung ist die Schnittstelle gesperrt, die Seite und der Healthcheck sind offen', async () => {
  const s = await starteServer();
  const c = s.client();
  assert.equal((await c.get('/api/zustand')).status, 401);
  assert.equal((await c.put('/api/einstellungen', {})).status, 401);
  assert.equal((await c.get('/api/sitzung')).json.angemeldet, false);
  assert.equal((await c.get('/healthz')).text, 'ok');
  const seite = await c.get('/');
  assert.equal(seite.status, 200);
  assert.match(seite.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(seite.headers.get('x-robots-tag'), 'noindex, nofollow');
  await s.schliessen();
});

test('Anmeldung: falsches Passwort, richtiges Passwort, Abmeldung', async () => {
  const s = await starteServer();
  const c = s.client();
  const falsch = await c.post('/api/anmelden', { passwort: 'falsch' });
  assert.equal(falsch.status, 401);
  assert.equal(falsch.json.error, 'Falsches Passwort.');
  const ok = await c.post('/api/anmelden', { passwort: 'geheim-1234' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie'), /tipp_session=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000/);
  assert.equal((await c.get('/api/sitzung')).json.angemeldet, true);
  assert.equal((await c.get('/api/zustand')).status, 200);
  await c.post('/api/abmelden');
  assert.equal((await c.get('/api/zustand')).status, 401);
  await s.schliessen();
});

test('Cookie trägt Secure, wenn nicht ausdrücklich abgeschaltet', async () => {
  const s = await starteServer({ sicheresCookie: true });
  const r = await s.client().post('/api/anmelden', { passwort: 'geheim-1234' });
  assert.match(r.headers.get('set-cookie'), /; Secure$/);
  await s.schliessen();
});

test('Bremse: nach 8 Fehlversuchen ist die Anmeldung gesperrt, auch mit richtigem Passwort', async () => {
  const s = await starteServer();
  const c = s.client();
  for (let i = 0; i < 8; i += 1) assert.equal((await c.post('/api/anmelden', { passwort: `falsch${i}` })).status, 401);
  const gesperrt = await c.post('/api/anmelden', { passwort: 'geheim-1234' });
  assert.equal(gesperrt.status, 429);
  assert.match(gesperrt.json.error, /Zu viele Versuche/);
  await s.schliessen();
});

test('Schreibzugriffe von fremden Seiten werden abgelehnt', async () => {
  const s = await starteServer();
  const c = await s.alsAdmin();
  const fremd = await c.put('/api/einstellungen', { spieler: ['A', 'B'], startDatum: '2026-01-03' }, { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(fremd.status, 403);
  const fremdeHerkunft = await c.put('/api/einstellungen', { spieler: ['A', 'B'], startDatum: '2026-01-03' }, { Origin: 'https://boese.example' });
  assert.equal(fremdeHerkunft.status, 403);
  const eigene = await c.put('/api/einstellungen', { spieler: ['A', 'B'], startDatum: '2026-09-26' }, { Origin: s.basis, 'Sec-Fetch-Site': 'same-origin' });
  assert.equal(eigene.status, 200);
  await s.schliessen();
});

test('Einstellungen werden geprüft und gespeichert', async () => {
  const s = await starteServer();
  const c = await s.alsAdmin();
  assert.equal((await c.put('/api/einstellungen', { spieler: ['Nur einer'], startDatum: '2026-01-03' })).status, 400);
  assert.equal((await c.put('/api/einstellungen', { spieler: ['A', ''], startDatum: '2026-01-03' })).status, 400);
  assert.equal((await c.put('/api/einstellungen', { spieler: ['A', 'B'], startDatum: '2026-02-30' })).status, 400);
  const ok = await c.put('/api/einstellungen', { spieler: [' Anna ', 'Bernd'], startDatum: '2026-09-26' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.einstellungen.spieler, ['Anna', 'Bernd']);
  await s.schliessen();
});

test('Schein: Prüfungen mit verständlichen Meldungen', async () => {
  const s = await starteServer();
  const c = await s.alsAdmin();
  const fehler = async (aenderung, muster) => {
    const r = await c.post('/api/scheine', { ...SCHEIN_BODY, ...aenderung });
    assert.equal(r.status, 400, JSON.stringify(aenderung));
    assert.match(r.json.error, muster);
  };
  await fehler({ gueltigAb: 'morgen' }, /Datum/);
  await fehler({ felder: [] }, /Mindestens ein Spielfeld/);
  await fehler({ felder: [{ nums: [1, 2, 3], sz: 0 }] }, /genau 6 Zahlen/);
  await fehler({ felder: [{ nums: [1, 2, 3, 4, 5, 50], sz: 0 }] }, /1 bis 49/);
  await fehler({ felder: [{ nums: [1, 2, 3, 4, 5, 5], sz: 0 }] }, /doppelt/);
  await fehler({ felder: [{ nums: [1, 2, 3, 4, 5, 6], sz: 10 }] }, /Superzahl/);
  await fehler({ felder: [{ nums: [1, 2, 3, 4, 5, 6], sz: null }] }, /Superzahl/);
  await fehler({ felder: Array.from({ length: 9 }, () => ({ nums: [], sz: null })) }, /Höchstens 8/);
  await fehler({ losnummer: '12345' }, /7 Ziffern/);
  await fehler({ losnummer: '' }, /Scheinnummer/);
  await fehler({ kosten: 0 }, /Kosten/);
  await fehler({ kosten: 'viel' }, /Kosten/);
  await s.schliessen();
});

test('Schein anlegen, bearbeiten, löschen; Datum nur einmal', async () => {
  const s = await starteServer();
  const c = await s.alsAdmin();
  const angelegt = await c.post('/api/scheine', { ...SCHEIN_BODY, gueltigAb: '2026-09-26', losnummer: '123 4560' });
  assert.equal(angelegt.status, 200);
  const schein = angelegt.json.scheine[0];
  assert.equal(schein.losnummer, '1234560', 'Leerzeichen werden entfernt');
  assert.equal(schein.felder.length, 8, 'immer 8 Felder, leere aufgefüllt');
  assert.deepEqual(schein.felder[2], { nums: [], sz: null });
  assert.equal((await c.post('/api/scheine', { ...SCHEIN_BODY, gueltigAb: '2026-09-26' })).status, 400);

  const felder = [{ nums: [49, 1, 2, 3, 4, 5], sz: 7 }];
  const geaendert = await c.put(`/api/scheine/${schein.id}`, { ...SCHEIN_BODY, gueltigAb: '2026-09-26', felder });
  assert.deepEqual(geaendert.json.scheine[0].felder[0], { nums: [1, 2, 3, 4, 5, 49], sz: 7 }, 'Zahlen werden sortiert');
  assert.equal((await c.put('/api/scheine/999', SCHEIN_BODY)).status, 404);

  const zweiter = await c.post('/api/scheine', { ...SCHEIN_BODY, gueltigAb: '2026-10-10', kosten: 15 });
  assert.equal(zweiter.json.scheine.length, 2);
  const geloescht = await c.del(`/api/scheine/${zweiter.json.scheine[1].id}`);
  assert.equal(geloescht.json.scheine.length, 1);
  await s.schliessen();
});

test('Abruf und Abrechnung: Ziehungen holen, Gewinne und Bilanz berechnen', async () => {
  // Beim ersten Samstag haben beide Felder 2 Richtige + SZ (je Klasse 9 = 6 €), beim zweiten nichts; Spiel 77 und Super 6 treffen nie
  const zs = [
    ziehung('2026-09-26', { nums: [1, 2, 30, 31, 32, 33] }),
    ziehung('2026-10-03', { nums: [40, 41, 42, 43, 44, 45] }),
  ];
  const s = await starteServer({ quellen: stubQuellen({ ziehungen: zs, hessen: zs[1] }) });
  const c = await s.alsAdmin();
  await c.post('/api/scheine', { ...SCHEIN_BODY, gueltigAb: '2026-09-26' });

  const start = await c.post('/api/abruf');
  assert.equal(start.json.gestartet, true);
  await s.sync.starte();
  const z = (await c.get('/api/zustand')).json;
  assert.equal(z.sync.fehler, null);
  assert.equal(z.heute, '2026-10-06');
  assert.equal(z.naechsterSpieltag, '2026-10-10');
  assert.deepEqual(z.abrechnung.zeilen.map((r) => [r.datum, r.status, r.gewinn]), [
    ['2026-09-26', 'endgueltig', 12],
    ['2026-10-03', 'endgueltig', 0],
  ]);
  assert.equal(z.abrechnung.summe.kosten, 26.7);
  assert.equal(z.abrechnung.summe.gewinn, 12);
  assert.equal(z.abrechnung.summe.bilanz, -14.7);
  assert.equal(z.abrechnung.summe.proSpieler.bilanz, -4.9);
  const erste = z.abrechnung.zeilen[0].auswertung;
  assert.equal(erste.lotto.felder[0].klasse, 9);
  assert.equal(erste.lotto.felder[1].klasse, 9);
  assert.equal(erste.spiel77.endziffern, 0);
  assert.equal(z.abrechnung.zeilen[1].ziehung.geprueft, 'lotto-hessen');
  await s.schliessen();
});

test('Abruf: innerhalb von 30 Sekunden wird nicht erneut gestartet', async () => {
  const s = await starteServer({ quellen: stubQuellen({ ziehungen: [ziehung('2026-10-03')] }) });
  const c = await s.angemeldet();
  assert.equal((await c.post('/api/abruf')).json.gestartet, true);
  await s.sync.starte();
  assert.equal((await c.post('/api/abruf')).json.gestartet, false);
  await s.schliessen();
});

test('Korrekturbuchungen zählen zum Gewinn, auch negative', async () => {
  const s = await starteServer();
  const c = await s.alsAdmin();
  await c.post('/api/scheine', { ...SCHEIN_BODY, gueltigAb: '2026-09-26' });
  assert.equal((await c.post('/api/korrekturen', { datum: '2026-10-03', lotto: 0, spiel77: 0, super6: 0 })).status, 400);
  assert.equal((await c.post('/api/korrekturen', { datum: 'x', lotto: 5 })).status, 400);
  assert.equal((await c.post('/api/korrekturen', { datum: '2026-10-03', lotto: 'viel' })).status, 400);
  const a = await c.post('/api/korrekturen', { datum: '2026-10-03', lotto: 12.5, notiz: 'Gutschrift der Annahmestelle' });
  const b = await c.post('/api/korrekturen', { datum: '2026-10-04', spiel77: -2.5, notiz: 'x'.repeat(200) });
  assert.equal(b.json.korrekturen.length, 2);
  assert.equal(b.json.korrekturen[0].notiz.length, 80);
  assert.equal(b.json.abrechnung.summe.gewinnKorrekturen, 10);
  const id = a.json.korrekturen.find((k) => k.lotto === 12.5).id;
  const ohne = await c.del(`/api/korrekturen/${id}`);
  assert.equal(ohne.json.abrechnung.summe.gewinnKorrekturen, -2.5);
  assert.equal((await c.del(`/api/korrekturen/${id}`)).status, 404);
  await s.schliessen();
});

test('Rollen: ein Eingabefeld, das Passwort entscheidet, ob Mitglied oder Admin', async () => {
  const s = await starteServer();
  const m = await s.angemeldet();
  const a = await s.alsAdmin();
  assert.equal((await m.get('/api/sitzung')).json.rolle, 'mitglied');
  assert.equal((await a.get('/api/sitzung')).json.rolle, 'admin');
  assert.equal((await m.get('/api/zustand')).json.rolle, 'mitglied');
  assert.equal((await a.get('/api/zustand')).json.rolle, 'admin');
  assert.equal((await s.client().get('/api/sitzung')).json.rolle, null);
  await s.schliessen();
});

test('Mitglieder dürfen nichts ändern (Einstellungen, Passwörter, Tippschein, Buchungen), aber ansehen und „Jetzt prüfen“ nutzen', async () => {
  const s = await starteServer({ quellen: stubQuellen({ ziehungen: [ziehung('2026-10-03')] }) });
  const a = await s.alsAdmin();
  const angelegt = await a.post('/api/scheine', { ...SCHEIN_BODY, gueltigAb: '2026-09-26' });
  const scheinId = angelegt.json.scheine[0].id;
  const buchung = await a.post('/api/korrekturen', { datum: '2026-10-03', lotto: 5, notiz: 'vom Admin' });
  const buchungId = buchung.json.korrekturen[0].id;

  const m = await s.angemeldet();
  const vorher = (await m.get('/api/zustand')).json;
  const neu = { spieler: ['X', 'Y'], startDatum: '2026-02-07' };
  const verweigert = [
    await m.put('/api/einstellungen', neu),
    await m.put('/api/passwort', { neu: 'neues-passwort' }),
    await m.put('/api/admin-passwort', { aktuell: 'admin-test-5678', neu: 'noch-ein-neues' }),
    await m.post('/api/scheine', { ...SCHEIN_BODY, gueltigAb: '2026-10-10' }),
    await m.put(`/api/scheine/${scheinId}`, { ...SCHEIN_BODY, gueltigAb: '2026-09-26', kosten: 99 }),
    await m.del(`/api/scheine/${scheinId}`),
    await m.post('/api/korrekturen', { datum: '2026-10-03', lotto: 1 }),
    await m.del(`/api/korrekturen/${buchungId}`),
  ];
  assert.deepEqual(verweigert.map((r) => r.status), Array(8).fill(403));
  assert.ok(verweigert.every((r) => r.json.error === 'Nur für den Admin.'));

  const nachher = (await m.get('/api/zustand')).json;
  assert.deepEqual(nachher.einstellungen, vorher.einstellungen);
  assert.deepEqual(nachher.scheine, vorher.scheine, 'der Schein ist unverändert');
  assert.deepEqual(nachher.korrekturen, vorher.korrekturen, 'die Buchung ist unverändert');
  assert.equal(nachher.scheine.length, 1);
  assert.equal(nachher.korrekturen.length, 1);

  // Ansehen und Abruf bleiben für Mitglieder möglich
  assert.equal(nachher.abrechnung.zeilen.length >= 1, true);
  assert.equal((await m.post('/api/abruf')).status, 200);
  assert.equal((await s.client().post('/api/anmelden', { passwort: 'geheim-1234' })).status, 200, 'Mitglieder-Passwort gilt weiter');
  await s.schliessen();
});

test('Admin setzt das Passwort der Mitglieder neu: alte Mitglieder-Anmeldungen enden, der Admin bleibt angemeldet', async () => {
  const s = await starteServer();
  const m = await s.angemeldet();
  const a = await s.alsAdmin();
  assert.equal((await a.put('/api/passwort', { neu: 'kurz' })).status, 400);
  const gleich = await a.put('/api/passwort', { neu: 'admin-test-5678' });
  assert.equal(gleich.status, 400);
  assert.match(gleich.json.error, /unterscheiden/);
  assert.equal((await a.put('/api/passwort', { neu: 'neues-passwort' })).status, 200);
  assert.equal((await a.get('/api/zustand')).status, 200, 'der Admin bleibt angemeldet');
  assert.equal((await m.get('/api/zustand')).status, 401, 'Mitglieder müssen sich neu anmelden');
  assert.equal((await s.client().post('/api/anmelden', { passwort: 'geheim-1234' })).status, 401, 'altes Passwort gilt nicht mehr');
  const neu = s.client();
  assert.equal((await neu.post('/api/anmelden', { passwort: 'neues-passwort' })).json.rolle, 'mitglied');
  await s.schliessen();
});

test('Admin-Passwort ändern: altes muss stimmen, muss sich vom Mitglieder-Passwort unterscheiden, andere Admin-Anmeldungen enden', async () => {
  const s = await starteServer();
  const a1 = await s.alsAdmin();
  const a2 = await s.alsAdmin();
  const m = await s.angemeldet();
  assert.equal((await a1.put('/api/admin-passwort', { aktuell: 'falsch', neu: 'neues-admin-pw' })).status, 401);
  assert.equal((await a1.put('/api/admin-passwort', { aktuell: 'admin-test-5678', neu: 'kurz' })).status, 400);
  assert.equal((await a1.put('/api/admin-passwort', { aktuell: 'admin-test-5678', neu: 'geheim-1234' })).status, 400);
  assert.equal((await a1.put('/api/admin-passwort', { aktuell: 'admin-test-5678', neu: 'neues-admin-pw' })).status, 200);
  assert.equal((await a1.get('/api/zustand')).status, 200, 'die eigene Sitzung bleibt');
  assert.equal((await a2.get('/api/zustand')).status, 401, 'andere Admin-Sitzungen enden');
  assert.equal((await m.get('/api/zustand')).status, 200, 'Mitglieder sind nicht betroffen');
  assert.equal((await s.client().post('/api/anmelden', { passwort: 'admin-test-5678' })).status, 401);
  assert.equal((await s.client().post('/api/anmelden', { passwort: 'neues-admin-pw' })).json.rolle, 'admin');
  await s.schliessen();
});

test('Unbekannte Adressen und kaputte Eingaben', async () => {
  const s = await starteServer();
  const c = await s.angemeldet();
  assert.equal((await c.get('/api/gibtsnicht')).status, 404);
  const kaputt = await fetch(`${s.basis}/api/einstellungen`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: c.cookie() }, body: '{nicht json',
  });
  assert.equal(kaputt.status, 400);
  await s.schliessen();
});

test('Datenbank aus der Zeit vor den Rollen wird nachgerüstet, Passwort und Sitzungen bleiben, Sitzungen werden Mitglieder', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { oeffneDatenbank, erstelleStore, hashPassword } = await import('../server/db.js');
  const datei = path.join(mkdtempSync(path.join(tmpdir(), 'tipp-migration-')), 'tipp.db');
  const alt = new DatabaseSync(datei);
  alt.exec(`
    CREATE TABLE einstellungen (id INTEGER PRIMARY KEY CHECK (id = 1), spieler TEXT NOT NULL, start_datum TEXT NOT NULL, passwort_hash TEXT);
    CREATE TABLE sitzungen (token_hash TEXT PRIMARY KEY, laeuft_ab INTEGER NOT NULL);
  `);
  const hash = await hashPassword('altes-mitglieder-pw');
  alt.prepare('INSERT INTO einstellungen (id, spieler, start_datum, passwort_hash) VALUES (1, ?, ?, ?)').run('["Anna","Bernd"]', '2026-01-03', hash);
  alt.prepare('INSERT INTO sitzungen (token_hash, laeuft_ab) VALUES (?, ?)').run('abc', 9999999999999);
  alt.close();

  const store = erstelleStore(oeffneDatenbank(datei));
  assert.equal(store.passwortHash(), hash, 'das bisherige Passwort bleibt erhalten');
  assert.equal(store.adminHash(), null);
  assert.deepEqual(store.sitzung('abc'), { laeuftAb: 9999999999999, rolle: 'mitglied' });
  assert.deepEqual(store.einstellungen().spieler, ['Anna', 'Bernd']);
  // zweites Öffnen ändert nichts mehr
  const wieder = erstelleStore(oeffneDatenbank(datei));
  assert.equal(wieder.passwortHash(), hash);
});
