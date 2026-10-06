import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalisiereLottoDe, normalisiereHessen, normalisiereArchiv, berlinDatum, erstelleQuellen } from '../server/sources.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('lotto.de: echte Ziehung vom 03.10.2026', () => {
  const z = normalisiereLottoDe(fixture('lottode-2026-10-03.json'));
  assert.equal(z.date, '2026-10-03');
  assert.equal(z.serie, 'Samstag');
  assert.deepEqual(z.nums, [33, 24, 7, 19, 5, 46]);
  assert.equal(z.sz, 0);
  assert.equal(z.spiel77, '7634877');
  assert.equal(z.super6, '097746');
  assert.equal(z.quelle, 'lotto.de');
  assert.equal(z.quoten.lotto[8], 8.3);
  assert.equal(z.quoten.lotto[9], 6);
  assert.equal(z.quoten.lotto[1], 0);
  assert.equal(z.quoten.spiel77[7], 5);
  assert.equal(z.quoten.super6[6], 2.5);
});

test('lotto.de: ohne Quoten ist die Ziehung vorläufig, Zahlen bleiben erhalten', () => {
  const z = normalisiereLottoDe(fixture('lottode-unfertig.json'));
  assert.equal(z.quoten, null);
  assert.deepEqual(z.nums, [33, 24, 7, 19, 5, 46]);
  assert.equal(z.spiel77, '7634877');
});

test('lotto.de: Klasse 9 ohne Betrag heißt noch nicht berechnet', () => {
  const json = fixture('lottode-2026-10-03.json');
  json[0].oddsCollection.find((o) => o.winningClass === 9).odds = 0;
  assert.equal(normalisiereLottoDe(json).quoten, null);
});

test('lotto.de: unvollständige oder kaputte Antworten werden abgelehnt', () => {
  assert.equal(normalisiereLottoDe(null), null);
  assert.equal(normalisiereLottoDe([]), null);
  const keineSz = fixture('lottode-2026-10-03.json');
  keineSz[0].superNumber = null;
  assert.equal(normalisiereLottoDe(keineSz), null);
  const doppelt = fixture('lottode-2026-10-03.json');
  doppelt[0].drawNumbersCollection[1].drawNumber = doppelt[0].drawNumbersCollection[0].drawNumber;
  assert.equal(normalisiereLottoDe(doppelt), null);
  const schlecht = fixture('lottode-2026-10-03.json');
  schlecht[0].game77.numbers = '12';
  assert.equal(normalisiereLottoDe(schlecht).spiel77, null);
});

test('lotto.de: Mittwochsziehung wird erkannt', () => {
  const json = fixture('lottode-2026-10-03.json');
  json[0].gameType.name = 'LOTTO 6aus49 Mittwoch';
  assert.equal(normalisiereLottoDe(json).serie, 'Mittwoch');
});

test('Datum: Mitternacht Berlin ist der Ziehungstag, nicht der Vortag in UTC', () => {
  assert.equal(berlinDatum(1790978400000), '2026-10-03'); // 02.10. 22:00 UTC
  assert.equal(berlinDatum(1767398400000), '2026-01-03');
});

test('Lotto Hessen: gleiche Ziehung, gleiche Zahlen und Quoten', () => {
  const z = normalisiereHessen({
    zahlen: fixture('hessen-zahlen.json'),
    quoten: fixture('hessen-quoten.json'),
    super6: fixture('hessen-super6.json'),
    spiel77: fixture('hessen-spiel77.json'),
    spiel77Quoten: fixture('hessen-spiel77-quoten.json'),
  });
  const l = normalisiereLottoDe(fixture('lottode-2026-10-03.json'));
  assert.equal(z.date, l.date);
  assert.deepEqual(z.nums, l.nums);
  assert.equal(z.sz, l.sz);
  assert.equal(z.spiel77, l.spiel77);
  assert.equal(z.super6, l.super6);
  assert.deepEqual(z.quoten, l.quoten);
  assert.equal(z.quelle, 'lotto-hessen');
});

test('Lotto Hessen: Quoten einer anderen Ziehung werden nicht übernommen', () => {
  const alteQuoten = { ...fixture('hessen-quoten.json'), Datum: '26.09.2026' };
  const z = normalisiereHessen({
    zahlen: fixture('hessen-zahlen.json'),
    quoten: alteQuoten,
    super6: fixture('hessen-super6.json'),
    spiel77: fixture('hessen-spiel77.json'),
    spiel77Quoten: fixture('hessen-spiel77-quoten.json'),
  });
  assert.equal(z.quoten, null);
  assert.equal(z.spiel77, '7634877');
});

test('Lotto Hessen: Super 6 einer anderen Ziehung bleibt leer', () => {
  const z = normalisiereHessen({
    zahlen: fixture('hessen-zahlen.json'),
    super6: { Datum: '26.09.2026', Ziehung: 'Samstag', Zahl: '111111' },
  });
  assert.equal(z.super6, null);
});

test('Archiv: nur Mittwoch und Samstag ab dem Startdatum', () => {
  const alle = normalisiereArchiv(fixture('archiv-auszug.json'));
  assert.ok(alle.length >= 1);
  assert.ok(alle.every((z) => z.quoten === null && z.quelle === 'archiv'));
  const letzte = alle.find((z) => z.date === '2026-10-03');
  assert.deepEqual(letzte.nums, [5, 7, 19, 24, 33, 46]);
  assert.equal(letzte.serie, 'Samstag');
  assert.equal(normalisiereArchiv(fixture('archiv-auszug.json'), '2026-10-01').every((z) => z.date >= '2026-10-01'), true);
});

test('Abruf: HTTP-Fehler und kaputtes JSON werden als Fehler gemeldet', async () => {
  const antwort = (status, body) => async () => new Response(body, { status });
  await assert.rejects(erstelleQuellen({ fetchImpl: antwort(503, 'x') }).lottoDeZiehung('2026-10-03'), /HTTP 503/);
  await assert.rejects(erstelleQuellen({ fetchImpl: antwort(200, '<html>') }).lottoDeZiehung('2026-10-03'), /keine gültige JSON/);
  await assert.rejects(erstelleQuellen({ fetchImpl: antwort(200, '[]') }).lottoDeZiehung('2026-10-03'), /unvollständig/);
});

test('Abruf: Ziehungstage und Ziehung nutzen den Zeitstempel der UTC-Mitternacht', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return new Response(JSON.stringify(url.includes('/history/') ? { days: [{ date: '2026-10-03' }, { date: 'kaputt' }] } : fixture('lottode-2026-10-03.json')));
  };
  const quellen = erstelleQuellen({ fetchImpl });
  assert.deepEqual(await quellen.lottoDeTage(2026), ['2026-10-03']);
  assert.equal((await quellen.lottoDeZiehung('2026-10-03')).date, '2026-10-03');
  assert.ok(urls[0].endsWith(`/history/${Date.parse('2026-12-31T00:00:00Z')}`));
  assert.ok(urls[1].endsWith(`/draws/${Date.parse('2026-10-03T00:00:00Z')}`));
});
