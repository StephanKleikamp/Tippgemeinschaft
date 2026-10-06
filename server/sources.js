/**
 * Datenquellen für Ziehungen und Quoten. Jede Quelle liefert dasselbe Format:
 *   { date, serie, nums[6], sz, spiel77, super6, quoten | null, quelle }
 * `quoten` ist nur gesetzt, wenn die Gewinnquoten vollständig veröffentlicht sind
 * ({ lotto: {1..9}, spiel77: {1..7}, super6: {1..6} }). Sonst gilt die Ziehung als vorläufig.
 *
 *  1. lotto.de (Schnittstelle der Webseite): Zahlen und Quoten jeder Ziehung, auch rückwirkend.
 *  2. Lotto Hessen (services.lotto-hessen.de): nur die letzte Ziehung, dient zur Gegenprüfung
 *     und als Ersatz, falls lotto.de ausfällt.
 *  3. LottoNumberArchive (GitHub Pages): alle Zahlen seit 1955, aber ohne Quoten.
 */
import { FEST, SERIE, isoWeekday } from './rules.js';

const USER_AGENT = 'Tippgemeinschaft/2.0 (private Gruppen-App, ruft nur oeffentliche Gewinnzahlen ab)';
const LOTTO_DE = 'https://www.lotto.de/api/stats/entities.lotto';
const HESSEN = 'https://services.lotto-hessen.de/spielinformationen';
const ARCHIV = 'https://johannesfriedrich.github.io/LottoNumberArchive/Lottonumbers_complete.json';

const KLASSEN = { lotto: 9, spiel77: 7, super6: 6 };

// ---- Hilfen ----

export function berlinDatum(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ms));
}

const deZuIso = (de) => {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(de ?? ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const istZiffern = (wert, stellen) => typeof wert === 'string' && new RegExp(`^\\d{${stellen}}$`).test(wert);

function gueltigeZahlen(nums) {
  return Array.isArray(nums) && nums.length === 6 && nums.every((n) => Number.isInteger(n) && n >= 1 && n <= 49)
    && new Set(nums).size === 6;
}

/** Wandelt eine Liste von Klassen und Quoten in { klasse: betrag }; null, wenn nicht alle Klassen da sind. */
function quotenMap(liste, erwartet) {
  if (!Array.isArray(liste)) return null;
  const out = {};
  for (const eintrag of liste) {
    const klasse = Number(eintrag?.winningClass);
    const quote = Number(eintrag?.odds);
    if (Number.isInteger(klasse) && Number.isFinite(quote)) out[klasse] = quote;
  }
  for (let k = 1; k <= erwartet; k += 1) if (!(k in out)) return null;
  return out;
}

/**
 * Vollständig heißt: alle Klassen aller drei Spiele sind da und Klasse 9 hat einen Betrag.
 * Klasse 9 hat nach jeder Ziehung Gewinner. Ist sie leer, sind die Quoten noch nicht berechnet.
 */
function vollstaendig(quoten) {
  return Boolean(quoten.lotto && quoten.spiel77 && quoten.super6 && quoten.lotto[9] > 0);
}

// ---- lotto.de ----

export function normalisiereLottoDe(json) {
  const d = Array.isArray(json) ? json[0] : json;
  if (!d || typeof d !== 'object') return null;
  const nums = (d.drawNumbersCollection ?? []).slice().sort((a, b) => a.index - b.index).map((x) => x.drawNumber);
  const sz = d.superNumber;
  if (!gueltigeZahlen(nums) || !Number.isInteger(sz) || sz < 0 || sz > 9 || !Number.isFinite(d.drawDate)) return null;

  const name = String(d.gameType?.name ?? '');
  const serie = /samstag/i.test(name) ? 'Samstag' : /mittwoch/i.test(name) ? 'Mittwoch' : name;
  const quoten = {
    lotto: quotenMap(d.oddsCollection, KLASSEN.lotto),
    spiel77: quotenMap(d.game77?.oddsCollection, KLASSEN.spiel77),
    super6: quotenMap(d.super6?.oddsCollection, KLASSEN.super6),
  };
  const spiel77 = d.game77?.numbers;
  const super6 = d.super6?.numbers;
  return {
    date: berlinDatum(d.drawDate),
    serie,
    nums,
    sz,
    spiel77: istZiffern(spiel77, 7) ? spiel77 : null,
    super6: istZiffern(super6, 6) ? super6 : null,
    quoten: vollstaendig(quoten) ? quoten : null,
    quelle: 'lotto.de',
  };
}

// ---- Lotto Hessen ----

export function normalisiereHessen({ zahlen, quoten, super6, spiel77, spiel77Quoten }) {
  const datum = deZuIso(zahlen?.Datum);
  if (!datum || !gueltigeZahlen(zahlen?.Zahl) || !Number.isInteger(zahlen?.Superzahl)) return null;
  const gleich = (x) => deZuIso(x?.Datum) === datum;

  const nummer = (obj, stellen) => (gleich(obj) && istZiffern(String(obj.Zahl), stellen) ? String(obj.Zahl) : null);
  const klassen = (obj, anzahl) => {
    if (!gleich(obj)) return null;
    const out = {};
    for (let k = 1; k <= anzahl; k += 1) {
      const wert = Number(obj[`Gewinnklasse${k}`]);
      if (!Number.isFinite(wert)) return null;
      out[k] = wert;
    }
    return out;
  };

  // Super 6 hat bei Lotto Hessen keine Quotenseite, die Beträge sind aber fest
  const alle = { lotto: klassen(quoten, 9), spiel77: klassen(spiel77Quoten, 7), super6: { ...FEST.super6 } };
  return {
    date: datum,
    serie: /mittwoch/i.test(zahlen.Ziehung) ? 'Mittwoch' : SERIE,
    nums: zahlen.Zahl,
    sz: zahlen.Superzahl,
    spiel77: nummer(spiel77, 7),
    super6: nummer(super6, 6),
    quoten: vollstaendig(alle) ? alle : null,
    quelle: 'lotto-hessen',
  };
}

// ---- Archiv (nur Zahlen) ----

export function normalisiereArchiv(json, ab = '0000-00-00') {
  const out = [];
  for (const eintrag of json?.data ?? []) {
    const datum = deZuIso(eintrag.date);
    if (!datum || datum < ab) continue;
    if (!gueltigeZahlen(eintrag.Lottozahl) || !Number.isInteger(eintrag.Superzahl)) continue;
    const wochentag = isoWeekday(datum);
    if (wochentag !== 6 && wochentag !== 3) continue;
    out.push({
      date: datum,
      serie: wochentag === 6 ? 'Samstag' : 'Mittwoch',
      nums: eintrag.Lottozahl,
      sz: eintrag.Superzahl,
      spiel77: null,
      super6: null,
      quoten: null,
      quelle: 'archiv',
    });
  }
  return out;
}

// ---- Abruf ----

async function holeJson(url, { timeoutMs = 20000, fetchImpl = fetch } = {}) {
  const antwort = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!antwort.ok) throw new Error(`${new URL(url).host}: HTTP ${antwort.status}`);
  const text = await antwort.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${new URL(url).host}: keine gültige JSON-Antwort`);
  }
}

const mitternachtUtc = (iso) => Date.parse(`${iso}T00:00:00Z`);

/** Alle Quellen hinter einer Schnittstelle, damit Tests sie ersetzen können. */
export function erstelleQuellen({ fetchImpl = fetch } = {}) {
  const hole = (url, optionen) => holeJson(url, { ...optionen, fetchImpl });
  return {
    /** Alle Ziehungstage eines Jahres als ISO-Datum, neueste zuerst. */
    async lottoDeTage(jahr) {
      const json = await hole(`${LOTTO_DE}/history/${mitternachtUtc(`${jahr}-12-31`)}`);
      const tage = (json?.days ?? []).map((t) => t.date).filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t));
      if (!tage.length) throw new Error('lotto.de: keine Ziehungstage');
      return tage;
    },
    async lottoDeZiehung(datum) {
      const json = await hole(`${LOTTO_DE}/draws/${mitternachtUtc(datum)}`);
      const ziehung = normalisiereLottoDe(json);
      if (!ziehung) throw new Error(`lotto.de: Ziehung ${datum} unvollständig`);
      return ziehung;
    },
    async hessenLetzte() {
      const [zahlen, quoten, super6, spiel77, spiel77Quoten] = await Promise.all([
        hole(`${HESSEN}/gewinnzahlen/lotto`),
        hole(`${HESSEN}/quoten/lotto`).catch(() => null),
        hole(`${HESSEN}/gewinnzahlen/super6`).catch(() => null),
        hole(`${HESSEN}/gewinnzahlen/spiel77`).catch(() => null),
        hole(`${HESSEN}/quoten/spiel77`).catch(() => null),
      ]);
      const ziehung = normalisiereHessen({ zahlen, quoten, super6, spiel77, spiel77Quoten });
      if (!ziehung) throw new Error('lotto-hessen: Antwort unvollständig');
      return ziehung;
    },
    async archiv(ab) {
      return normalisiereArchiv(await hole(ARCHIV, { timeoutMs: 40000 }), ab);
    },
  };
}
