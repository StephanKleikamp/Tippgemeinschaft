/**
 * Gewinnregeln und Abrechnung für Lotto 6aus49, Spiel 77 und Super 6.
 * Reine Funktionen ohne Datenbank und Netz, damit sich alles einzeln testen lässt.
 *
 * Grundidee: Gespeichert werden nur Tatsachen (Tippschein, amtliche Ziehungen mit Quoten).
 * Gewinne, Kosten und Bilanz werden daraus jedes Mal neu berechnet und sind dadurch
 * jederzeit nachvollziehbar und nach einer Korrektur am Schein automatisch richtig.
 */

export const SERIE = 'Samstag';

export const LOTTO_KLASSEN = {
  1: { treffer: 6, sz: true, label: '6 Richtige + Superzahl' },
  2: { treffer: 6, sz: false, label: '6 Richtige' },
  3: { treffer: 5, sz: true, label: '5 Richtige + Superzahl' },
  4: { treffer: 5, sz: false, label: '5 Richtige' },
  5: { treffer: 4, sz: true, label: '4 Richtige + Superzahl' },
  6: { treffer: 4, sz: false, label: '4 Richtige' },
  7: { treffer: 3, sz: true, label: '3 Richtige + Superzahl' },
  8: { treffer: 3, sz: false, label: '3 Richtige' },
  9: { treffer: 2, sz: true, label: '2 Richtige + Superzahl' },
};

/**
 * Feste Beträge, falls die Quote einer Ziehung fehlt. Bei Super 6 und Spiel 77 sind alle Klassen
 * außer dem Jackpot (Spiel 77, Klasse 1) fest, bei 6aus49 nur Klasse 9. Eine Quote aus den
 * amtlichen Daten hat immer Vorrang.
 */
export const FEST = {
  lotto: { 9: 6 },
  spiel77: { 2: 77777, 3: 7777, 4: 777, 5: 77, 6: 17, 7: 5 },
  super6: { 1: 100000, 2: 6666, 3: 666, 4: 66, 5: 6, 6: 2.5 },
};

export const SPIEL77_STELLEN = 7;
export const SUPER6_STELLEN = 6;

const round2 = (n) => Math.round(n * 100) / 100;

/** Gewinnklasse bei 6aus49, null wenn es keinen Gewinn gibt. */
export function lottoKlasse(treffer, szTreffer) {
  for (const [klasse, k] of Object.entries(LOTTO_KLASSEN)) {
    if (k.treffer === treffer && k.sz === szTreffer) return Number(klasse);
  }
  return null;
}

/** Anzahl der richtigen Endziffern: zusammenhängend von rechts, beim ersten Fehler ist Schluss. */
export function endziffern(schein, gewinnzahl, stellen) {
  const a = String(schein ?? '').slice(-stellen);
  const b = String(gewinnzahl ?? '').slice(-stellen);
  if (a.length !== stellen || b.length !== stellen) return 0;
  let n = 0;
  while (n < stellen && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return n;
}

/** Spiel 77: 7 Endziffern sind Klasse 1, 1 Endziffer ist Klasse 7. */
export const spiel77Klasse = (n) => (n >= 1 && n <= 7 ? 8 - n : null);
/** Super 6: 6 Endziffern sind Klasse 1, 1 Endziffer ist Klasse 6. */
export const super6Klasse = (n) => (n >= 1 && n <= 6 ? 7 - n : null);

/** Betrag einer Klasse: amtliche Quote, sonst fester Betrag, sonst null (noch offen). */
export function betragFuer(spiel, klasse, quoten) {
  const quote = Number(quoten?.[spiel]?.[klasse]);
  if (quote > 0) return quote;
  return FEST[spiel]?.[klasse] ?? null;
}

// ---- Tagesrechnung ----

export function isoWeekday(iso) {
  return new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = Sonntag, 6 = Samstag
}

export function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Erster Samstag am oder nach dem Datum. */
export function ersterSamstag(iso) {
  return addDays(iso, (6 - isoWeekday(iso) + 7) % 7);
}

/** Letzter Samstag am oder vor dem Datum. */
export function letzterSamstag(iso) {
  return addDays(iso, -((isoWeekday(iso) + 1) % 7));
}

export function samstageZwischen(von, bis) {
  const out = [];
  for (let d = ersterSamstag(von); d <= bis; d = addDays(d, 7)) out.push(d);
  return out;
}

export const FELD_BUCHSTABEN = 'ABCDEFGH';

/**
 * Wertet eine Ziehung gegen einen Schein aus.
 * `schaetzung` ist optional ({ 3: 7000, 8: 9 } für 6aus49) und füllt nur offene Beträge zur Anzeige.
 */
export function werteZiehungAus(ziehung, schein, schaetzung = {}) {
  const gezogen = new Set(ziehung.nums);
  const felder = [];
  schein.felder.forEach((feld, index) => {
    if (!feld?.nums?.length) return;
    const treffer = feld.nums.filter((n) => gezogen.has(n));
    const szTreffer = feld.sz === ziehung.sz;
    const klasse = lottoKlasse(treffer.length, szTreffer);
    const betrag = klasse ? betragFuer('lotto', klasse, ziehung.quoten) : null;
    felder.push({
      index,
      label: FELD_BUCHSTABEN[index] ?? String(index + 1),
      nums: feld.nums,
      sz: feld.sz,
      treffer,
      szTreffer,
      klasse,
      klasseLabel: klasse ? LOTTO_KLASSEN[klasse].label : null,
      betrag,
      offen: Boolean(klasse) && betrag === null,
      geschaetzt: klasse && betrag === null ? (schaetzung[klasse] ?? null) : null,
    });
  });

  const zusatz = (aktiv, spiel, stellen, klasseVon, gewinnzahl) => {
    if (!aktiv || !schein.losnummer) return null;
    const losnummer = String(schein.losnummer).slice(-stellen);
    const anzahl = endziffern(losnummer, gewinnzahl, stellen);
    const klasse = klasseVon(anzahl);
    const betrag = klasse ? betragFuer(spiel, klasse, ziehung.quoten) : null;
    return {
      losnummer,
      gewinnzahl: gewinnzahl ?? null,
      endziffern: anzahl,
      klasse,
      betrag,
      offen: Boolean(klasse) && betrag === null,
    };
  };

  const spiel77 = zusatz(schein.spiel77, 'spiel77', SPIEL77_STELLEN, spiel77Klasse, ziehung.spiel77);
  const super6 = zusatz(schein.super6, 'super6', SUPER6_STELLEN, super6Klasse, ziehung.super6);

  const alle = [...felder, spiel77, super6].filter(Boolean);
  const summe = (list) => round2(list.reduce((s, x) => s + (x.betrag ?? 0), 0));
  return {
    lotto: { felder, summe: summe(felder) },
    spiel77,
    super6,
    gewinn: summe(alle),
    gewinnLotto: summe(felder),
    gewinnSpiel77: spiel77?.betrag ?? 0,
    gewinnSuper6: super6?.betrag ?? 0,
    offen: alle.filter((x) => x.offen).length,
    geschaetzt: round2(felder.reduce((s, f) => s + (f.geschaetzt ?? 0), 0)),
  };
}

/** Schätzung für noch nicht veröffentlichte Quoten: Median der letzten Ziehungen, nur Klassen 3 bis 8. */
export function schaetzeQuoten(endgueltigeZiehungen, anzahl = 8) {
  const letzte = endgueltigeZiehungen
    .filter((z) => z.quoten?.lotto)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, anzahl);
  const out = {};
  for (let klasse = 3; klasse <= 8; klasse += 1) {
    const werte = letzte.map((z) => Number(z.quoten.lotto[klasse])).filter((v) => v > 0).sort((a, b) => a - b);
    if (!werte.length) continue;
    const mitte = Math.floor(werte.length / 2);
    out[klasse] = round2(werte.length % 2 ? werte[mitte] : (werte[mitte - 1] + werte[mitte]) / 2);
  }
  return out;
}

/** Der Schein, der an diesem Tag gilt. Der erste Schein gilt auch für alles davor. */
export function scheinFuer(scheine, datum) {
  const sortiert = [...scheine].sort((a, b) => a.gueltigAb.localeCompare(b.gueltigAb));
  let gewaehlt = sortiert[0] ?? null;
  for (const s of sortiert) if (s.gueltigAb <= datum) gewaehlt = s;
  return gewaehlt;
}

/**
 * Baut die Abrechnung: eine Zeile je Samstag seit Start, dazu Summen und Anteile je Spieler.
 * Kosten fallen ab dem Spieltag an, auch wenn die Ziehung noch nicht in der Datenbank ist.
 */
export function baueAbrechnung({ ziehungen, scheine, startDatum, heute, korrekturen = [], spieler = [] }) {
  const samstage = ziehungen.filter((z) => z.serie === SERIE && z.date >= startDatum && z.date <= heute);
  const nachDatum = new Map(samstage.map((z) => [z.date, z]));
  const schaetzung = schaetzeQuoten(samstage.filter((z) => z.quoten));

  // Kalender-Samstage ohne Ziehung (heute noch nicht gezogen); Wochen mit verschobener Ziehung nicht doppelt zählen
  const wochen = new Set(samstage.map((z) => letzterSamstag(addDays(z.date, 3))));
  const termine = [...nachDatum.keys()];
  for (const sa of samstageZwischen(startDatum, heute)) {
    if (!nachDatum.has(sa) && !wochen.has(sa)) termine.push(sa);
  }
  termine.sort();

  let saldo = 0;
  const zeilen = termine.map((datum) => {
    const schein = scheinFuer(scheine, datum);
    const ziehung = nachDatum.get(datum) ?? null;
    const kosten = schein?.kosten ?? 0;
    const auswertung = ziehung && schein ? werteZiehungAus(ziehung, schein, schaetzung) : null;
    const gewinn = auswertung?.gewinn ?? 0;
    saldo = round2(saldo + gewinn - kosten);
    return {
      datum,
      status: !ziehung ? 'ausstehend' : ziehung.quoten ? 'endgueltig' : 'vorlaeufig',
      scheinId: schein?.id ?? null,
      kosten,
      gewinn,
      geschaetzt: auswertung?.geschaetzt ?? 0,
      offen: auswertung?.offen ?? 0,
      saldo,
      ziehung: ziehung && {
        nums: [...ziehung.nums].sort((a, b) => a - b),
        sz: ziehung.sz,
        spiel77: ziehung.spiel77,
        super6: ziehung.super6,
        quelle: ziehung.quelle,
        geprueft: ziehung.geprueft,
      },
      auswertung,
    };
  });

  const kosten = round2(zeilen.reduce((s, z) => s + z.kosten, 0));
  const gewinnZiehungen = round2(zeilen.reduce((s, z) => s + z.gewinn, 0));
  const gewinnKorrekturen = round2(korrekturen.reduce((s, k) => s + k.lotto + k.spiel77 + k.super6, 0));
  const gewinn = round2(gewinnZiehungen + gewinnKorrekturen);
  const bilanz = round2(gewinn - kosten);
  const n = spieler.length || 1;

  return {
    zeilen,
    summe: {
      wochen: zeilen.length,
      kosten,
      gewinn,
      gewinnZiehungen,
      gewinnKorrekturen,
      geschaetzt: round2(zeilen.reduce((s, z) => s + z.geschaetzt, 0)),
      offen: zeilen.reduce((s, z) => s + z.offen, 0),
      bilanz,
      proSpieler: { kosten: round2(kosten / n), gewinn: round2(gewinn / n), bilanz: round2(bilanz / n) },
    },
  };
}
