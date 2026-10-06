import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lottoKlasse, endziffern, spiel77Klasse, super6Klasse, betragFuer, werteZiehungAus, schaetzeQuoten,
  scheinFuer, baueAbrechnung, ersterSamstag, letzterSamstag, samstageZwischen, FEST,
} from '../server/rules.js';

// Quoten der Ziehung vom 03.10.2026 (amtlich), Klasse 1 hatte keinen Gewinner
const QUOTEN = {
  lotto: { 1: 0, 2: 302528.1, 3: 6925.8, 4: 2022.4, 5: 162.2, 6: 31.2, 7: 20.9, 8: 8.3, 9: 6 },
  spiel77: { 1: 0, 2: 77777, 3: 7777, 4: 777, 5: 77, 6: 17, 7: 5 },
  super6: { 1: 100000, 2: 6666, 3: 666, 4: 66, 5: 6, 6: 2.5 },
};
const ZIEHUNG = { date: '2026-10-03', serie: 'Samstag', nums: [33, 24, 7, 19, 5, 46], sz: 0, spiel77: '7634877', super6: '097746', quoten: QUOTEN };

const feld = (nums, sz = 0) => ({ nums, sz });
const SCHEIN = {
  id: 1,
  gueltigAb: '2026-01-03',
  kosten: 13.35,
  spiel77: true,
  super6: true,
  losnummer: '1234560',
  felder: [
    feld([1, 2, 3, 4, 5, 6]), // 5 Richtige (5), SZ stimmt: 1 Treffer + SZ, kein Gewinn
    feld([33, 46, 10, 11, 12, 13]), // 2 Richtige + SZ: Klasse 9
    feld([33, 46, 7, 10, 11, 12], 3), // 3 Richtige ohne SZ: Klasse 8
    feld([33, 46, 7, 19, 10, 11], 0), // 4 Richtige + SZ: Klasse 5
    feld([33, 46, 7, 19, 24, 10], 5), // 5 Richtige ohne SZ: Klasse 4
    feld([33, 46, 7, 19, 24, 5], 0), // 6 Richtige + SZ: Klasse 1
  ],
};

test('Gewinnklassen 6aus49', () => {
  assert.equal(lottoKlasse(6, true), 1);
  assert.equal(lottoKlasse(6, false), 2);
  assert.equal(lottoKlasse(5, true), 3);
  assert.equal(lottoKlasse(5, false), 4);
  assert.equal(lottoKlasse(4, true), 5);
  assert.equal(lottoKlasse(4, false), 6);
  assert.equal(lottoKlasse(3, true), 7);
  assert.equal(lottoKlasse(3, false), 8);
  assert.equal(lottoKlasse(2, true), 9);
  assert.equal(lottoKlasse(2, false), null);
  assert.equal(lottoKlasse(1, true), null);
  assert.equal(lottoKlasse(0, true), null);
});

test('Endziffern zählen von rechts und enden beim ersten Fehler', () => {
  assert.equal(endziffern('1234560', '7634877', 7), 0);
  assert.equal(endziffern('1234567', '9934567', 7), 5);
  assert.equal(endziffern('1234567', '1234567', 7), 7);
  // gleiche Ziffern weiter links zählen nicht, wenn rechts eine Lücke ist
  assert.equal(endziffern('1234567', '1234597', 7), 1);
  assert.equal(endziffern('118100', '097746', 6), 0);
  assert.equal(endziffern('118100', '000100', 6), 3);
  assert.equal(endziffern('', '123456', 6), 0);
});

test('Klassen für Spiel 77 und Super 6', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(spiel77Klasse), [null, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(super6Klasse), [null, 6, 5, 4, 3, 2, 1]);
});

test('Betrag: amtliche Quote vor festem Betrag, 0 gilt als unbekannt', () => {
  assert.equal(betragFuer('lotto', 8, QUOTEN), 8.3);
  assert.equal(betragFuer('lotto', 9, null), 6);
  assert.equal(betragFuer('lotto', 8, null), null);
  assert.equal(betragFuer('lotto', 1, QUOTEN), null);
  assert.equal(betragFuer('spiel77', 7, null), 5);
  assert.equal(betragFuer('super6', 6, null), 2.5);
  assert.equal(betragFuer('spiel77', 1, QUOTEN), null);
  assert.equal(FEST.super6[1], 100000);
});

test('Auswertung: jedes Feld, Treffer und Beträge', () => {
  const a = werteZiehungAus(ZIEHUNG, SCHEIN);
  const [f1, f2, f3, f4, f5, f6] = a.lotto.felder;
  assert.equal(f1.klasse, null);
  assert.equal(f1.betrag, null);
  assert.equal(f1.offen, false);
  assert.deepEqual([f2.klasse, f2.betrag], [9, 6]);
  assert.deepEqual([f3.klasse, f3.betrag], [8, 8.3]);
  assert.deepEqual([f4.klasse, f4.betrag], [5, 162.2]);
  assert.deepEqual([f5.klasse, f5.betrag], [4, 2022.4]);
  assert.deepEqual([f6.klasse], [1]);
  assert.equal(f6.offen, true, 'Klasse 1 ohne Quote bleibt offen');
  assert.equal(f6.treffer.length, 6);
  assert.equal(a.lotto.summe, 2198.9);
  assert.equal(a.offen, 1);
  // Losnummer 1234560 gegen 7634877 und 097746: letzte Ziffer 0 gegen 7 bzw. 6
  assert.equal(a.spiel77.endziffern, 0);
  assert.equal(a.super6.endziffern, 0);
});

test('Auswertung: Spiel 77 und Super 6 mit Endziffern', () => {
  const schein = { ...SCHEIN, felder: [], losnummer: '9994877' };
  const a = werteZiehungAus({ ...ZIEHUNG, super6: '094877' }, schein);
  // 7634877 gegen 9994877: 4877 passt (4 Endziffern, Klasse 4 = 777), die 3 davor nicht
  assert.deepEqual([a.spiel77.endziffern, a.spiel77.klasse, a.spiel77.betrag], [4, 4, 777]);
  // Super 6 nutzt nur die letzten 6 Stellen: 994877 gegen 094877: 5 Endziffern (die 9 davor passt auch), Klasse 2 = 6666
  assert.deepEqual([a.super6.endziffern, a.super6.klasse, a.super6.betrag], [5, 2, 6666]);
  assert.equal(a.gewinn, 777 + 6666);
  assert.equal(a.gewinnSpiel77, 777);
  assert.equal(a.gewinnSuper6, 6666);
});

test('Auswertung: Spiel 77 und Super 6 lassen sich am Schein abschalten', () => {
  const a = werteZiehungAus(ZIEHUNG, { ...SCHEIN, spiel77: false, super6: false });
  assert.equal(a.spiel77, null);
  assert.equal(a.super6, null);
});

test('Ohne Quoten zählen nur feste Beträge, variable Klassen bleiben offen', () => {
  const a = werteZiehungAus({ ...ZIEHUNG, quoten: null }, SCHEIN, { 4: 2000, 5: 150, 8: 9 });
  const [, f2, f3, f4, f5] = a.lotto.felder;
  assert.equal(f2.betrag, 6, 'Klasse 9 ist fest');
  assert.equal(f3.betrag, null);
  assert.equal(f3.offen, true);
  assert.equal(f3.geschaetzt, 9);
  assert.equal(f4.geschaetzt, 150);
  assert.equal(f5.geschaetzt, 2000);
  assert.equal(a.gewinn, 6);
  assert.equal(a.geschaetzt, 9 + 150 + 2000);
});

test('Schätzung: Median der letzten Ziehungen, Klassen 3 bis 8', () => {
  const z = (date, k8, k3) => ({ date, quoten: { lotto: { 3: k3, 8: k8 } } });
  const s = schaetzeQuoten([z('2026-09-05', 9, 7000), z('2026-09-12', 8, 9000), z('2026-09-19', 12, 8000)]);
  assert.equal(s[8], 9);
  assert.equal(s[3], 8000);
  assert.equal(s[1], undefined);
  const gerade = schaetzeQuoten([z('2026-09-05', 8, 1), z('2026-09-12', 10, 1)]);
  assert.equal(gerade[8], 9);
});

test('Datumshilfen', () => {
  assert.equal(ersterSamstag('2026-10-03'), '2026-10-03');
  assert.equal(ersterSamstag('2026-10-04'), '2026-10-10');
  assert.equal(ersterSamstag('2026-10-02'), '2026-10-03');
  assert.equal(letzterSamstag('2026-10-06'), '2026-10-03');
  assert.equal(letzterSamstag('2026-10-03'), '2026-10-03');
  assert.equal(letzterSamstag('2026-10-02'), '2026-09-26');
  assert.deepEqual(samstageZwischen('2026-09-28', '2026-10-17'), ['2026-10-03', '2026-10-10', '2026-10-17']);
});

test('Scheinversionen: der erste gilt auch für die Zeit davor', () => {
  const a = { id: 1, gueltigAb: '2026-03-07' };
  const b = { id: 2, gueltigAb: '2026-06-06' };
  assert.equal(scheinFuer([b, a], '2026-01-03').id, 1);
  assert.equal(scheinFuer([b, a], '2026-06-05').id, 1);
  assert.equal(scheinFuer([b, a], '2026-06-06').id, 2);
  assert.equal(scheinFuer([], '2026-06-06'), null);
});

test('Abrechnung: Kosten je Samstag, Gewinne aus Ziehungen, Korrekturen und Anteile', () => {
  const ziehung = (date, nums, quoten = QUOTEN) => ({ ...ZIEHUNG, date, nums, quoten });
  const ziehungen = [
    ziehung('2026-09-26', [1, 2, 30, 31, 32, 33]), // nur Feld 1: 2 Richtige, SZ 0 passt: Klasse 9 = 6 €
    ziehung('2026-10-03', [40, 41, 42, 43, 44, 45]), // nichts
    { ...ziehung('2026-09-30', [1, 2, 3, 4, 5, 6]), serie: 'Mittwoch' }, // zählt nicht
  ];
  const scheine = [{ ...SCHEIN, felder: [feld([1, 2, 3, 4, 5, 6])], losnummer: '1234560', gueltigAb: '2026-09-26' }];
  const r = baueAbrechnung({
    ziehungen, scheine, startDatum: '2026-09-26', heute: '2026-10-10',
    korrekturen: [{ lotto: 0, spiel77: 0, super6: -1 }], spieler: ['A', 'B', 'C'],
  });
  assert.deepEqual(r.zeilen.map((z) => [z.datum, z.status]), [
    ['2026-09-26', 'endgueltig'], ['2026-10-03', 'endgueltig'], ['2026-10-10', 'ausstehend'],
  ]);
  assert.equal(r.summe.wochen, 3);
  assert.equal(r.summe.kosten, 40.05);
  assert.equal(r.zeilen[0].gewinn, 6 + 0);
  assert.equal(r.summe.gewinnZiehungen, 6);
  assert.equal(r.summe.gewinn, 5);
  assert.equal(r.summe.bilanz, -35.05);
  assert.equal(r.summe.proSpieler.kosten, 13.35);
  assert.equal(r.summe.proSpieler.bilanz, -11.68);
  // Saldo läuft mit: 6 - 13,35, dann - 13,35, dann - 13,35
  assert.deepEqual(r.zeilen.map((z) => z.saldo), [-7.35, -20.7, -34.05]);
});

test('Abrechnung: ohne Ziehung in der Datenbank zählen trotzdem die Kosten', () => {
  const r = baueAbrechnung({ ziehungen: [], scheine: [SCHEIN], startDatum: '2026-09-19', heute: '2026-10-06', spieler: ['A'] });
  assert.equal(r.zeilen.length, 3);
  assert.ok(r.zeilen.every((z) => z.status === 'ausstehend'));
  assert.equal(r.summe.kosten, 40.05);
});

test('Abrechnung: vorläufige Ziehung zeigt feste Gewinne sicher und offene geschätzt', () => {
  const alt = { ...ZIEHUNG, date: '2026-09-26' };
  const neu = { ...ZIEHUNG, date: '2026-10-03', quoten: null };
  const r = baueAbrechnung({ ziehungen: [alt, neu], scheine: [SCHEIN], startDatum: '2026-09-26', heute: '2026-10-04', spieler: ['A'] });
  const zeile = r.zeilen[1];
  assert.equal(zeile.status, 'vorlaeufig');
  assert.ok(zeile.offen >= 1);
  assert.ok(zeile.geschaetzt > 0);
  assert.equal(r.summe.geschaetzt, zeile.geschaetzt);
});

test('Abrechnung: verschobene Ziehung (Freitag) zählt nicht doppelt', () => {
  const freitag = { ...ZIEHUNG, date: '2026-12-25' }; // Samstag der Woche ist der 26.
  const r = baueAbrechnung({ ziehungen: [freitag], scheine: [SCHEIN], startDatum: '2026-12-19', heute: '2026-12-27', spieler: ['A'] });
  assert.deepEqual(r.zeilen.map((z) => z.datum), ['2026-12-19', '2026-12-25']);
});

test('Abrechnung: neuer Schein ab einem Datum ändert nur spätere Kosten', () => {
  const s1 = { ...SCHEIN, id: 1, gueltigAb: '2026-09-19', kosten: 10 };
  const s2 = { ...SCHEIN, id: 2, gueltigAb: '2026-10-03', kosten: 20 };
  const r = baueAbrechnung({ ziehungen: [], scheine: [s2, s1], startDatum: '2026-09-19', heute: '2026-10-06', spieler: ['A'] });
  assert.deepEqual(r.zeilen.map((z) => z.kosten), [10, 10, 20]);
  assert.deepEqual(r.zeilen.map((z) => z.scheinId), [1, 1, 2]);
});
