/**
 * Holt Ziehungen und Quoten und hält sie in der Datenbank aktuell.
 *
 * Ablauf eines Laufs:
 *  1. Ziehungstage seit dem Startdatum von lotto.de lesen, jede noch nicht endgültige Samstagsziehung abrufen.
 *     Eine Ziehung ist endgültig, sobald alle Quoten veröffentlicht sind. Endgültige Ziehungen werden nie wieder geholt.
 *  2. Die neueste Ziehung mit Lotto Hessen gegenprüfen (zweite, unabhängige Quelle).
 *  3. Fällt lotto.de aus: letzte Ziehung von Lotto Hessen, ältere Zahlen aus dem Archiv (dann ohne Quoten, also vorläufig).
 *
 * Den Zeitplan (`sollLaufen`) übernimmt ein Zeitgeber, der alle 5 Minuten schaut: nach dem Ziehungsabend wird alle 15 Minuten
 * gefragt, bis die Quoten da sind (laut Stichprobe bei 6aus49 erst am Montagmorgen), sonst einmal am Tag.
 * Alles Spielspezifische (Wochentag, Uhrzeiten, Serie) steht in spiele.js.
 */
import { addDays, isoWeekday, letzterWochentag } from './rules.js';
import { berlinDatum } from './sources.js';
import { SPIELE } from './spiele.js';

const MIN = 60 * 1000;
const PAUSE_ZWISCHEN_ABRUFEN_MS = 300;

export const berlinHeute = (ms = Date.now()) => berlinDatum(ms);

export function berlinMinuten(ms = Date.now()) {
  const teile = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(ms));
  const wert = (typ) => Number(teile.find((t) => t.type === typ).value);
  return (wert('hour') % 24) * 60 + wert('minute');
}

/** Spieltag, dessen Ergebnis jetzt zu erwarten ist: bis kurz nach der Ziehung am Spieltag noch der Spieltag davor. */
export function erwarteteZiehung(ms, spiel = SPIELE.lotto) {
  const heute = berlinHeute(ms);
  if (isoWeekday(heute) === spiel.wochentag && berlinMinuten(ms) < spiel.ergebnisAb) return addDays(heute, -7);
  return letzterWochentag(heute, spiel.wochentag);
}

/** Nächster Spieltag, der noch bevorsteht: am Spieltag selbst bis kurz vor der Ziehung heute. */
export function naechsterSpieltag(ms, spiel = SPIELE.lotto) {
  const heute = berlinHeute(ms);
  if (isoWeekday(heute) === spiel.wochentag && berlinMinuten(ms) < spiel.ziehungUm) return heute;
  return addDays(letzterWochentag(heute, spiel.wochentag), 7);
}

const sortiert = (liste) => (liste ?? []).slice().sort((x, y) => x - y).join();

const gleicheZiehung = (a, b) =>
  sortiert(a.nums) === sortiert(b.nums)
  && (a.sz ?? null) === (b.sz ?? null)
  && sortiert(a.euro) === sortiert(b.euro)
  && (!a.spiel77 || !b.spiel77 || a.spiel77 === b.spiel77)
  && (!a.super6 || !b.super6 || a.super6 === b.super6);

/** Soll `neu` die gespeicherte Ziehung ersetzen? Offizielle Quoten gewinnen, das Archiv ersetzt nie bessere Daten. */
function ersetzt(alt, neu) {
  if (!alt) return true;
  if (neu.quoten) return true;
  if (alt.quoten) return false;
  return alt.quelle === 'archiv' || neu.quelle !== 'archiv';
}

export function erstelleSync({ store, quellen, spiel = SPIELE.lotto, jetzt = () => Date.now(), log = console, pause = PAUSE_ZWISCHEN_ABRUFEN_MS }) {
  let laufend = null;
  let letzterLauf = null; // { ok, geholt, fehler[], quelle }

  const schlafen = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

  async function lauf() {
    const { startDatum } = store.einstellungen();
    const heute = berlinHeute(jetzt());
    const fehler = [];
    let geholt = 0;
    let lottoDeOk = false;

    // 1. lotto.de
    let tage = [];
    try {
      for (let jahr = Number(startDatum.slice(0, 4)); jahr <= Number(heute.slice(0, 4)); jahr += 1) {
        tage.push(...(await quellen.lottoDeTage(jahr)));
      }
      lottoDeOk = true;
    } catch (e) {
      fehler.push(e.message);
      tage = [];
    }

    // Die Ziehungen der anderen Wochentage (6aus49: Mittwoch, Eurojackpot: Dienstag) interessieren nicht; alles andere
    // wird geholt, auch verschobene Ziehungen
    const kandidaten = tage.filter((t) => t >= startDatum && t <= heute && !spiel.ignorierteTage.includes(isoWeekday(t))).sort();
    let hintereinander = 0;
    for (const tag of kandidaten) {
      const alt = store.ziehung(tag);
      if (alt?.quoten) continue;
      if (alt && jetzt() - alt.abgerufenAm < 10 * MIN) continue;
      try {
        const z = await quellen.lottoDeZiehung(tag);
        hintereinander = 0;
        // Auch verschobene Mittwochsziehungen werden gespeichert, damit sie nicht bei jedem Lauf neu gefragt werden
        if (ersetzt(alt, z)) {
          store.speichereZiehung({ ...z, geprueft: alt && gleicheZiehung(alt, z) ? alt.geprueft : null }, jetzt());
          geholt += 1;
        }
      } catch (e) {
        fehler.push(`${tag}: ${e.message}`);
        hintereinander += 1;
        if (hintereinander >= 3) {
          lottoDeOk = false;
          break;
        }
      }
      await schlafen(pause);
    }

    // 2. Gegenprüfung beziehungsweise Ersatz über Lotto Hessen
    try {
      const h = await quellen.hessenLetzte();
      if (h.date >= startDatum && h.serie === spiel.serie && h.date <= heute) {
        const alt = store.ziehung(h.date);
        if (!alt || alt.quelle === 'archiv') {
          store.speichereZiehung({ ...h, geprueft: null }, jetzt());
          geholt += 1;
        } else if (alt.geprueft !== 'lotto-hessen') {
          if (gleicheZiehung(alt, h)) {
            // Quoten, die lotto.de noch nicht hat, von Lotto Hessen übernehmen
            const quoten = alt.quoten ?? h.quoten;
            store.speichereZiehung({
              ...alt,
              spiel77: alt.spiel77 ?? h.spiel77,
              super6: alt.super6 ?? h.super6,
              quoten,
              quelle: alt.quoten ? alt.quelle : h.quoten ? 'lotto-hessen' : alt.quelle,
              geprueft: 'lotto-hessen',
            }, jetzt());
            if (!alt.quoten && h.quoten) geholt += 1;
          } else {
            store.speichereZiehung({ ...alt, geprueft: 'abweichung' }, jetzt());
            fehler.push(`Quellen weichen für ${h.date} voneinander ab`);
          }
        }
      }
    } catch (e) {
      fehler.push(e.message);
    }

    // 3. Notnagel: Zahlen aus dem Archiv, falls lotto.de gar nichts geliefert hat
    if (!lottoDeOk) {
      try {
        for (const z of await quellen.archiv(startDatum)) {
          if (z.serie !== spiel.serie || z.date > heute || store.ziehung(z.date)) continue;
          store.speichereZiehung({ ...z, geprueft: null }, jetzt());
          geholt += 1;
        }
      } catch (e) {
        fehler.push(e.message);
      }
    }

    const ok = lottoDeOk;
    store.setzeMeta('sync_versuch', jetzt());
    if (ok) store.setzeMeta('sync_erfolg', jetzt());
    store.setzeMeta('sync_fehler', fehler.length ? fehler.slice(0, 3).join(' | ') : '');
    letzterLauf = { ok, geholt, fehler };
    if (fehler.length) log.warn?.(`[sync] ${fehler.join(' | ')}`);
    return letzterLauf;
  }

  function starte(grund = 'manuell') {
    if (!laufend) {
      laufend = lauf()
        .catch((e) => {
          store.setzeMeta('sync_versuch', jetzt());
          store.setzeMeta('sync_fehler', e.message);
          log.error?.(`[sync] Lauf (${grund}) fehlgeschlagen:`, e);
        })
        .finally(() => { laufend = null; });
    }
    return laufend;
  }

  function sollLaufen() {
    if (laufend) return false;
    const jetztMs = jetzt();
    const versuch = Number(store.meta('sync_versuch') ?? 0);
    const erfolg = Number(store.meta('sync_erfolg') ?? 0);
    if (!versuch) return true;

    const { startDatum } = store.einstellungen();
    const erwartet = erwarteteZiehung(jetztMs, spiel);
    if (erwartet >= startDatum) {
      const letzte = store.ziehungen().filter((z) => z.serie === spiel.serie && z.date >= addDays(erwartet, -3)).pop();
      // Maßgeblich sind nur die Quoten: Lotto Hessen kennt nur die letzte Ziehung und kann ältere nicht mehr gegenprüfen
      const veraltet = !letzte || !letzte.quoten;
      const frisch = berlinHeute(jetztMs) <= addDays(erwartet, 6);
      if (veraltet && jetztMs - versuch > (frisch ? 15 * MIN : 6 * 60 * MIN)) return true;
    }
    return jetztMs - erfolg > 24 * 60 * MIN && jetztMs - versuch > 60 * MIN;
  }

  function status() {
    const versuch = Number(store.meta('sync_versuch') ?? 0);
    const erfolg = Number(store.meta('sync_erfolg') ?? 0);
    return {
      laeuft: Boolean(laufend),
      letzterVersuch: versuch || null,
      letzterErfolg: erfolg || null,
      fehler: store.meta('sync_fehler') || null,
    };
  }

  /** Zeitgeber für den Serverbetrieb; Tests rufen `sollLaufen` und `starte` direkt auf. */
  function plane() {
    const tick = () => { if (sollLaufen()) starte('zeit'); };
    const erster = setTimeout(tick, 3000);
    const intervall = setInterval(tick, 5 * MIN);
    erster.unref();
    intervall.unref();
    return () => { clearTimeout(erster); clearInterval(intervall); };
  }

  return { starte, sollLaufen, status, plane, ob: () => letzterLauf };
}
