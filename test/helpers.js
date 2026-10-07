import { oeffneDatenbank, erstelleStore, hashPassword } from '../server/db.js';
import { SPIELE } from '../server/spiele.js';

export const QUOTEN = {
  lotto: { 1: 0, 2: 302528.1, 3: 6925.8, 4: 2022.4, 5: 162.2, 6: 31.2, 7: 20.9, 8: 8.3, 9: 6 },
  spiel77: { 1: 0, 2: 77777, 3: 7777, 4: 777, 5: 77, 6: 17, 7: 5 },
  super6: { 1: 100000, 2: 6666, 3: 666, 4: 66, 5: 6, 6: 2.5 },
};

export const QUOTEN_EURO = {
  eurojackpot: { 1: 0, 2: 562247.6, 3: 190248.9, 4: 6153.1, 5: 307.1, 6: 176.2, 7: 115.5, 8: 28.1, 9: 18.3, 10: 15.7, 11: 14.8, 12: 9.4 },
};

/** Eine Eurojackpot-Ziehung im Format der Quellen (Freitag, 02.10.2026). */
export const ziehungEuro = (date, extra = {}) => ({
  date, serie: 'Freitag', nums: [4, 6, 7, 17, 45], euro: [7, 12], sz: null, spiel77: null, super6: null,
  quoten: QUOTEN_EURO, quelle: 'lotto.de', ...extra,
});

/** Eine Ziehung im Format der Quellen. */
export const ziehung = (date, extra = {}) => ({
  date, serie: 'Samstag', nums: [33, 24, 7, 19, 5, 46], sz: 0, spiel77: '7634877', super6: '097746',
  quoten: QUOTEN, quelle: 'lotto.de', ...extra,
});

/** Quellen mit festen Antworten; zählt die Aufrufe. */
export function stubQuellen({ ziehungen = [], hessen = null, archiv = [], lottoDeAus = false, hessenAus = false } = {}) {
  const aufrufe = { tage: 0, ziehungen: [], hessen: 0, archiv: 0 };
  return {
    aufrufe,
    /** Ersetzt die Antworten von lotto.de, etwa wenn die Quoten später erscheinen. */
    setzeZiehungen(neue) { ziehungen = neue; },
    async lottoDeTage() {
      aufrufe.tage += 1;
      if (lottoDeAus) throw new Error('lotto.de: HTTP 503');
      return ziehungen.map((z) => z.date).sort().reverse();
    },
    async lottoDeZiehung(datum) {
      aufrufe.ziehungen.push(datum);
      if (lottoDeAus) throw new Error('lotto.de: HTTP 503');
      const z = ziehungen.find((x) => x.date === datum);
      if (!z) throw new Error('lotto.de: Ziehung unvollständig');
      return structuredClone(z);
    },
    async hessenLetzte() {
      aufrufe.hessen += 1;
      if (hessenAus || !hessen) throw new Error('lotto-hessen: HTTP 503');
      return structuredClone(hessen);
    },
    async archiv() {
      aufrufe.archiv += 1;
      return structuredClone(archiv);
    },
  };
}

export async function neuerStore({ passwort = 'geheim-1234', adminPasswort = 'admin-test-5678', spiel = SPIELE.lotto } = {}) {
  const store = erstelleStore(oeffneDatenbank(':memory:', spiel), spiel);
  store.setzePasswortHash(await hashPassword(passwort));
  store.setzeAdminHash(await hashPassword(adminPasswort));
  return store;
}

export const stilleLogs = { log() {}, warn() {}, error() {} };

/** Beispielschein; die Zahlen sind frei gewählt, nicht die der echten Tippgemeinschaft. */
export const SCHEIN_BODY = {
  gueltigAb: '2026-01-03',
  felder: [
    { nums: [1, 2, 3, 4, 5, 6], sz: 0 },
    { nums: [11, 27, 30, 33, 41, 46], sz: 0 },
  ],
  losnummer: '1234560',
  kosten: 13.35,
  spiel77: true,
  super6: true,
};

/** Beispielschein für Eurojackpot; die Zahlen sind frei gewählt, nicht die der echten Tippgemeinschaft. */
export const SCHEIN_BODY_EURO = {
  gueltigAb: '2026-01-02',
  felder: [
    { nums: [1, 2, 3, 4, 5], euro: [1, 2] },
    { nums: [10, 20, 30, 40, 50], euro: [11, 12] },
  ],
  losnummer: '',
  kosten: 12.2,
  spiel77: false,
  super6: false,
};
