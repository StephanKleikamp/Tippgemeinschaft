import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPIELE } from '../server/spiele.js';
import { isoKw, baueAbrechnung, baueZahlungen, ziehungsdatumBis, betragBis } from '../server/rules.js';
import { erstelleApp } from '../server/app.js';
import { erstelleSync } from '../server/sync.js';
import { neuerStore, stubQuellen, ziehungEuro, stilleLogs, QUOTEN_EURO, SCHEIN_BODY_EURO, ziehung } from './helpers.js';

const EURO = SPIELE.eurojackpot;
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const DI = Date.parse('2026-10-06T10:00:00Z');

test('Kalenderwoche nach ISO 8601', () => {
  assert.equal(isoKw('2026-07-24'), 30, 'wie im Beispiel: KW 30 = 24.07.2026');
  assert.equal(isoKw('2026-01-02'), 1);
  assert.equal(isoKw('2026-10-02'), 40);
  assert.equal(isoKw('2026-12-31'), 53, '2026 hat 53 Wochen');
  assert.equal(isoKw('2027-01-01'), 53, 'der 01.01.2027 gehört noch zur KW 53 von 2026');
  assert.equal(isoKw('2024-12-30'), 1, 'der 30.12.2024 gehört schon zur KW 1 von 2025');
});

// Fünf Freitage, Kosten je 12,20 €, bei zwei Mitspielern zahlt jeder 6,10 € je Ziehung
const FREITAGE = ['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25', '2026-10-02'];
const schein = { id: 1, gueltigAb: '2026-09-04', kosten: 12.2, spiel77: false, super6: false, felder: [{ nums: [4, 6, 30, 31, 32], euro: [7, 3] }] };

function zeilenFuer({ ziehungen, korrekturen = [], heute = '2026-10-07' }) {
  return baueAbrechnung({ ziehungen, scheine: [schein], startDatum: '2026-09-04', heute, korrekturen, spieler: ['Florian', 'Stephan'], spiel: EURO }).zeilen;
}
// 04.09., 11.09., 25.09.: Klasse 12 (9,40 €), die übrigen ohne Gewinn
const gewinnFreitage = new Set(['2026-09-04', '2026-09-11', '2026-09-25']);
const ziehungenFuer = (datumListe, extra = {}) => datumListe.map((d) => ziehungEuro(d, gewinnFreitage.has(d) ? extra : { nums: [40, 41, 42, 43, 44], euro: [1, 2], ...extra }));

test('Zahlungen: ohne Zahlung ist der ganze Anteil offen', () => {
  const zeilen = zeilenFuer({ ziehungen: ziehungenFuer(FREITAGE) });
  const z = baueZahlungen({ zeilen, spieler: ['Florian', 'Stephan'] });
  assert.equal(z.zahler, 'Florian');
  assert.equal(z.bezahlt, 0);
  assert.equal(z.bezahltBis, null);
  assert.equal(z.abgedeckt, null);
  // je Ziehung (12,20 - Gewinn) / 2: dreimal 6,10 - 4,70 = 1,40 und zweimal 6,10
  assert.deepEqual(z.ziehungen.map((x) => x.anteil), [1.4, 1.4, 6.1, 1.4, 6.1]);
  assert.equal(z.offenBetrag, 16.4);
  assert.deepEqual(z.offen, { von: '2026-09-04', bis: '2026-10-02', kwVon: 36, kwBis: 40, ziehungen: 5 });
  assert.equal(z.stand, '2026-10-02');
  assert.equal(z.ziehungen.every((x) => !x.bezahlt), true);
});

test('Zahlungen: bezahlt bis zu einer Ziehung, Rest bis zur letzten Ziehung, Zeitraum in Kalenderwochen', () => {
  const zeilen = zeilenFuer({ ziehungen: ziehungenFuer(FREITAGE) });
  const z = baueZahlungen({
    zeilen, spieler: ['Florian', 'Stephan'],
    zahlungen: [{ id: 1, bezahltBis: '2026-09-18', betrag: 8.9, eingegangenAm: '2026-09-22', notiz: '' }],
  });
  assert.equal(z.bezahlt, 8.9);
  assert.equal(z.bezahltBis, '2026-09-18');
  assert.equal(z.bezahltBisKw, 38);
  assert.deepEqual(z.abgedeckt, { von: '2026-09-04', bis: '2026-09-18', kwVon: 36, kwBis: 38, ziehungen: 3 });
  assert.deepEqual(z.offen, { von: '2026-09-25', bis: '2026-10-02', kwVon: 39, kwBis: 40, ziehungen: 2 });
  assert.equal(z.abweichung, 0, 'bezahlt entspricht genau dem berechneten Anteil (1,40 + 1,40 + 6,10)');
  assert.equal(z.offenBetrag, 7.5, '16,40 gesamt minus 8,90 bezahlt');
  assert.deepEqual(z.ziehungen.map((x) => x.bezahlt), [true, true, true, false, false]);
  assert.equal(z.zahlungen[0].kw, 38);
});

test('Zahlungen: gezahlter Betrag weicht ab, der Rest gleicht das aus', () => {
  const zeilen = zeilenFuer({ ziehungen: ziehungenFuer(FREITAGE) });
  const z = baueZahlungen({
    zeilen, spieler: ['Florian', 'Stephan'],
    zahlungen: [{ id: 1, bezahltBis: '2026-09-18', betrag: 9, eingegangenAm: '2026-09-22', notiz: 'aufgerundet' }],
  });
  assert.equal(z.abweichung, 0.1, 'zehn Cent mehr gezahlt als berechnet');
  assert.equal(z.offenBetrag, 7.4, 'der Rest wird um diese zehn Cent kleiner');
});

test('Zahlungen: mehrere Zahlungen zählen zusammen, die letzte bestimmt „bezahlt bis“', () => {
  const zeilen = zeilenFuer({ ziehungen: ziehungenFuer(FREITAGE) });
  const z = baueZahlungen({
    zeilen, spieler: ['Florian', 'Stephan'],
    zahlungen: [
      { id: 2, bezahltBis: '2026-09-25', betrag: 6.1, eingegangenAm: '2026-09-30', notiz: '' },
      { id: 1, bezahltBis: '2026-09-11', betrag: 2.8, eingegangenAm: '2026-09-15', notiz: '' },
    ],
  });
  assert.deepEqual(z.zahlungen.map((x) => x.id), [1, 2], 'nach „bezahlt bis“ sortiert');
  assert.equal(z.bezahlt, 8.9);
  assert.equal(z.bezahltBis, '2026-09-25');
  assert.equal(z.offen.ziehungen, 1);
  assert.equal(z.offenBetrag, 7.5);
});

test('Zahlungen: Guthaben, wenn die Gewinne die Kosten übersteigen', () => {
  const zeilen = zeilenFuer({ ziehungen: [ziehungEuro('2026-09-04', { quoten: { eurojackpot: { ...QUOTEN_EURO.eurojackpot, 12: 60 } } })], heute: '2026-09-05' });
  const z = baueZahlungen({ zeilen, spieler: ['Florian', 'Stephan'] });
  assert.equal(z.offenBetrag, -23.9, '(12,20 - 60) / 2 = -23,90');
});

test('Zahlungen: nur endgültige Ziehungen zählen, neuere vorläufige werden gemeldet', () => {
  const ziehungen = [...ziehungenFuer(FREITAGE.slice(0, 4)), ziehungEuro('2026-10-02', { quoten: null })];
  const zeilen = zeilenFuer({ ziehungen });
  const z = baueZahlungen({ zeilen, spieler: ['Florian', 'Stephan'] });
  assert.equal(z.stand, '2026-09-25');
  assert.equal(z.offenBetrag, 10.3, '1,40 + 1,40 + 6,10 + 1,40');
  assert.deepEqual(z.ausstehend, [{ datum: '2026-10-02', kw: 40 }]);
  assert.equal(z.ziehungen.length, 4);
});

test('Zahlungen: Ziehung ohne Daten (noch nicht gezogen) zählt nicht', () => {
  const zeilen = zeilenFuer({ ziehungen: ziehungenFuer(FREITAGE.slice(0, 2)), heute: '2026-09-18' });
  assert.equal(zeilen.at(-1).status, 'ausstehend');
  const z = baueZahlungen({ zeilen, spieler: ['Florian', 'Stephan'] });
  assert.equal(z.ziehungen.length, 2);
  assert.equal(z.stand, '2026-09-11');
});

test('Zahlungen: Korrekturbuchungen zählen zur ersten endgültigen Ziehung ab ihrem Datum', () => {
  const korrekturen = [{ datum: '2026-09-12', lotto: 10, spiel77: 0, super6: 0 }, { datum: '2026-10-05', lotto: 4, spiel77: 0, super6: 0 }];
  const zeilen = zeilenFuer({ ziehungen: ziehungenFuer(FREITAGE), korrekturen });
  const z = baueZahlungen({ zeilen, korrekturen, spieler: ['Florian', 'Stephan'] });
  // 10 € am 12.09. gehören zur Ziehung vom 18.09. (Anteil 5 €), die Buchung vom 05.10. wartet auf eine spätere Ziehung
  assert.deepEqual(z.ziehungen.map((x) => x.anteil), [1.4, 1.4, 1.1, 1.4, 6.1]);
  assert.equal(z.offenBetrag, 11.4);
});

test('Zahlungen: ohne endgültige Ziehung gibt es nichts zu zahlen', () => {
  const z = baueZahlungen({ zeilen: [], spieler: ['Florian', 'Stephan'] });
  assert.equal(z.stand, null);
  assert.equal(z.offenBetrag, 0);
  assert.equal(z.offen, null);
  assert.deepEqual(z.ziehungen, []);
});

test('Zahlungen: Datum auf Ziehung abbilden und Betrag vorschlagen', () => {
  const zeilen = zeilenFuer({ ziehungen: ziehungenFuer(FREITAGE) });
  const leer = baueZahlungen({ zeilen, spieler: ['Florian', 'Stephan'] });
  assert.equal(ziehungsdatumBis(leer, '2026-09-20'), '2026-09-18', 'zwischen zwei Ziehungen gilt die davor');
  assert.equal(ziehungsdatumBis(leer, '2026-09-18'), '2026-09-18');
  assert.equal(ziehungsdatumBis(leer, '2026-12-31'), '2026-10-02', 'nach der letzten gilt die letzte');
  assert.equal(ziehungsdatumBis(leer, '2026-09-03'), null, 'vor der ersten gibt es nichts');
  assert.equal(betragBis(leer, '2026-09-18'), 8.9);
  const teil = baueZahlungen({ zeilen, spieler: ['Florian', 'Stephan'], zahlungen: [{ id: 1, bezahltBis: '2026-09-18', betrag: 8.9, eingegangenAm: '2026-09-22', notiz: '' }] });
  assert.equal(betragBis(teil, '2026-10-02'), 7.5, 'nur die Ziehungen nach der letzten Zahlung');
});

// ---- Schnittstelle ----

async function starte({ spiel = EURO, quellen } = {}) {
  const zs = ziehungenFuer(FREITAGE);
  const store = await neuerStore({ spiel, passwort: 'euro-2026', adminPasswort: 'admin-euro-2026' });
  store.speichereEinstellungen({ spieler: ['Florian', 'Stephan'], startDatum: '2026-09-04' });
  store.legeScheinAn({ gueltigAb: '2026-09-04', felder: schein.felder, losnummer: '', kosten: 12.2, spiel77: false, super6: false });
  for (const z of zs) store.speichereZiehung(z, 0);
  const sync = erstelleSync({ store, quellen: quellen ?? stubQuellen(), spiel, jetzt: () => DI, log: stilleLogs, pause: 0 });
  const app = erstelleApp({ store, sync, spiel, jetzt: () => DI, sicheresCookie: false, publicDir: PUBLIC });
  const server = app.listen(0, '127.0.0.1');
  server.unref();
  await new Promise((r) => server.once('listening', r));
  const basis = `http://127.0.0.1:${server.address().port}`;
  const anmelden = async (passwort) => {
    let cookie = '';
    const anfrage = async (methode, pfad, body) => {
      const antwort = await fetch(basis + pfad, { method: methode, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
      const set = antwort.headers.get('set-cookie');
      if (set && set.includes('tipp_session=') && !set.includes('Max-Age=0')) cookie = set.split(';')[0];
      let json = null;
      try { json = await antwort.json(); } catch { /* leer */ }
      return { status: antwort.status, json };
    };
    assert.equal((await anfrage('POST', '/api/anmelden', { passwort })).status, 200);
    return { get: (p) => anfrage('GET', p), post: (p, b) => anfrage('POST', p, b ?? {}), del: (p) => anfrage('DELETE', p) };
  };
  return { store, anmelden, schliessen: () => new Promise((r) => server.close(r)) };
}

test('Zahlungen API: Zustand enthält die Zahlungen, bei 6aus49 gibt es sie nicht', async () => {
  const s = await starte();
  const admin = await s.anmelden('admin-euro-2026');
  const z = (await admin.get('/api/zustand')).json;
  assert.equal(z.spiel.zahlungen, true);
  assert.equal(z.zahlungen.zahler, 'Florian');
  assert.equal(z.zahlungen.ziehungen.length, 5);
  assert.equal(z.zahlungen.offenBetrag, 16.4);
  await s.schliessen();

  const lotto = await starte({ spiel: SPIELE.lotto });
  const a = await lotto.anmelden('admin-euro-2026');
  assert.equal((await a.get('/api/zustand')).json.zahlungen, null);
  assert.equal((await a.post('/api/zahlungen', { bezahltBis: '2026-09-18' })).status, 404);
  await lotto.schliessen();
});

test('Zahlungen API: nur der Admin erfasst Zahlungen, Mitglieder sehen sie', async () => {
  const s = await starte();
  const admin = await s.anmelden('admin-euro-2026');
  const mitglied = await s.anmelden('euro-2026');
  assert.equal((await mitglied.post('/api/zahlungen', { bezahltBis: '2026-09-18' })).status, 403);
  assert.equal((await mitglied.del('/api/zahlungen/1')).status, 403);
  const neu = await admin.post('/api/zahlungen', { bezahltBis: '2026-09-18', eingegangenAm: '2026-09-22', notiz: 'Überweisung' });
  assert.equal(neu.status, 200);
  const sicht = (await mitglied.get('/api/zustand')).json.zahlungen;
  assert.equal(sicht.bezahltBis, '2026-09-18');
  assert.equal(sicht.bezahlt, 8.9, 'Betrag ohne Eingabe: Anteil der Ziehungen bis dahin');
  assert.equal(sicht.offenBetrag, 7.5);
  assert.equal(sicht.zahlungen[0].notiz, 'Überweisung');
  await s.schliessen();
});

test('Zahlungen API: Datum wird auf eine Ziehung gerundet, Betrag und Eingangsdatum sind optional', async () => {
  const s = await starte();
  const admin = await s.anmelden('admin-euro-2026');
  const r = await admin.post('/api/zahlungen', { bezahltBis: '2026-09-20', betrag: 9 });
  assert.equal(r.status, 200);
  const z = r.json.zahlungen;
  assert.equal(z.bezahltBis, '2026-09-18', 'der 20.09. liegt zwischen zwei Ziehungen');
  assert.equal(z.bezahlt, 9);
  assert.equal(z.zahlungen[0].eingegangenAm, '2026-10-06', 'ohne Angabe: heute');
  assert.equal(z.abweichung, 0.1);
  await s.schliessen();
});

test('Zahlungen API: Eingaben werden geprüft', async () => {
  const s = await starte();
  const admin = await s.anmelden('admin-euro-2026');
  const fehler = async (body, muster) => {
    const r = await admin.post('/api/zahlungen', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.json.error, muster);
  };
  await fehler({}, /gültiges Datum/);
  await fehler({ bezahltBis: 'gestern' }, /gültiges Datum/);
  await fehler({ bezahltBis: '2026-09-03' }, /noch keine Ziehung/);
  await fehler({ bezahltBis: '2026-09-18', eingegangenAm: 'bald' }, /Zahlungseingang/);
  await fehler({ bezahltBis: '2026-09-18', betrag: 'viel' }, /Betrag/);
  await fehler({ bezahltBis: '2026-09-18', betrag: 1e7 }, /Betrag/);
  assert.equal((await admin.post('/api/zahlungen', { bezahltBis: '2026-09-18' })).status, 200);
  await fehler({ bezahltBis: '2026-09-18' }, /bereits bis 18\.09\.2026 bezahlt/);
  await fehler({ bezahltBis: '2026-09-12' }, /bereits bis 18\.09\.2026 bezahlt/);
  assert.equal((await admin.post('/api/zahlungen', { bezahltBis: '2026-12-31' })).json.zahlungen.bezahltBis, '2026-10-02', 'nach der letzten Ziehung gilt die letzte');
  await s.schliessen();
});

test('Zahlungen API: eine Zahlung lässt sich löschen, danach gilt wieder der frühere Stand', async () => {
  const s = await starte();
  const admin = await s.anmelden('admin-euro-2026');
  await admin.post('/api/zahlungen', { bezahltBis: '2026-09-11' });
  const zweite = await admin.post('/api/zahlungen', { bezahltBis: '2026-09-25' });
  const id = zweite.json.zahlungen.zahlungen.at(-1).id;
  assert.equal(zweite.json.zahlungen.bezahltBis, '2026-09-25');
  const nach = await admin.del(`/api/zahlungen/${id}`);
  assert.equal(nach.json.zahlungen.bezahltBis, '2026-09-11');
  assert.equal(nach.json.zahlungen.zahlungen.length, 1);
  assert.equal((await admin.del(`/api/zahlungen/${id}`)).status, 404);
  await s.schliessen();
});

test('Zahlungen API: die Zahlung steht danach in der Datenbank', async () => {
  const s = await starte();
  const admin = await s.anmelden('admin-euro-2026');
  await admin.post('/api/zahlungen', { bezahltBis: '2026-09-18', betrag: 8.9 });
  assert.deepEqual(s.store.zahlungen().map((z) => [z.bezahltBis, z.betrag]), [['2026-09-18', 8.9]]);
  await s.schliessen();
});
