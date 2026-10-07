import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SPIELE, waehleSpiel, oeffentlich } from '../server/spiele.js';
import { eurojackpotKlasse, EUROJACKPOT_KLASSEN, werteZiehungAus, baueAbrechnung, schaetzeQuoten, letzterWochentag, ersterWochentag, tageZwischen } from '../server/rules.js';
import { normalisiereLottoDeEuro, normalisiereHessenEuro, erstelleQuellen } from '../server/sources.js';
import { erstelleSync, erwarteteZiehung, naechsterSpieltag } from '../server/sync.js';
import { erstelleApp, pruefeSchein } from '../server/app.js';
import { neuerStore, stubQuellen, ziehungEuro, QUOTEN_EURO, stilleLogs, SCHEIN_BODY_EURO } from './helpers.js';

const EURO = SPIELE.eurojackpot;
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// ---- Spiele ----

test('Spiel wählen: Standard ist 6aus49, unbekannte Spiele werden abgelehnt', () => {
  assert.equal(waehleSpiel().id, 'lotto');
  assert.equal(waehleSpiel('eurojackpot').name, 'Eurojackpot');
  assert.throws(() => waehleSpiel('keno'), /Unbekanntes Spiel/);
  const o = oeffentlich(EURO);
  assert.deepEqual(Object.keys(o).sort(), ['feld', 'felder', 'id', 'kosten', 'name', 'serie', 'seitentitel', 'spalten', 'symbol', 'titel', 'untertitel', 'zusatz']);
  assert.equal(o.zusatz, false);
  assert.equal(o.feld.zahlen, 5);
});

// ---- Regeln ----

test('Eurojackpot: alle zwölf Gewinnklassen, wie lotto.de sie nennt', () => {
  const erwartet = { '5-2': 1, '5-1': 2, '5-0': 3, '4-2': 4, '4-1': 5, '3-2': 6, '4-0': 7, '2-2': 8, '3-1': 9, '3-0': 10, '1-2': 11, '2-1': 12 };
  for (const [kombi, klasse] of Object.entries(erwartet)) {
    const [t, e] = kombi.split('-').map(Number);
    assert.equal(eurojackpotKlasse(t, e), klasse, `${t} + ${e}`);
  }
  for (const [t, e] of [[0, 0], [0, 2], [1, 0], [1, 1], [2, 0], [0, 1]]) assert.equal(eurojackpotKlasse(t, e), null, `${t} + ${e}`);
  assert.equal(Object.keys(EUROJACKPOT_KLASSEN).length, 12);
});

test('Eurojackpot: Auswertung je Feld mit Treffern, Eurozahlen und Beträgen', () => {
  const schein = {
    id: 1, gueltigAb: '2026-01-02', kosten: 12.2, spiel77: false, super6: false, losnummer: '',
    felder: [
      { nums: [4, 6, 7, 17, 45], euro: [7, 12] }, // Klasse 1, Quote 0 (Jackpot ohne Quote) bleibt offen
      { nums: [4, 6, 7, 17, 20], euro: [7, 1] }, // 4 + 1: Klasse 5
      { nums: [4, 6, 7, 30, 31], euro: [1, 2] }, // 3 + 0: Klasse 10
      { nums: [4, 6, 30, 31, 32], euro: [7, 12] }, // 2 + 2: Klasse 8
      { nums: [4, 30, 31, 32, 33], euro: [7, 1] }, // 1 + 1: kein Gewinn
      { nums: [4, 6, 30, 31, 32], euro: [7, 3] }, // 2 + 1: Klasse 12
    ],
  };
  const a = werteZiehungAus(ziehungEuro('2026-10-02'), schein, {}, EURO);
  const f = a.lotto.felder;
  assert.deepEqual(f.map((x) => x.klasse), [1, 5, 10, 8, null, 12]);
  assert.deepEqual(f.map((x) => x.betrag), [null, 307.1, 15.7, 28.1, null, 9.4]);
  assert.deepEqual(f[1].euroTreffer, [7]);
  assert.deepEqual(f[0].treffer, [4, 6, 7, 17, 45]);
  assert.equal(f[0].offen, true);
  assert.equal(f[1].klasseLabel, '4 Richtige + 1 Eurozahl');
  assert.equal(f[3].klasseLabel, '2 Richtige + 2 Eurozahlen');
  assert.equal(a.spiel77, null);
  assert.equal(a.super6, null);
  assert.equal(a.gewinn, 360.3);
  assert.equal(a.offen, 1);
});

test('Eurojackpot: ohne Quoten bleiben alle Gewinne offen und werden geschätzt', () => {
  const schein = { id: 1, gueltigAb: '2026-01-02', kosten: 12.2, felder: [{ nums: [4, 6, 30, 31, 32], euro: [7, 3] }] };
  const alt = ziehungEuro('2026-09-25');
  const a = werteZiehungAus(ziehungEuro('2026-10-02', { quoten: null }), schein, schaetzeQuoten([alt], 8, EURO), EURO);
  assert.equal(a.gewinn, 0, 'nichts ist fest');
  assert.equal(a.lotto.felder[0].offen, true);
  assert.equal(a.geschaetzt, 9.4);
});

test('Eurojackpot: Schätzung nur für die mittleren Klassen', () => {
  const s = schaetzeQuoten([ziehungEuro('2026-09-25'), ziehungEuro('2026-10-02')], 8, EURO);
  assert.deepEqual(Object.keys(s).map(Number), [4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(s[12], 9.4);
  assert.equal(s[1], undefined);
});

test('Wochentage: Freitag', () => {
  assert.equal(ersterWochentag('2026-10-02', 5), '2026-10-02');
  assert.equal(ersterWochentag('2026-10-03', 5), '2026-10-09');
  assert.equal(letzterWochentag('2026-10-07', 5), '2026-10-02');
  assert.equal(letzterWochentag('2026-10-02', 5), '2026-10-02');
  assert.deepEqual(tageZwischen('2026-09-28', '2026-10-17', 5), ['2026-10-02', '2026-10-09', '2026-10-16']);
});

test('Eurojackpot: Abrechnung je Freitag, Dienstagsziehungen zählen nicht, Kosten ab Spieltag', () => {
  const schein = { id: 1, gueltigAb: '2026-09-18', kosten: 12.2, spiel77: false, super6: false, felder: [{ nums: [4, 6, 30, 31, 32], euro: [7, 3] }] };
  const ziehungen = [
    ziehungEuro('2026-09-18'),
    ziehungEuro('2026-09-22', { serie: 'Dienstag' }),
    ziehungEuro('2026-09-25'),
    ziehungEuro('2026-10-02'),
  ];
  const r = baueAbrechnung({ ziehungen, scheine: [schein], startDatum: '2026-09-18', heute: '2026-10-07', spieler: ['A', 'B'], spiel: EURO });
  assert.deepEqual(r.zeilen.map((z) => z.datum), ['2026-09-18', '2026-09-25', '2026-10-02']);
  assert.equal(r.summe.wochen, 3);
  assert.equal(r.summe.kosten, 36.6);
  assert.equal(r.summe.gewinn, 28.2, 'dreimal Klasse 12 mit 9,40 €');
  assert.equal(r.summe.proSpieler.kosten, 18.3);
  assert.deepEqual(r.zeilen[2].ziehung.euro, [7, 12]);
  // am Freitag selbst zählt der Spieltag mit, bevor die Ziehung in der Datenbank ist
  const freitag = baueAbrechnung({ ziehungen: [], scheine: [schein], startDatum: '2026-09-18', heute: '2026-10-09', spieler: ['A'], spiel: EURO });
  assert.deepEqual(freitag.zeilen.map((z) => z.datum), ['2026-09-18', '2026-09-25', '2026-10-02', '2026-10-09']);
  assert.ok(freitag.zeilen.every((z) => z.status === 'ausstehend'));
});

// ---- Quellen ----

test('lotto.de: echte Eurojackpot-Ziehung vom 02.10.2026', () => {
  const z = normalisiereLottoDeEuro(fixture('lottode-eurojackpot-2026-10-02.json'));
  assert.equal(z.date, '2026-10-02');
  assert.equal(z.serie, 'Freitag');
  assert.deepEqual(z.nums, [6, 4, 17, 7, 45], 'Zahlen in der Reihenfolge der Ziehung');
  assert.deepEqual(z.euro, [7, 12]);
  assert.equal(z.sz, null);
  assert.equal(z.quelle, 'lotto.de');
  assert.equal(Object.keys(z.quoten.eurojackpot).length, 12);
  assert.equal(z.quoten.eurojackpot[12], 9.4);
  assert.equal(z.quoten.eurojackpot[1], 0);
  assert.deepEqual(z.quoten.eurojackpot, QUOTEN_EURO.eurojackpot);
});

test('lotto.de Eurojackpot: ohne Quoten vorläufig, kaputte Antworten abgelehnt, Dienstag erkannt', () => {
  assert.equal(normalisiereLottoDeEuro(fixture('lottode-eurojackpot-unfertig.json')).quoten, null);
  const klasse12 = fixture('lottode-eurojackpot-2026-10-02.json');
  klasse12.oddsCollection.find((o) => o.winningClass === 12).odds = 0;
  assert.equal(normalisiereLottoDeEuro(klasse12).quoten, null, 'Klasse 12 ohne Betrag heißt noch nicht berechnet');
  assert.equal(normalisiereLottoDeEuro(null), null);
  const zuWenig = fixture('lottode-eurojackpot-2026-10-02.json');
  zuWenig.drawNumbersCollection.pop();
  assert.equal(normalisiereLottoDeEuro(zuWenig), null);
  const falscheEuro = fixture('lottode-eurojackpot-2026-10-02.json');
  falscheEuro.drawNumbersCollection[5].drawNumber = 13;
  assert.equal(normalisiereLottoDeEuro(falscheEuro), null, 'Eurozahl 13 gibt es nicht');
  const dienstag = fixture('lottode-eurojackpot-2026-10-02.json');
  dienstag.gameType.name = 'Eurojackpot Dienstag';
  assert.equal(normalisiereLottoDeEuro(dienstag).serie, 'Dienstag');
});

test('Lotto Hessen Eurojackpot: Zahlen, Eurozahlen und Quoten der Dienstagsziehung', () => {
  const z = normalisiereHessenEuro({ zahlen: fixture('hessen-eurojackpot-zahlen.json'), quoten: fixture('hessen-eurojackpot-quoten.json') });
  assert.equal(z.date, '2026-10-06');
  assert.equal(z.serie, 'Dienstag');
  assert.deepEqual(z.nums, [50, 12, 28, 7, 19]);
  assert.deepEqual(z.euro, [1, 6]);
  assert.equal(z.quoten.eurojackpot[12], 9.6);
  assert.equal(z.quoten.eurojackpot[2], 883793.9);
  // Quoten einer anderen Ziehung werden nicht übernommen
  const fremd = normalisiereHessenEuro({ zahlen: fixture('hessen-eurojackpot-zahlen.json'), quoten: { ...fixture('hessen-eurojackpot-quoten.json'), Datum: '02.10.2026' } });
  assert.equal(fremd.quoten, null);
  assert.equal(normalisiereHessenEuro({ zahlen: { ...fixture('hessen-eurojackpot-zahlen.json'), Eurozahl: [1] } }), null);
});

test('Abruf Eurojackpot: Adressen der Schnittstelle, ein Objekt statt einer Liste, kein Archiv', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return new Response(JSON.stringify(url.includes('/history/') ? { days: [{ date: '2026-10-02' }] } : fixture('lottode-eurojackpot-2026-10-02.json')));
  };
  const q = erstelleQuellen({ fetchImpl, spiel: EURO });
  assert.deepEqual(await q.lottoDeTage(2026), ['2026-10-02']);
  assert.equal((await q.lottoDeZiehung('2026-10-02')).euro.length, 2);
  assert.ok(urls[0].endsWith(`/entities.eurojackpot/history/${Date.parse('2026-12-31T00:00:00Z')}`));
  assert.ok(urls[1].endsWith(`/entities.eurojackpot/draw/${Date.parse('2026-10-02T00:00:00Z')}`), urls[1]);
  assert.deepEqual(await q.archiv('2026-01-01'), []);
  assert.equal(urls.length, 2, 'das Archiv wird für Eurojackpot nicht abgerufen');
});

// ---- Zeitplan und Abruf ----

const FR_ABEND = Date.parse('2026-10-09T19:00:00Z'); // 21:00 Berlin
const FR_FRUEH = Date.parse('2026-10-09T08:00:00Z'); // 10:00 Berlin
const DI = Date.parse('2026-10-06T10:00:00Z');

test('Zeitplan Eurojackpot: Freitag 20:15 Uhr beginnt die Erwartung, nächster Spieltag bis zur Ziehung', () => {
  assert.equal(erwarteteZiehung(DI, EURO), '2026-10-02');
  assert.equal(erwarteteZiehung(FR_FRUEH, EURO), '2026-10-02');
  assert.equal(erwarteteZiehung(FR_ABEND, EURO), '2026-10-09');
  assert.equal(naechsterSpieltag(DI, EURO), '2026-10-09');
  assert.equal(naechsterSpieltag(FR_FRUEH, EURO), '2026-10-09');
  assert.equal(naechsterSpieltag(Date.parse('2026-10-09T18:30:00Z'), EURO), '2026-10-16', 'nach 20:00 Uhr ist der nächste Freitag gemeint');
  // 6aus49 bleibt unberührt
  assert.equal(erwarteteZiehung(DI), '2026-10-03');
});

async function syncEuro(quellen, jetzt = () => DI) {
  const store = await neuerStore({ spiel: EURO });
  store.speichereEinstellungen({ spieler: ['A', 'B'], startDatum: '2026-09-18' });
  return { store, sync: erstelleSync({ store, quellen, spiel: EURO, jetzt, log: stilleLogs, pause: 0 }) };
}

test('Abruf Eurojackpot: holt die Freitage, lässt Dienstage aus, Hessen bestätigt die neueste', async () => {
  const zs = [ziehungEuro('2026-09-18'), ziehungEuro('2026-09-25'), ziehungEuro('2026-10-02'), ziehungEuro('2026-09-22', { serie: 'Dienstag' })];
  const hessen = ziehungEuro('2026-10-02', { quelle: 'lotto-hessen' });
  const quellen = stubQuellen({ ziehungen: zs, hessen });
  const { store, sync } = await syncEuro(quellen);
  const r = await sync.starte();
  assert.equal(r.ok, true);
  assert.deepEqual(quellen.aufrufe.ziehungen.sort(), ['2026-09-18', '2026-09-25', '2026-10-02']);
  const z = store.ziehung('2026-10-02');
  assert.equal(z.geprueft, 'lotto-hessen');
  assert.deepEqual(z.euro, [7, 12]);
  assert.equal(z.sz, null);
  assert.deepEqual(z.quoten, QUOTEN_EURO);
  assert.equal(store.ziehungen().length, 3);
});

test('Abruf Eurojackpot: abweichende Eurozahlen zwischen den Quellen werden erkannt', async () => {
  const quellen = stubQuellen({
    ziehungen: [ziehungEuro('2026-10-02')],
    hessen: ziehungEuro('2026-10-02', { euro: [1, 2], quelle: 'lotto-hessen' }),
  });
  const { store, sync } = await syncEuro(quellen);
  await sync.starte();
  assert.equal(store.ziehung('2026-10-02').geprueft, 'abweichung');
  assert.match(store.meta('sync_fehler'), /weichen/);
});

test('Abruf Eurojackpot: Ausfall von lotto.de, Lotto Hessen liefert die letzte Ziehung, ältere fehlen (kein Archiv)', async () => {
  const quellen = stubQuellen({ lottoDeAus: true, hessen: ziehungEuro('2026-10-02', { quelle: 'lotto-hessen' }), archiv: [] });
  const { store, sync } = await syncEuro(quellen);
  const r = await sync.starte();
  assert.equal(r.ok, false);
  assert.equal(store.ziehungen().length, 1);
  assert.equal(store.ziehung('2026-10-02').quelle, 'lotto-hessen');
});

test('Freitag-Wochenende: Zahlen am Abend, Quoten später werden von selbst übernommen', async () => {
  let jetzt = FR_ABEND;
  const ohne = ziehungEuro('2026-10-09', { quoten: null });
  const store = await neuerStore({ spiel: EURO });
  store.speichereEinstellungen({ spieler: ['A', 'B'], startDatum: '2026-10-09' });
  const quellen = stubQuellen({ ziehungen: [ohne], hessen: ohne });
  const sync = erstelleSync({ store, quellen, spiel: EURO, jetzt: () => jetzt, log: stilleLogs, pause: 0 });
  assert.equal(sync.sollLaufen(), true);
  await sync.starte();
  assert.equal(store.ziehung('2026-10-09').quoten, null);
  assert.equal(store.ziehung('2026-10-09').geprueft, 'lotto-hessen');
  jetzt += 20 * 60 * 1000;
  assert.equal(sync.sollLaufen(), true, 'Quoten fehlen noch, nach 15 Minuten wieder fragen');
  quellen.setzeZiehungen([ziehungEuro('2026-10-09')]);
  await sync.starte();
  assert.deepEqual(store.ziehung('2026-10-09').quoten, QUOTEN_EURO);
  jetzt += 20 * 60 * 1000;
  assert.equal(sync.sollLaufen(), false);
});

// ---- Eingaben und Schnittstelle ----

test('Schein Eurojackpot: Prüfungen mit verständlichen Meldungen', () => {
  const fehler = (aenderung) => {
    try {
      pruefeSchein({ ...SCHEIN_BODY_EURO, ...aenderung }, EURO);
      return null;
    } catch (e) {
      return e.message;
    }
  };
  assert.match(fehler({ felder: [{ nums: [1, 2, 3, 4], euro: [1, 2] }] }), /genau 5 Zahlen/);
  assert.match(fehler({ felder: [{ nums: [1, 2, 3, 4, 51], euro: [1, 2] }] }), /1 bis 50/);
  assert.match(fehler({ felder: [{ nums: [1, 2, 3, 4, 4], euro: [1, 2] }] }), /doppelt/);
  assert.match(fehler({ felder: [{ nums: [1, 2, 3, 4, 5], euro: [1] }] }), /genau 2 Eurozahlen/);
  assert.match(fehler({ felder: [{ nums: [1, 2, 3, 4, 5], euro: [1, 13] }] }), /Eurozahlen von 1 bis 12/);
  assert.match(fehler({ felder: [{ nums: [1, 2, 3, 4, 5], euro: [0, 2] }] }), /Eurozahlen von 1 bis 12/);
  assert.match(fehler({ felder: [{ nums: [1, 2, 3, 4, 5], euro: [3, 3] }] }), /Eurozahl doppelt/);
  assert.match(fehler({ felder: [] }), /Mindestens ein Spielfeld mit 5 Zahlen und 2 Eurozahlen/);
  assert.match(fehler({ felder: Array.from({ length: 13 }, () => ({ nums: [] })) }), /Höchstens 12/);
  assert.equal(fehler({}), null);
  const ok = pruefeSchein({ ...SCHEIN_BODY_EURO, felder: [{ nums: [5, 4, 3, 2, 1], euro: [12, 1] }], losnummer: '9545957', spiel77: true, super6: true }, EURO);
  assert.deepEqual(ok.felder[0], { nums: [1, 2, 3, 4, 5], euro: [1, 12] }, 'Zahlen und Eurozahlen werden sortiert');
  assert.equal(ok.losnummer, '', 'Scheinnummer, Spiel 77 und Super 6 gibt es bei Eurojackpot nicht');
  assert.equal(ok.spiel77, false);
  assert.equal(ok.super6, false);
});

async function starteEuro({ quellen = stubQuellen() } = {}) {
  const store = await neuerStore({ spiel: EURO, passwort: 'euro-2026', adminPasswort: 'admin-euro-2026' });
  store.speichereEinstellungen({ spieler: ['Anna', 'Bernd'], startDatum: '2026-09-18' });
  const sync = erstelleSync({ store, quellen, spiel: EURO, jetzt: () => DI, log: stilleLogs, pause: 0 });
  const app = erstelleApp({ store, sync, spiel: EURO, jetzt: () => DI, sicheresCookie: false, publicDir: PUBLIC });
  const server = app.listen(0, '127.0.0.1');
  server.unref();
  await new Promise((r) => server.once('listening', r));
  const basis = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    const anfrage = async (methode, pfad, body) => {
      const antwort = await fetch(basis + pfad, {
        method: methode,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const set = antwort.headers.get('set-cookie');
      if (set && set.includes('tipp_session=') && !set.includes('Max-Age=0')) cookie = set.split(';')[0];
      const text = await antwort.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* keine JSON-Antwort */ }
      return { status: antwort.status, json };
    };
    return { get: (p) => anfrage('GET', p), post: (p, b) => anfrage('POST', p, b ?? {}), put: (p, b) => anfrage('PUT', p, b), del: (p) => anfrage('DELETE', p) };
  };
  const anmelden = async (passwort) => {
    const c = client();
    assert.equal((await c.post('/api/anmelden', { passwort })).status, 200);
    return c;
  };
  return { store, sync, client, anmelden, schliessen: () => new Promise((r) => server.close(r)) };
}

test('Eurojackpot-Instanz: Spiel ist öffentlich bekannt, Passwörter der Gruppe gelten, Rollen wie bei 6aus49', async () => {
  const s = await starteEuro();
  const offen = await s.client().get('/api/spiel');
  assert.equal(offen.status, 200);
  assert.equal(offen.json.id, 'eurojackpot');
  assert.equal(offen.json.felder, 12);
  assert.equal(offen.json.serie, 'Freitag');
  assert.equal((await s.client().post('/api/anmelden', { passwort: 'geheim-1234' })).status, 401, 'Passwörter der 6aus49-Gruppe gelten hier nicht');
  const mitglied = await s.anmelden('euro-2026');
  const admin = await s.anmelden('admin-euro-2026');
  assert.equal((await mitglied.get('/api/zustand')).json.rolle, 'mitglied');
  assert.equal((await admin.get('/api/zustand')).json.rolle, 'admin');
  assert.equal((await mitglied.post('/api/scheine', SCHEIN_BODY_EURO)).status, 403);
  assert.equal((await mitglied.put('/api/einstellungen', { spieler: ['X', 'Y'], startDatum: '2026-01-02' })).status, 403);
  await s.schliessen();
});

test('Eurojackpot-Instanz: Schein anlegen, Ziehungen abrufen, Abrechnung mit zwei Mitspielern', async () => {
  // Feld 1 hat bei beiden Ziehungen 2 Richtige (4, 6) und 1 Eurozahl (7): Klasse 12 mit 9,40 €, Feld 2 trifft nichts
  const zs = [ziehungEuro('2026-09-25'), ziehungEuro('2026-10-02')];
  const s = await starteEuro({ quellen: stubQuellen({ ziehungen: zs, hessen: zs[1] }) });
  const admin = await s.anmelden('admin-euro-2026');
  const body = {
    ...SCHEIN_BODY_EURO,
    gueltigAb: '2026-09-18',
    felder: [{ nums: [4, 6, 30, 31, 32], euro: [7, 3] }, { nums: [1, 2, 3, 5, 8], euro: [1, 2] }],
  };
  const angelegt = await admin.post('/api/scheine', body);
  assert.equal(angelegt.status, 200);
  assert.equal(angelegt.json.scheine[0].felder.length, 12, 'immer 12 Zeilen, leere aufgefüllt');
  assert.deepEqual(angelegt.json.scheine[0].felder[0], { nums: [4, 6, 30, 31, 32], euro: [3, 7] }, 'Eurozahlen werden sortiert');
  assert.deepEqual(angelegt.json.scheine[0].felder[5], { nums: [], euro: [] });
  assert.equal(angelegt.json.spiel.id, 'eurojackpot');

  await s.sync.starte();
  const z = (await admin.get('/api/zustand')).json;
  assert.deepEqual(z.abrechnung.zeilen.map((r) => [r.datum, r.status, r.gewinn]), [
    ['2026-09-18', 'ausstehend', 0],
    ['2026-09-25', 'endgueltig', 9.4],
    ['2026-10-02', 'endgueltig', 9.4],
  ]);
  assert.equal(z.naechsterSpieltag, '2026-10-09');
  assert.equal(z.abrechnung.summe.kosten, 36.6);
  assert.equal(z.abrechnung.summe.gewinn, 18.8);
  assert.equal(z.abrechnung.summe.bilanz, -17.8);
  assert.equal(z.abrechnung.summe.proSpieler.bilanz, -8.9);
  assert.equal(z.abrechnung.zeilen[2].auswertung.lotto.felder[0].klasse, 12);
  assert.deepEqual(z.abrechnung.zeilen[2].ziehung.euro, [7, 12]);
  await s.schliessen();
});
