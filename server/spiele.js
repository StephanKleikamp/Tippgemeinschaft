/**
 * Die unterstützten Spiele. Eine Instanz der App rechnet genau ein Spiel (Umgebungsvariable SPIEL, Standard `lotto`),
 * jede Instanz hat ihre eigene Datenbank, eigene Passwörter und Adresse.
 *
 * Gemeinsame Begriffe in Code und Datenbank:
 *  - In `quoten` einer Ziehung heißt der Schlüssel des Hauptspiels wie die Spiel-ID (`lotto`, `eurojackpot`), Spiel 77 und
 *    Super 6 gibt es nur bei 6aus49. Das Ergebnis der Auswertung nennt das Hauptspiel immer `lotto`.
 *  - Ein Spielfeld ist `{ nums, sz }` (6aus49) beziehungsweise `{ nums, euro }` (Eurojackpot).
 */

const MIN = 60;

export const SPIELE = {
  lotto: {
    id: 'lotto',
    name: '6aus49',
    symbol: '🍀',
    titel: 'Tippgemeinschaft',
    seitentitel: 'Tippgemeinschaft',
    untertitel: 'Lotto 6aus49 · Spiel 77 · Super 6',
    serie: 'Samstag',
    wochentag: 6,
    ignorierteTage: [3], // Mittwochsziehungen werden nicht geholt
    ergebnisAb: 19 * MIN + 45, // ab dann sind Zahlen zu erwarten, der Abruf beginnt
    ziehungUm: 19 * MIN,
    feld: { zahlen: 6, max: 49, extra: { art: 'sz', anzahl: 1, min: 0, max: 9 } },
    felder: 8,
    zusatz: true,
    zahlungen: false,
    spalten: [{ schluessel: 'lotto', label: '6aus49' }, { schluessel: 'spiel77', label: 'Spiel 77' }, { schluessel: 'super6', label: 'Super 6' }],
    kosten: 13.35,
    startDatum: '2026-01-03',
    spieler: ['Spieler 1', 'Spieler 2', 'Spieler 3'],
    klassen: 9,
    schaetzung: { von: 3, bis: 8 },
    lottoDe: { entitaet: 'entities.lotto', ziehung: 'draws' },
    hessen: 'lotto',
  },
  eurojackpot: {
    id: 'eurojackpot',
    name: 'Eurojackpot',
    symbol: '⭐',
    titel: 'Eurojackpot',
    seitentitel: 'Eurojackpot Tippgemeinschaft',
    untertitel: 'Tippgemeinschaft · 5 aus 50 + 2 aus 12',
    serie: 'Freitag',
    wochentag: 5,
    ignorierteTage: [2], // Dienstagsziehungen werden nicht geholt
    ergebnisAb: 20 * MIN + 15,
    ziehungUm: 20 * MIN,
    feld: { zahlen: 5, max: 50, extra: { art: 'euro', anzahl: 2, min: 1, max: 12 } },
    felder: 12,
    zusatz: false,
    zahlungen: true, // der erste Mitspieler zahlt seinen Anteil in Abständen, der Admin dokumentiert das
    spalten: [{ schluessel: 'lotto', label: 'Eurojackpot' }],
    kosten: 12.2,
    startDatum: '2026-01-02',
    spieler: ['Spieler 1', 'Spieler 2'],
    klassen: 12,
    schaetzung: { von: 4, bis: 12 },
    lottoDe: { entitaet: 'entities.eurojackpot', ziehung: 'draw' },
    hessen: 'eurojackpot',
  },
};

export function waehleSpiel(id = 'lotto') {
  const spiel = SPIELE[id];
  if (!spiel) throw new Error(`Unbekanntes Spiel „${id}“. Erlaubt: ${Object.keys(SPIELE).join(', ')}`);
  return spiel;
}

/** Was der Browser über das Spiel wissen muss (keine Quellen, keine Zeitplan-Einzelheiten). */
export function oeffentlich(spiel) {
  const { id, name, symbol, titel, seitentitel, untertitel, serie, feld, felder, zusatz, zahlungen, spalten, kosten } = spiel;
  return { id, name, symbol, titel, seitentitel, untertitel, serie, feld, felder, zusatz, zahlungen, spalten, kosten };
}

/** Leeres Spielfeld, wie es die Datenbank für nicht ausgefüllte Zeilen liefert. */
export const leeresFeld = (spiel) => (spiel.feld.extra.art === 'euro' ? { nums: [], euro: [] } : { nums: [], sz: null });
