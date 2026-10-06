import test from 'node:test';
import assert from 'node:assert/strict';
import { erstelleSync, erwarteteZiehung, naechsterSpieltag, berlinMinuten } from '../server/sync.js';
import { sichere } from '../server/backup.js';
import { neuerStore, stubQuellen, ziehung, stilleLogs, QUOTEN } from './helpers.js';
import { mkdtempSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { oeffneDatenbank, erstelleStore } from '../server/db.js';

const DI = Date.parse('2026-10-06T10:00:00Z'); // Dienstag, 12:00 Uhr in Berlin
const SA_ABEND = Date.parse('2026-10-10T18:30:00Z'); // Samstag 20:30 Berlin
const SA_FRUEH = Date.parse('2026-10-10T08:00:00Z'); // Samstag 10:00 Berlin

const syncMit = async (quellen, jetzt = () => DI) => {
  const store = await neuerStore();
  store.speichereEinstellungen({ spieler: ['A', 'B'], startDatum: '2026-09-19' });
  return { store, sync: erstelleSync({ store, quellen, jetzt, log: stilleLogs, pause: 0 }) };
};

test('Zeitplan: erwartete Ziehung und nächster Spieltag', () => {
  assert.equal(erwarteteZiehung(DI), '2026-10-03');
  assert.equal(erwarteteZiehung(SA_FRUEH), '2026-10-03', 'Samstagvormittag: noch die Ziehung davor');
  assert.equal(erwarteteZiehung(SA_ABEND), '2026-10-10');
  assert.equal(naechsterSpieltag(DI), '2026-10-10');
  assert.equal(naechsterSpieltag(SA_FRUEH), '2026-10-10');
  assert.equal(naechsterSpieltag(SA_ABEND), '2026-10-17');
  assert.equal(berlinMinuten(Date.parse('2026-10-06T10:00:00Z')), 12 * 60);
  assert.equal(berlinMinuten(Date.parse('2026-01-06T23:30:00Z')), 0 * 60 + 30, 'Winterzeit: 23:30 UTC ist 00:30 Berlin');
});

test('Lauf: holt alle Samstage seit Start, Mittwoch bleibt außen vor, Gegenprüfung setzt den Haken', async () => {
  const zs = [ziehung('2026-09-19'), ziehung('2026-09-26'), ziehung('2026-10-03'), ziehung('2026-09-30', { serie: 'Mittwoch' })];
  const quellen = stubQuellen({ ziehungen: zs, hessen: ziehung('2026-10-03', { quelle: 'lotto-hessen' }) });
  const { store, sync } = await syncMit(quellen);
  const r = await sync.starte();
  assert.equal(r.ok, true);
  assert.deepEqual(quellen.aufrufe.ziehungen.sort(), ['2026-09-19', '2026-09-26', '2026-10-03']);
  const gespeichert = store.ziehungen();
  assert.equal(gespeichert.length, 3);
  assert.equal(gespeichert.find((z) => z.date === '2026-10-03').geprueft, 'lotto-hessen');
  assert.equal(gespeichert.find((z) => z.date === '2026-09-26').geprueft, null);
  assert.equal(store.meta('sync_fehler'), '');
  assert.ok(Number(store.meta('sync_erfolg')) > 0);
});

test('Lauf: endgültige Ziehungen werden nie wieder geholt', async () => {
  const quellen = stubQuellen({ ziehungen: [ziehung('2026-09-26'), ziehung('2026-10-03')], hessen: ziehung('2026-10-03') });
  const { sync } = await syncMit(quellen);
  await sync.starte();
  const erste = quellen.aufrufe.ziehungen.length;
  await sync.starte();
  assert.equal(quellen.aufrufe.ziehungen.length, erste);
});

test('Lauf: vorläufige Ziehung wird später mit Quoten ergänzt, aber nicht innerhalb von 10 Minuten neu gefragt', async () => {
  const ohne = ziehung('2026-10-03', { quoten: null });
  const quellen = stubQuellen({ ziehungen: [ohne] });
  let jetzt = DI;
  const { store, sync } = await syncMit(quellen, () => jetzt);
  await sync.starte();
  assert.equal(store.ziehung('2026-10-03').quoten, null);
  assert.equal(quellen.aufrufe.ziehungen.length, 1);
  await sync.starte();
  assert.equal(quellen.aufrufe.ziehungen.length, 1, 'zu früh für eine erneute Abfrage');

  quellen.aufrufe.ziehungen.length = 0;
  jetzt += 11 * 60 * 1000;
  // Quoten sind jetzt da
  const mit = stubQuellen({ ziehungen: [ziehung('2026-10-03')] });
  const sync2 = erstelleSync({ store, quellen: mit, jetzt: () => jetzt, log: stilleLogs, pause: 0 });
  await sync2.starte();
  assert.deepEqual(store.ziehung('2026-10-03').quoten, QUOTEN);
});

test('Gegenprüfung: Lotto Hessen liefert fehlende Quoten nach', async () => {
  const quellen = stubQuellen({
    ziehungen: [ziehung('2026-10-03', { quoten: null })],
    hessen: ziehung('2026-10-03', { quelle: 'lotto-hessen' }),
  });
  const { store, sync } = await syncMit(quellen);
  await sync.starte();
  const z = store.ziehung('2026-10-03');
  assert.deepEqual(z.quoten, QUOTEN);
  assert.equal(z.quelle, 'lotto-hessen');
  assert.equal(z.geprueft, 'lotto-hessen');
});

test('Gegenprüfung: abweichende Zahlen werden markiert und die Quoten nicht vermischt', async () => {
  const quellen = stubQuellen({
    ziehungen: [ziehung('2026-10-03')],
    hessen: ziehung('2026-10-03', { nums: [1, 2, 3, 4, 5, 6], quelle: 'lotto-hessen' }),
  });
  const { store, sync } = await syncMit(quellen);
  await sync.starte();
  const z = store.ziehung('2026-10-03');
  assert.equal(z.geprueft, 'abweichung');
  assert.deepEqual(z.nums, [33, 24, 7, 19, 5, 46], 'lotto.de bleibt maßgeblich');
  assert.match(store.meta('sync_fehler'), /weichen/);
});

test('Ausfall von lotto.de: Lotto Hessen für die letzte Ziehung, Archiv für ältere (vorläufig)', async () => {
  const quellen = stubQuellen({
    lottoDeAus: true,
    hessen: ziehung('2026-10-03', { quelle: 'lotto-hessen' }),
    archiv: [
      ziehung('2026-09-19', { quelle: 'archiv', quoten: null, spiel77: null, super6: null }),
      ziehung('2026-09-26', { quelle: 'archiv', quoten: null, spiel77: null, super6: null }),
      ziehung('2026-10-03', { quelle: 'archiv', quoten: null, spiel77: null, super6: null }),
      ziehung('2026-09-30', { quelle: 'archiv', quoten: null, serie: 'Mittwoch', spiel77: null, super6: null }),
    ],
  });
  const { store, sync } = await syncMit(quellen);
  const r = await sync.starte();
  assert.equal(r.ok, false, 'der Lauf gilt nicht als Erfolg');
  assert.equal(store.ziehungen().length, 3);
  assert.equal(store.ziehung('2026-10-03').quelle, 'lotto-hessen', 'Hessen geht vor Archiv');
  assert.deepEqual(store.ziehung('2026-10-03').quoten, QUOTEN);
  assert.equal(store.ziehung('2026-09-26').quelle, 'archiv');
  assert.equal(store.ziehung('2026-09-26').quoten, null);
  assert.equal(store.ziehung('2026-09-26').spiel77, null);
  assert.match(store.meta('sync_fehler'), /503/);
  assert.equal(store.meta('sync_erfolg'), null);
});

test('Ausfall aller Quellen: kein Absturz, Fehler wird gemerkt', async () => {
  const quellen = stubQuellen({ lottoDeAus: true, hessenAus: true });
  quellen.archiv = async () => { throw new Error('archiv: HTTP 500'); };
  const { store, sync } = await syncMit(quellen);
  const r = await sync.starte();
  assert.equal(r.ok, false);
  assert.equal(store.ziehungen().length, 0);
  assert.match(store.meta('sync_fehler'), /archiv/);
});

test('Ein späterer lotto.de-Lauf ersetzt Archivdaten durch vollständige', async () => {
  const store = await neuerStore();
  store.speichereEinstellungen({ spieler: ['A', 'B'], startDatum: '2026-09-19' });
  store.speichereZiehung(ziehung('2026-09-26', { quelle: 'archiv', quoten: null, spiel77: null, super6: null }), 0);
  const sync = erstelleSync({ store, quellen: stubQuellen({ ziehungen: [ziehung('2026-09-26')] }), jetzt: () => DI, log: stilleLogs, pause: 0 });
  await sync.starte();
  const z = store.ziehung('2026-09-26');
  assert.equal(z.quelle, 'lotto.de');
  assert.equal(z.spiel77, '7634877');
  assert.ok(z.quoten);
});

test('Zeitplan: nach dem Ziehungsabend alle 15 Minuten, sonst einmal am Tag', async () => {
  let jetzt = SA_ABEND;
  const quellen = stubQuellen({ ziehungen: [ziehung('2026-10-03', { quoten: null })] });
  const { store, sync } = await syncMit(quellen, () => jetzt);
  store.speichereEinstellungen({ spieler: ['A', 'B'], startDatum: '2026-09-26' });
  assert.equal(sync.sollLaufen(), true, 'noch nie gelaufen');
  await sync.starte();
  assert.equal(sync.sollLaufen(), false, 'gerade gelaufen');
  jetzt += 16 * 60 * 1000;
  assert.equal(sync.sollLaufen(), true, 'Ziehung des Abends fehlt noch, nach 15 Minuten wieder fragen');

  // alles da und gegengeprüft: erst nach 24 Stunden wieder
  const fertig = stubQuellen({ ziehungen: [ziehung('2026-10-03'), ziehung('2026-10-10')], hessen: ziehung('2026-10-10') });
  const sync2 = erstelleSync({ store, quellen: fertig, jetzt: () => jetzt, log: stilleLogs, pause: 0 });
  await sync2.starte();
  assert.equal(sync2.sollLaufen(), false);
  jetzt += 2 * 3600 * 1000;
  assert.equal(sync2.sollLaufen(), false);
  jetzt += 23 * 3600 * 1000;
  assert.equal(sync2.sollLaufen(), true, 'nach 24 Stunden zur Sicherheit');
});

test('Zwei gleichzeitige Läufe werden zu einem', async () => {
  const quellen = stubQuellen({ ziehungen: [ziehung('2026-10-03')] });
  const { sync } = await syncMit(quellen);
  const a = sync.starte();
  const b = sync.starte();
  assert.equal(a, b);
  await a;
  assert.equal(quellen.aufrufe.tage, 1);
});

test('Sicherung: eine Datei je Tag, die letzten 7 bleiben, Inhalt lässt sich lesen', async () => {
  const ordner = mkdtempSync(path.join(tmpdir(), 'tipp-backup-'));
  const quelle = path.join(ordner, 'tipp.db');
  const db = oeffneDatenbank(quelle);
  const store = erstelleStore(db);
  store.speichereEinstellungen({ spieler: ['Anna', 'Bernd'], startDatum: '2026-02-07' });
  for (let tag = 1; tag <= 9; tag += 1) sichere(db, path.join(ordner, 'backups'), `2026-10-0${tag}`);
  const dateien = readdirSync(path.join(ordner, 'backups')).sort();
  assert.equal(dateien.length, 7);
  assert.equal(dateien[0], 'tipp-2026-10-03.db');
  assert.equal(sichere(db, path.join(ordner, 'backups'), '2026-10-09').neu, false);
  const kopie = erstelleStore(oeffneDatenbank(path.join(ordner, 'backups', dateien[6])));
  assert.deepEqual(kopie.einstellungen().spieler, ['Anna', 'Bernd']);
  assert.equal(existsSync(quelle), true);
  writeFileSync(path.join(ordner, 'backups', 'fremd.txt'), 'bleibt');
  sichere(db, path.join(ordner, 'backups'), '2026-10-10');
  assert.ok(readdirSync(path.join(ordner, 'backups')).includes('fremd.txt'), 'fremde Dateien werden nicht gelöscht');
});
