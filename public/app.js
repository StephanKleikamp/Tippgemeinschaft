// Oberfläche der Tippgemeinschaft. Alle Zahlen kommen fertig berechnet vom Server (/api/zustand),
// hier wird nur dargestellt und eingegeben. Keine Bibliotheken, keine externen Adressen.

const $ = (id) => document.getElementById(id);
const euroFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const fe = (n) => euroFormat.format(n);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tag = (iso) => new Date(`${iso}T12:00:00`);
const datumLang = (iso) => tag(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const datumKurz = (iso) => tag(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const plural = (n, eins, mehr) => (n === 1 ? eins : mehr);

let z = null; // letzter Zustand vom Server
let gewaehlt = null; // Datum der Ziehung in der Abgleich-Ansicht
let abrufTimer = null;
let verlaufAlle = false;
const VERLAUF_ANFANG = 12;

// ---- Schnittstelle ----

async function api(methode, pfad, body) {
  const antwort = await fetch(pfad, {
    method: methode,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let daten = null;
  try { daten = await antwort.json(); } catch { /* keine JSON-Antwort */ }
  if (antwort.status === 401 && daten?.error === 'Nicht angemeldet.') {
    zeigeAnmeldung();
    throw new Error('Bitte neu anmelden.');
  }
  if (!antwort.ok) throw new Error(daten?.error || `Fehler ${antwort.status}`);
  return daten;
}

let toastTimer;
function toast(text, fehler = false) {
  const el = $('toast');
  el.textContent = text;
  el.className = `toast zeigen${fehler ? ' fehler-toast' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('zeigen'), 3600);
}

// ---- Anmeldung ----

function zeigeAnmeldung() {
  clearTimeout(abrufTimer);
  z = null;
  $('app').hidden = true;
  $('anmeldung').hidden = false;
  $('passwort').value = '';
  $('passwort').focus();
}

async function zeigeApp() {
  $('anmeldung').hidden = true;
  $('app').hidden = false;
  await lade();
  if (z && !z.sync.laeuft && !z.sync.letzterVersuch) await starteAbruf(true);
  else if (z?.sync.laeuft) beobachteAbruf();
}

$('anmeldeformular').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('anmeldefehler').textContent = '';
  try {
    await api('POST', '/api/anmelden', { passwort: $('passwort').value });
    await zeigeApp();
  } catch (err) {
    $('anmeldefehler').textContent = err.message;
  }
});

$('knopf-abmelden').addEventListener('click', async () => {
  await api('POST', '/api/abmelden').catch(() => {});
  zeigeAnmeldung();
});

// ---- Laden und Abrufen ----

let letzteAktualisierung = 0;

async function lade() {
  z = await api('GET', '/api/zustand');
  letzteAktualisierung = Date.now();
  render();
}

// Offene Seite von selbst auffrischen, damit neue Quoten ohne Neuladen erscheinen (nicht bei offenem Dialog oder im Hintergrund-Tab)
setInterval(() => {
  if (z && !document.hidden && !document.querySelector('dialog[open]') && Date.now() - letzteAktualisierung > 5 * 60 * 1000) lade().catch(() => {});
}, 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && z && Date.now() - letzteAktualisierung > 2 * 60 * 1000) lade().catch(() => {});
});

async function starteAbruf(still = false) {
  try {
    const r = await api('POST', '/api/abruf');
    if (!still && !r.gestartet && !r.sync.laeuft) toast('Gerade erst geprüft, bitte einen Moment warten.');
    z.sync = r.sync;
    renderStatus();
    beobachteAbruf();
  } catch (err) {
    toast(err.message, true);
  }
}

function beobachteAbruf(versuche = 0) {
  clearTimeout(abrufTimer);
  if (!z?.sync.laeuft || versuche > 60) return;
  abrufTimer = setTimeout(async () => {
    try {
      await lade();
    } catch { return; }
    if (z.sync.laeuft) beobachteAbruf(versuche + 1);
    else toast(z.sync.fehler ? 'Abruf mit Hinweisen beendet.' : 'Ziehungen sind aktuell.', Boolean(z.sync.fehler));
  }, 2000);
}

$('knopf-abruf').addEventListener('click', () => starteAbruf(false));

// ---- Darstellung ----

// ---- Spiel (6aus49 oder Eurojackpot): Beschriftungen und Eingabemasken ----

const FELD_BUCHSTABEN = 'ABCDEFGHIJKL';

function wendeSpielAn(sp) {
  document.title = sp.seitentitel;
  for (const praefix of ['anmelde', 'marke']) {
    $(`${praefix}-symbol`).textContent = sp.symbol;
    $(`${praefix}-titel`).textContent = sp.titel;
    $(`${praefix}-untertitel`).textContent = sp.untertitel;
  }
  $('einst-start-label').textContent = `Erster Spieltag (${sp.serie})`;
  // Scheinnummer, Spiel 77 und Super 6 gibt es nur bei 6aus49
  for (const id of ['schein-losnummer-zeile', 'schein-haken', 'schein-zusatz-hinweis', 'k-spiel77-zeile', 'k-super6-zeile']) $(id).hidden = !sp.zusatz;
  $('k-lotto-label').textContent = `${sp.spalten[0].label} (€)`;
  $('zahlung-formular').hidden = !sp.zahlungen || z?.rolle !== 'admin';
  const { zahlen, max, extra } = sp.feld;
  $('schein-kopf-zahlen').textContent = `${zahlen} Zahlen (1–${max}), mit Leerzeichen getrennt`;
  $('schein-kopf-extra').textContent = extra.art === 'euro' ? `Eurozahlen (${extra.min}–${extra.max})` : 'SZ';
}

function render() {
  if (!z) return;
  wendeSpielAn(z.spiel);
  // Einstellungen, Passwörter, Tippschein und Korrekturbuchungen ändert nur der Admin, der Server prüft das ebenfalls
  const admin = z.rolle === 'admin';
  $('knopf-einstellungen').hidden = !admin;
  $('knopf-schein').hidden = !admin;
  $('knopf-korrektur').hidden = !admin;
  $('admin-marke').hidden = !admin;
  $('korrektur-hinweis').textContent = admin
    ? 'Gewinne aus den Ziehungen werden automatisch berechnet. Hier nur eintragen, was davon abweicht, zum Beispiel eine Gutschrift der Annahmestelle (Minus für Abzüge).'
    : 'Gewinne aus den Ziehungen werden automatisch berechnet. Hier steht nur, was davon abweicht, zum Beispiel eine Gutschrift der Annahmestelle.';
  renderStatus();
  renderKarten();
  renderAbgleich();
  renderZahlungen();
  renderSpieler();
  renderVerlauf();
  renderKorrekturen();
}

function zeitText(ms) {
  if (!ms) return 'noch nie';
  const d = new Date(ms);
  const heute = new Date();
  const uhr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === heute.toDateString() ? `heute ${uhr} Uhr` : `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} ${uhr} Uhr`;
}

function renderStatus() {
  const s = z.sync;
  const teile = [];
  if (s.laeuft) teile.push('<span class="drehen"></span>Ziehungen werden abgerufen …');
  else teile.push(`Zuletzt geprüft: ${zeitText(s.letzterErfolg)}`);
  teile.push(`Nächste Ziehung: ${datumLang(z.naechsterSpieltag)}`);
  if (!s.laeuft && s.fehler) teile.push(`<span class="warnung">⚠ ${esc(s.fehler)}</span>`);
  $('status').innerHTML = teile.join(' · ');
  $('knopf-abruf').disabled = s.laeuft;
}

function renderKarten() {
  const s = z.abrechnung.summe;
  const mitGewinn = z.abrechnung.zeilen.filter((r) => r.gewinn > 0).length;
  let gewinnUnter = `${mitGewinn} ${plural(mitGewinn, 'Spieltag', 'Spieltage')} mit Gewinn`;
  if (s.gewinnKorrekturen) gewinnUnter += ` · davon Korrekturen ${fe(s.gewinnKorrekturen)}`;
  if (s.offen) gewinnUnter = `+ ${s.geschaetzt ? `ca. ${fe(s.geschaetzt)} ` : ''}noch offen (${s.offen} ${plural(s.offen, 'Gewinn', 'Gewinne')} ohne Quote)`;
  const bilanzKlasse = s.bilanz >= 0 ? 'gruen' : 'rot';
  const pro = s.proSpieler;
  $('karten').innerHTML = `
    <div class="karte"><div class="karte-label">Gesamtkosten</div><div class="karte-wert rot">${fe(s.kosten)}</div><div class="karte-unter">${s.wochen} ${plural(s.wochen, 'Spieltag', 'Spieltage')} seit ${datumKurz(z.einstellungen.startDatum)}</div></div>
    <div class="karte"><div class="karte-label">Gesamtgewinn</div><div class="karte-wert gruen">${fe(s.gewinn)}</div><div class="karte-unter">${gewinnUnter}</div></div>
    <div class="karte"><div class="karte-label">Bilanz gesamt</div><div class="karte-wert ${bilanzKlasse}">${fe(s.bilanz)}</div><div class="karte-unter">${s.bilanz >= 0 ? '✓ Im Plus' : '✗ Im Minus'}</div></div>
    <div class="karte"><div class="karte-label">Bilanz pro Spieler</div><div class="karte-wert ${pro.bilanz >= 0 ? 'gruen' : 'rot'}">${fe(pro.bilanz)}</div><div class="karte-unter">je ${fe(pro.kosten)} Kosten · je ${fe(pro.gewinn)} Gewinn</div></div>`;
  $('wochen-badge').textContent = `${s.wochen} ${plural(s.wochen, 'Spieltag', 'Spieltage')}`;
}

// -- Abgleich mit dem Tippschein --

function kugeln(nums, { gezogen = false, treffer = [] } = {}) {
  return nums.map((n) => `<span class="kugel${gezogen ? ' gezogen-kugel' : ''}${treffer.includes(n) ? ' treffer' : ''}" aria-label="${n}${treffer.includes(n) ? ', Treffer' : ''}">${n}</span>`).join('');
}

/** Eurozahlen (goldene Kugeln) beziehungsweise bei 6aus49 die Superzahl (violett). */
function zusatzKugeln(zahlen, { gezogen = false, treffer = [], euro = false } = {}) {
  return zahlen.map((n) => {
    const hit = treffer.includes(n);
    const art = euro ? `euro${hit ? ' treffer' : ''}` : `sz${hit ? ' treffer' : ''}`;
    const label = `${euro ? 'Eurozahl' : 'Superzahl'} ${n}${hit ? ', Treffer' : ''}`;
    return `<span class="kugel${gezogen ? ' gezogen-kugel' : ''} ${art}" aria-label="${label}">${n}</span>`;
  }).join('');
}

function ziffern(text, { ab = Infinity, klasse = '' } = {}) {
  return [...text].map((c, i) => `<span class="ziffer ${klasse}${i >= ab ? ' richtig' : ''}">${c}</span>`).join('');
}

const QUELLEN = { 'lotto.de': 'lotto.de', 'lotto-hessen': 'Lotto Hessen', archiv: 'Archiv (nur Zahlen)' };

function quelleHtml(r, neueste) {
  const zi = r.ziehung;
  const teile = [`Quelle: ${QUELLEN[zi.quelle] ?? esc(zi.quelle)}`];
  if (zi.geprueft === 'lotto-hessen') teile.push('✔ von Lotto Hessen bestätigt');
  else if (zi.geprueft === 'abweichung') teile.push('<span class="warnung">⚠ Lotto Hessen meldet andere Zahlen, bitte auf lotto.de prüfen</span>');
  else if (zi.quelle !== 'archiv' && neueste) teile.push('noch nicht gegengeprüft');
  if (zi.quelle === 'archiv') teile.push('<span class="warnung">Spiel 77 und Super 6 fehlen hier noch</span>');
  return teile.map((t) => `<span>${t}</span>`).join('');
}

function statusMarke(r) {
  if (r.status === 'endgueltig') return '<span class="marke-status ok">✔ Quoten da</span>';
  if (r.status === 'vorlaeufig') return '<span class="marke-status offen">⏳ Quoten fehlen noch</span>';
  return '<span class="marke-status warte">steht aus</span>';
}

function ergebnisFeld(f) {
  const richtige = f.euro
    ? `${f.treffer.length} Treffer + ${f.euroTreffer.length} ${f.euroTreffer.length === 1 ? 'Eurozahl' : 'Eurozahlen'}`
    : `${f.treffer.length} Treffer${f.szTreffer ? ' + SZ' : ''}`;
  if (!f.klasse) return `<span>${richtige} · kein Gewinn</span>`;
  if (f.betrag !== null) return `<span class="betrag">${fe(f.betrag)}</span><span class="klasse">${richtige} · Klasse ${f.klasse}</span>`;
  const schaetzung = f.geschaetzt ? `≈ ${fe(f.geschaetzt)}` : 'Betrag offen';
  return `<span class="betrag offen">${schaetzung}</span><span class="klasse">${richtige} · Klasse ${f.klasse} · Quote noch nicht veröffentlicht</span>`;
}

function zusatzHtml(name, spiel, stellen) {
  if (!spiel) return '';
  const gewinnt = spiel.klasse && spiel.betrag !== null;
  let ergebnis;
  if (!spiel.gewinnzahl) ergebnis = '<span>Gewinnzahl noch nicht verfügbar</span>';
  else if (!spiel.klasse) ergebnis = `<span>${spiel.endziffern} Endziffern · kein Gewinn</span>`;
  else if (spiel.betrag === null) ergebnis = `<span class="betrag offen">Betrag offen</span><span class="klasse">${spiel.endziffern} Endziffern · Klasse ${spiel.klasse}</span>`;
  else ergebnis = `<span class="betrag">${fe(spiel.betrag)}</span><span class="klasse">${spiel.endziffern} Endziffern · Klasse ${spiel.klasse}</span>`;
  const gezogen = spiel.gewinnzahl ? ziffern(spiel.gewinnzahl, { klasse: 'gezogen-ziffer' }) : '<span class="klein-grau">–</span>';
  return `
    <div class="zusatz${gewinnt ? ' gewinn' : ''}">
      <div class="zusatz-name">${name}<div class="klein-grau">${stellen} Stellen</div></div>
      <div class="ziffern-zeilen">
        <div class="ziffern-zeile"><span class="vorne">Euer Schein</span>${ziffern(spiel.losnummer, { ab: stellen - spiel.endziffern })}</div>
        <div class="ziffern-zeile"><span class="vorne">Gezogen</span>${gezogen}</div>
      </div>
      <div class="ergebnis">${ergebnis}</div>
    </div>`;
}

function renderAbgleich() {
  const ziel = $('abgleich');
  const zeilen = z.abrechnung.zeilen;
  if (!z.scheine.length) {
    ziel.innerHTML = z.rolle === 'admin'
      ? `<div class="abgleich"><div class="abgleich-leer"><h2>Noch kein Tippschein</h2><p>Trage eure 8 Spielfelder und die Scheinnummer ein. Dann wird jede Ziehung automatisch abgeglichen.</p><button class="btn primaer" type="button" data-aktion="schein">🎟️ Tippschein eintragen</button></div></div>`
      : `<div class="abgleich"><div class="abgleich-leer"><h2>Noch kein Tippschein</h2><p>Der Admin trägt die Spielfelder und die Scheinnummer ein. Danach wird jede Ziehung automatisch abgeglichen.</p></div></div>`;
    return;
  }
  if (!zeilen.length) {
    ziel.innerHTML = `<div class="abgleich"><div class="abgleich-leer"><h2>Noch keine Ziehung</h2><p>Der erste Spieltag ist der ${datumLang(z.einstellungen.startDatum)}.</p></div></div>`;
    return;
  }
  if (!gewaehlt || !zeilen.some((r) => r.datum === gewaehlt)) {
    gewaehlt = ([...zeilen].reverse().find((r) => r.ziehung) ?? zeilen[zeilen.length - 1]).datum;
  }
  const absteigend = [...zeilen].reverse();
  const index = absteigend.findIndex((r) => r.datum === gewaehlt);
  const r = absteigend[index];
  const optionen = absteigend.map((x) => `<option value="${x.datum}"${x.datum === gewaehlt ? ' selected' : ''}>${datumLang(x.datum)}</option>`).join('');

  let koerper;
  if (!r.ziehung) {
    koerper = `<div class="abgleich-leer">Die Ziehung vom ${datumLang(r.datum)} liegt noch nicht vor. Sobald lotto.de die Zahlen hat, erscheinen sie hier automatisch.</div>`;
  } else {
    const a = r.auswertung;
    const felder = a.lotto.felder.map((f) => `
      <div class="feld ${f.klasse ? 'gewinn' : 'kein'}">
        <span class="feld-name">${f.label}</span>
        <span class="feld-zahlen">${kugeln(f.nums, { treffer: f.treffer })}<span class="trenner-sz">|</span>${f.euro ? zusatzKugeln(f.euro, { treffer: f.euroTreffer, euro: true }) : zusatzKugeln([f.sz], { treffer: f.szTreffer ? [f.sz] : [] })}</span>
        <span class="ergebnis">${ergebnisFeld(f)}</span>
      </div>`).join('');
    const noch = a.offen ? ` · <span class="warnung">+ ${a.geschaetzt ? `ca. ${fe(a.geschaetzt)}` : 'Betrag'} offen</span>` : '';
    koerper = `
      <div class="abgleich-quelle">${quelleHtml(r, !zeilen.some((x) => x.ziehung && x.datum > r.datum))}</div>
      <div class="gezogen">
        <div class="gezogen-gruppe"><span class="gezogen-name">${esc(z.spiel.name)}</span>${kugeln(r.ziehung.nums, { gezogen: true })}${r.ziehung.euro ? zusatzKugeln(r.ziehung.euro, { gezogen: true, euro: true }) : zusatzKugeln([r.ziehung.sz], { gezogen: true })}</div>
      </div>
      <div class="tippschein">
        <div class="tippschein-titel">Euer Tippschein · ${esc(z.spiel.name)}</div>
        ${felder}
        ${a.spiel77 || a.super6 ? '<div class="tippschein-titel">Zusatzlotterien</div>' : ''}
        ${zusatzHtml('Spiel 77', a.spiel77, 7)}
        ${zusatzHtml('Super 6', a.super6, 6)}
      </div>
      <div class="abgleich-summe">
        <span>Gewinn dieser Ziehung: <strong class="${r.gewinn > 0 ? 'gruen' : ''}">${fe(r.gewinn)}</strong>${noch}</span>
        <span>Einsatz: <strong>${fe(r.kosten)}</strong></span>
        <span>Bilanz bis hier: <strong class="${r.saldo >= 0 ? 'gruen' : 'rot'}">${fe(r.saldo)}</strong></span>
      </div>`;
  }

  ziel.innerHTML = `
    <div class="abgleich">
      <div class="abgleich-kopf">
        <h2>Abgleich: ${datumLang(r.datum)}</h2>
        ${statusMarke(r)}
        <div class="abgleich-wahl">
          <button class="btn sekundaer klein" type="button" data-aktion="aelter" aria-label="Ältere Ziehung"${index >= absteigend.length - 1 ? ' disabled' : ''}>◀</button>
          <select id="abgleich-datum" aria-label="Ziehung wählen">${optionen}</select>
          <button class="btn sekundaer klein" type="button" data-aktion="neuer" aria-label="Neuere Ziehung"${index === 0 ? ' disabled' : ''}>▶</button>
        </div>
      </div>
      ${koerper}
    </div>`;
}

$('abgleich').addEventListener('click', (e) => {
  const knopf = e.target.closest('[data-aktion]');
  if (!knopf) return;
  const absteigend = [...z.abrechnung.zeilen].reverse();
  const index = absteigend.findIndex((r) => r.datum === gewaehlt);
  if (knopf.dataset.aktion === 'aelter' && index < absteigend.length - 1) gewaehlt = absteigend[index + 1].datum;
  else if (knopf.dataset.aktion === 'neuer' && index > 0) gewaehlt = absteigend[index - 1].datum;
  else if (knopf.dataset.aktion === 'schein') return oeffneSchein();
  renderAbgleich();
});
$('abgleich').addEventListener('change', (e) => {
  if (e.target.id === 'abgleich-datum') {
    gewaehlt = e.target.value;
    renderAbgleich();
  }
});

// -- Zahlungen des ersten Mitspielers (nur Eurojackpot) --

const kwText = (kw) => `KW ${kw}`;
const bezahltMarke = (datum) => (z.zahlungen?.zahlungen.length && z.zahlungen.ziehungen.find((x) => x.datum === datum)?.bezahlt
  ? ' <span class="marke-status ok">💶 bezahlt</span>' : '');

function zahlungenTabelle(zahlungen, { loeschen = false } = {}) {
  if (!zahlungen.zahlungen.length) return '<tbody><tr><td class="leer" colspan="5">Noch keine Zahlung erfasst.</td></tr></tbody>';
  const zeilen = [...zahlungen.zahlungen].reverse().map((x) => `<tr>
    <td class="nowrap">${datumKurz(x.eingegangenAm)}</td>
    <td class="nowrap">${kwText(x.kw)} · ${datumKurz(x.bezahltBis)}</td>
    <td class="zahl"><strong>${fe(x.betrag)}</strong></td>
    <td class="grau">${esc(x.notiz)}</td>
    ${loeschen ? `<td class="zahl"><button class="btn symbol" type="button" data-zahlung-loeschen="${x.id}" aria-label="Zahlung löschen">✕</button></td>` : ''}</tr>`).join('');
  return `<thead><tr><th>Eingegangen</th><th>Bezahlt bis</th><th class="zahl">Betrag</th><th>Notiz</th>${loeschen ? '<th></th>' : ''}</tr></thead><tbody>${zeilen}</tbody>`;
}

function renderZahlungen() {
  const ziel = $('zahlungen');
  const zl = z.zahlungen;
  const admin = z.rolle === 'admin';
  // Mitglieder sehen den Abschnitt erst, wenn die erste Zahlung dokumentiert ist, damit niemand einen unvollständigen Stand sieht
  if (!zl || (!zl.zahlungen.length && !admin)) {
    ziel.hidden = true;
    return;
  }
  ziel.hidden = false;
  const name = esc(zl.zahler);
  const letzte = zl.zahlungen[zl.zahlungen.length - 1];
  const bezahltKarte = zl.zahlungen.length
    ? `<div class="karte"><div class="karte-label">Bereits bezahlt</div><div class="karte-wert gruen">${fe(zl.bezahlt)}</div><div class="karte-unter">${zl.zahlungen.length} ${plural(zl.zahlungen.length, 'Zahlung', 'Zahlungen')}, zuletzt eingegangen am ${datumKurz(letzte.eingegangenAm)}</div></div>`
    : '<div class="karte"><div class="karte-label">Bereits bezahlt</div><div class="karte-wert grau">0,00 €</div><div class="karte-unter">noch keine Zahlung erfasst</div></div>';
  const zeitraumKarte = zl.abgedeckt
    ? `<div class="karte"><div class="karte-label">Bezahlt für</div><div class="karte-wert">${kwText(zl.abgedeckt.kwVon)} bis ${kwText(zl.abgedeckt.kwBis)}</div><div class="karte-unter">${datumKurz(zl.abgedeckt.von)} bis ${datumKurz(zl.abgedeckt.bis)} · ${zl.abgedeckt.ziehungen} ${plural(zl.abgedeckt.ziehungen, 'Ziehung', 'Ziehungen')}</div></div>`
    : '<div class="karte"><div class="karte-label">Bezahlt für</div><div class="karte-wert grau">–</div><div class="karte-unter">noch kein Zeitraum bezahlt</div></div>';

  const offen = zl.offenBetrag;
  let offenKarte;
  if (!zl.stand) {
    offenKarte = '<div class="karte"><div class="karte-label">Noch zu zahlen</div><div class="karte-wert grau">–</div><div class="karte-unter">noch keine Ziehung mit endgültigen Quoten</div></div>';
  } else if (Math.abs(offen) < 0.005 && !zl.offen) {
    offenKarte = `<div class="karte"><div class="karte-label">Noch zu zahlen</div><div class="karte-wert gruen">${fe(0)}</div><div class="karte-unter">✓ alles bezahlt bis zur letzten Ziehung (${datumKurz(zl.stand)}, ${kwText(zl.standKw)})</div></div>`;
  } else {
    const bereich = zl.offen
      ? `${kwText(zl.offen.kwVon)} bis ${kwText(zl.offen.kwBis)} · ${datumKurz(zl.offen.von)} bis ${datumKurz(zl.offen.bis)} · ${zl.offen.ziehungen} ${plural(zl.offen.ziehungen, 'Ziehung', 'Ziehungen')}`
      : `bis zur letzten Ziehung (${datumKurz(zl.stand)}, ${kwText(zl.standKw)})`;
    const titel = offen < 0 ? 'Guthaben' : 'Noch zu zahlen';
    offenKarte = `<div class="karte"><div class="karte-label">${titel}</div><div class="karte-wert ${offen < 0 ? 'gruen' : 'rot'}">${fe(Math.abs(offen))}</div><div class="karte-unter">${bereich}</div></div>`;
  }

  const hinweise = [];
  if (zl.ausstehend.length) {
    const d = zl.ausstehend[0];
    hinweise.push(`Die Ziehung vom ${datumKurz(d.datum)} (${kwText(d.kw)}) hat noch keine Quoten. Der Betrag wird danach angepasst.`);
  }
  if (Math.abs(zl.abweichung) >= 0.005) {
    hinweise.push(`Für den bezahlten Zeitraum ${zl.abweichung > 0 ? 'wurden' : 'fehlen'} ${fe(Math.abs(zl.abweichung))} ${zl.abweichung > 0 ? 'mehr gezahlt als berechnet' : 'gegenüber der Berechnung'}. Das ist im offenen Betrag schon berücksichtigt.`);
  }
  if (!zl.zahlungen.length && admin) hinweise.push(`Noch keine Zahlung erfasst. Unter „Einstellungen“ → „Zahlungen“ trägst du ein, bis wann ${zl.zahler} bezahlt hat. Mitglieder sehen diesen Abschnitt erst danach.`);

  ziel.innerHTML = `
    <div class="abschnitt-kopf"><h2>Zahlungen von ${name}</h2><span class="klein-grau">Anteil an Kosten minus Gewinnen, je Ziehung geteilt durch ${z.einstellungen.spieler.length}</span></div>
    <div class="karten">${bezahltKarte}${zeitraumKarte}${offenKarte}</div>
    ${hinweise.map((h) => `<p class="hinweis zahl-hinweis">${esc(h)}</p>`).join('')}
    ${zl.zahlungen.length ? `<div class="tabelle-rahmen"><table>${zahlungenTabelle(zl)}</table></div>` : ''}`;
}

// Admin: Zahlung erfassen (Ziehungen abhaken oder „bezahlt bis zum“ eingeben)

let betragManuell = false;

function zahlungenFormular() {
  const zl = z.zahlungen;
  const form = $('zahlung-formular');
  form.hidden = !z.spiel.zahlungen || z.rolle !== 'admin';
  if (form.hidden || !zl) return;
  $('zahl-titel').textContent = `Zahlungen von ${zl.zahler}`;
  const offen = zl.ziehungen.filter((x) => !x.bezahlt);
  $('zahl-stand').textContent = zl.bezahltBis
    ? `Bezahlt bis ${datumLang(zl.bezahltBis)} (${kwText(zl.bezahltBisKw)}), insgesamt ${fe(zl.bezahlt)}. Noch zu zahlen: ${fe(zl.offenBetrag)}.`
    : `Noch keine Zahlung erfasst. Rechnerisch fällig bis zur letzten Ziehung: ${fe(zl.offenBetrag)}.`;
  $('zahl-liste').innerHTML = offen.length
    ? offen.map((x) => `<label class="zahl-zeile"><input type="checkbox" data-datum="${x.datum}"><span>${datumLang(x.datum)}</span><span class="grau">${kwText(x.kw)}</span><span class="betrag ${x.anteil < 0 ? 'gruen' : ''}">${fe(x.anteil)}</span></label>`).join('')
    : '<div class="zahl-leer">Alle Ziehungen mit endgültigen Quoten sind bezahlt.</div>';
  $('zahl-bis').value = '';
  $('zahl-betrag').value = '';
  $('zahl-eingang').value = z.heute;
  $('zahl-notiz').value = '';
  $('zahl-fehler').textContent = '';
  betragManuell = false;
  $('zahl-tabelle').innerHTML = zahlungenTabelle(zl, { loeschen: true });
  zahlungVorschau();
}

/** Übernimmt den Stand der Häkchen in Datum, Betrag und Vorschau. */
function zahlungVorschau() {
  const haken = [...$('zahl-liste').querySelectorAll('input[type=checkbox]')];
  const gehakt = haken.filter((h) => h.checked);
  haken.forEach((h) => h.closest('.zahl-zeile').classList.toggle('gehakt', h.checked));
  const letzte = gehakt.at(-1)?.dataset.datum ?? '';
  $('zahl-bis').value = letzte;
  const summe = gehakt.reduce((s, h) => s + z.zahlungen.ziehungen.find((x) => x.datum === h.dataset.datum).anteil, 0);
  if (!betragManuell) $('zahl-betrag').value = gehakt.length ? (Math.round(summe * 100) / 100).toFixed(2) : '';
  $('zahl-vorschau').textContent = gehakt.length
    ? `Bezahlt bis ${datumLang(letzte)} (${kwText(z.zahlungen.ziehungen.find((x) => x.datum === letzte).kw)}): ${gehakt.length} ${plural(gehakt.length, 'Ziehung', 'Ziehungen')} mit zusammen ${fe(summe)}.`
    : 'Hake die Ziehungen ab, die bezahlt sind, oder gib „bezahlt bis zum“ ein. Der Betrag wird berechnet und lässt sich ändern.';
}

$('zahl-liste').addEventListener('change', (e) => {
  const haken = [...$('zahl-liste').querySelectorAll('input[type=checkbox]')];
  const index = haken.indexOf(e.target);
  // Wer eine Ziehung abhakt, hat auch alle früheren bezahlt, wer abwählt, auch alle späteren nicht
  haken.forEach((h, i) => { if (e.target.checked ? i <= index : i >= index) h.checked = e.target.checked; });
  zahlungVorschau();
});

$('zahl-alle').addEventListener('click', () => {
  $('zahl-liste').querySelectorAll('input[type=checkbox]').forEach((h) => { h.checked = true; });
  zahlungVorschau();
});

$('zahl-bis').addEventListener('change', (e) => {
  // Datum eingeben: alle Ziehungen bis dahin (am oder vor dem Datum) werden abgehakt
  $('zahl-liste').querySelectorAll('input[type=checkbox]').forEach((h) => { h.checked = Boolean(e.target.value) && h.dataset.datum <= e.target.value; });
  zahlungVorschau();
});

$('zahl-betrag').addEventListener('input', (e) => { betragManuell = e.target.value !== ''; });

$('zahlung-formular').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('zahl-fehler').textContent = '';
  const bis = $('zahl-bis').value;
  if (!bis) {
    $('zahl-fehler').textContent = 'Bitte mindestens eine Ziehung abhaken oder „bezahlt bis zum“ eingeben.';
    return;
  }
  try {
    z = await api('POST', '/api/zahlungen', {
      bezahltBis: bis,
      betrag: betragManuell ? Number($('zahl-betrag').value) : undefined,
      eingegangenAm: $('zahl-eingang').value || undefined,
      notiz: $('zahl-notiz').value,
    });
    render();
    zahlungenFormular();
    toast('Zahlung gespeichert.');
  } catch (err) {
    $('zahl-fehler').textContent = err.message;
  }
});

$('zahl-tabelle').addEventListener('click', async (e) => {
  const knopf = e.target.closest('[data-zahlung-loeschen]');
  if (!knopf || !confirm('Diese Zahlung wirklich löschen? „Bezahlt bis“ fällt dann auf die vorherige Zahlung zurück.')) return;
  try {
    z = await api('DELETE', `/api/zahlungen/${knopf.dataset.zahlungLoeschen}`);
    render();
    zahlungenFormular();
    toast('Zahlung gelöscht.');
  } catch (err) {
    $('zahl-fehler').textContent = err.message;
  }
});

// -- Tabellen --

function renderSpieler() {
  const s = z.abrechnung.summe;
  const n = z.einstellungen.spieler.length;
  const p = s.proSpieler;
  $('spieler-tabelle').innerHTML = `
    <thead><tr><th>Spieler</th><th class="zahl">Kostenanteil</th><th class="zahl">Gewinnanteil</th><th class="zahl">Bilanz</th></tr></thead>
    <tbody>
      ${z.einstellungen.spieler.map((name) => `<tr><td><strong>${esc(name)}</strong></td><td class="zahl rot">${fe(p.kosten)}</td><td class="zahl gruen">${fe(p.gewinn)}</td><td class="zahl ${p.bilanz >= 0 ? 'gruen' : 'rot'}"><strong>${fe(p.bilanz)}</strong></td></tr>`).join('')}
      <tr class="summe"><td>Gesamt (${n})</td><td class="zahl">${fe(s.kosten)}</td><td class="zahl">${fe(s.gewinn)}</td><td class="zahl ${s.bilanz >= 0 ? 'gruen' : 'rot'}">${fe(s.bilanz)}</td></tr>
    </tbody>`;
}

const betragZelle = (wert, offen) => (offen ? '<span class="warnung">offen</span>' : wert ? `<span class="gruen">${fe(wert)}</span>` : '<span class="grau">–</span>');

function renderVerlauf() {
  const alle = [...z.abrechnung.zeilen].reverse();
  const zeilen = verlaufAlle || alle.length <= VERLAUF_ANFANG + 3 ? alle : alle.slice(0, VERLAUF_ANFANG);
  const kuerzbar = alle.length > VERLAUF_ANFANG + 3;
  $('verlauf-zahl').innerHTML = alle.length
    ? `${alle.length} ${plural(alle.length, 'Spieltag', 'Spieltage')}${kuerzbar ? ` · <button class="btn sekundaer klein" type="button" id="verlauf-umschalten">${verlaufAlle ? 'Weniger anzeigen' : 'Alle anzeigen'}</button>` : ''}`
    : '';
  const spalten = z.spiel.spalten;
  const kopf = `<thead><tr><th>Datum</th><th>Gezogen</th>${spalten.map((sp) => `<th class="zahl">${esc(sp.label)}</th>`).join('')}<th class="zahl">Gewinn</th><th class="zahl">Einsatz</th><th class="zahl">Bilanz</th></tr></thead>`;
  if (!zeilen.length) {
    $('verlauf-tabelle').innerHTML = `${kopf}<tbody><tr><td class="leer" colspan="${5 + spalten.length}">Noch keine Spieltage.</td></tr></tbody>`;
    return;
  }
  const keine = '<span class="grau">–</span>';
  const zelle = {
    lotto: (a, offen) => (a ? betragZelle(a.gewinnLotto, offen) : keine),
    spiel77: (a) => (a?.spiel77 ? betragZelle(a.gewinnSpiel77, a.spiel77.offen) : keine),
    super6: (a) => (a?.super6 ? betragZelle(a.gewinnSuper6, a.super6.offen) : keine),
  };
  $('verlauf-tabelle').innerHTML = `${kopf}<tbody>${zeilen.map((r) => {
    const a = r.auswertung;
    const offenLotto = a ? a.lotto.felder.some((f) => f.offen) : false;
    const gezogen = r.ziehung
      ? `<span class="mini-zahlen"><b>${r.ziehung.nums.join(' ')}</b> · ${r.ziehung.euro ? `Euro ${r.ziehung.euro.join(' ')}` : `SZ ${r.ziehung.sz}`}</span>`
      : '<span class="grau">steht aus</span>';
    return `<tr class="klickbar${r.datum === gewaehlt ? ' gewaehlt' : ''}" data-datum="${r.datum}" tabindex="0">
      <td class="nowrap">${datumLang(r.datum)}<br>${statusMarke(r)}${bezahltMarke(r.datum)}</td>
      <td>${gezogen}</td>
      ${spalten.map((sp) => `<td class="zahl">${zelle[sp.schluessel](a, offenLotto)}</td>`).join('')}
      <td class="zahl"><strong>${r.gewinn ? fe(r.gewinn) : '–'}</strong></td>
      <td class="zahl rot">${fe(r.kosten)}</td>
      <td class="zahl ${r.saldo >= 0 ? 'gruen' : 'rot'}"><strong>${fe(r.saldo)}</strong></td>
    </tr>`;
  }).join('')}</tbody>`;
}

function waehleAusVerlauf(zeile) {
  if (!zeile?.dataset.datum) return;
  gewaehlt = zeile.dataset.datum;
  renderAbgleich();
  renderVerlauf();
  $('abgleich').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('verlauf-tabelle').addEventListener('click', (e) => waehleAusVerlauf(e.target.closest('tr')));
$('verlauf-zahl').addEventListener('click', (e) => {
  if (e.target.id !== 'verlauf-umschalten') return;
  verlaufAlle = !verlaufAlle;
  renderVerlauf();
});
$('verlauf-tabelle').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    waehleAusVerlauf(e.target.closest('tr'));
  }
});

function renderKorrekturen() {
  const admin = z.rolle === 'admin';
  const spalten = z.spiel.spalten;
  const kopf = `<thead><tr><th>Datum</th>${spalten.map((sp) => `<th class="zahl">${esc(sp.label)}</th>`).join('')}<th>Notiz</th>${admin ? '<th></th>' : ''}</tr></thead>`;
  const k = z.korrekturen;
  if (!k.length) {
    $('korrektur-tabelle').innerHTML = `${kopf}<tbody><tr><td class="leer" colspan="${spalten.length + 2 + (admin ? 1 : 0)}">Keine Korrekturen.</td></tr></tbody>`;
    return;
  }
  const betrag = (n) => (n ? `<span class="${n > 0 ? 'gruen' : 'rot'}">${fe(n)}</span>` : '<span class="grau">–</span>');
  $('korrektur-tabelle').innerHTML = `${kopf}<tbody>${k.map((x) => `<tr>
    <td class="nowrap">${datumKurz(x.datum)}</td>${spalten.map((sp) => `<td class="zahl">${betrag(x[sp.schluessel])}</td>`).join('')}
    <td class="grau">${esc(x.notiz)}</td>
    ${admin ? `<td class="zahl"><button class="btn symbol" type="button" data-loeschen="${x.id}" aria-label="Buchung löschen">✕</button></td>` : ''}</tr>`).join('')}</tbody>`;
}

$('korrektur-tabelle').addEventListener('click', async (e) => {
  const knopf = e.target.closest('[data-loeschen]');
  if (!knopf || !confirm('Diese Buchung wirklich löschen?')) return;
  try {
    z = await api('DELETE', `/api/korrekturen/${knopf.dataset.loeschen}`);
    render();
    toast('Buchung gelöscht.');
  } catch (err) { toast(err.message, true); }
});

// ---- Dialoge ----

function oeffneDialog(dialog) {
  dialog.showModal();
}
document.querySelectorAll('dialog').forEach((d) => {
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.querySelectorAll('[data-schliessen]').forEach((b) => b.addEventListener('click', () => d.close()));
});

// -- Tippschein --

let scheinWahl = 'neu';

function scheinFelderZeichnen(felder) {
  const sp = z.spiel;
  const euro = sp.feld.extra.art === 'euro';
  const beispiel = euro ? 'z. B. 3 10 16 20 30' : 'z. B. 3 10 16 20 30 41';
  $('schein-felder').innerHTML = Array.from({ length: sp.felder }, (_, i) => {
    const f = felder[i] ?? { nums: [], sz: null, euro: [] };
    const name = `Feld ${FELD_BUCHSTABEN[i]}`;
    const extra = euro
      ? `<input type="text" class="euro-eingabe" id="sf-euro-${i}" value="${(f.euro ?? []).join(' ')}" placeholder="z. B. 2 9" autocomplete="off" aria-label="${name}, Eurozahlen">`
      : `<input type="number" class="sz-eingabe" id="sf-sz-${i}" min="0" max="9" value="${f.sz ?? ''}" placeholder="0–9" aria-label="${name}, Superzahl">`;
    return `<tr><td class="feld-nr">${FELD_BUCHSTABEN[i]}</td>
      <td><input type="text" id="sf-nums-${i}" value="${f.nums.join(' ')}" placeholder="${beispiel}" autocomplete="off" aria-label="${name}, Zahlen"></td>
      <td>${extra}</td></tr>`;
  }).join('');
}

function scheinFuellen(wahl) {
  scheinWahl = wahl;
  const vorhanden = z.scheine.find((s) => String(s.id) === String(wahl));
  const vorlage = vorhanden ?? z.scheine[z.scheine.length - 1] ?? null;
  const erster = !z.scheine.length || (vorhanden && vorhanden.id === z.scheine[0].id);
  scheinFelderZeichnen(vorlage?.felder ?? []);
  $('schein-ab').value = vorhanden ? vorhanden.gueltigAb : (z.scheine.length ? z.naechsterSpieltag : z.einstellungen.startDatum);
  $('schein-losnummer').value = vorlage?.losnummer ?? '';
  $('schein-kosten').value = vorlage?.kosten ?? z.spiel.kosten;
  $('schein-spiel77').checked = vorlage?.spiel77 ?? true;
  $('schein-super6').checked = vorlage?.super6 ?? true;
  $('schein-loeschen').hidden = !vorhanden;
  $('schein-fehler').textContent = '';
  $('schein-hinweis').textContent = erster
    ? 'Der erste Schein gilt auch für alle Spieltage davor.'
    : 'Gilt ab diesem Spieltag. Frühere Spieltage werden weiter mit den bisherigen Zahlen abgerechnet.';
}

function oeffneSchein() {
  const auswahl = $('schein-auswahl');
  auswahl.innerHTML = z.scheine.map((s) => `<option value="${s.id}">ab ${datumKurz(s.gueltigAb)} · ${s.felder.filter((f) => f.nums.length).length} Felder · ${fe(s.kosten)}</option>`).join('')
    + `<option value="neu">+ Neuer Schein ab einem Spieltag …</option>`;
  const start = z.scheine.length ? String(z.scheine[z.scheine.length - 1].id) : 'neu';
  auswahl.value = start;
  scheinFuellen(start);
  oeffneDialog($('dialog-schein'));
}

$('knopf-schein').addEventListener('click', oeffneSchein);
$('schein-auswahl').addEventListener('change', (e) => scheinFuellen(e.target.value));

function scheinLesen() {
  const euro = z.spiel.feld.extra.art === 'euro';
  const zahlen = (text) => (text.trim() ? text.split(/[^0-9]+/).filter(Boolean).map(Number) : []);
  const felder = Array.from({ length: z.spiel.felder }, (_, i) => {
    const nums = zahlen($(`sf-nums-${i}`).value);
    if (euro) return { nums, euro: zahlen($(`sf-euro-${i}`).value) };
    const sz = $(`sf-sz-${i}`).value.trim();
    return { nums, sz: sz === '' ? null : Number(sz) };
  });
  return {
    gueltigAb: $('schein-ab').value,
    felder,
    losnummer: $('schein-losnummer').value,
    kosten: Number($('schein-kosten').value),
    spiel77: z.spiel.zusatz && $('schein-spiel77').checked,
    super6: z.spiel.zusatz && $('schein-super6').checked,
  };
}

$('schein-formular').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('schein-fehler').textContent = '';
  try {
    z = scheinWahl === 'neu'
      ? await api('POST', '/api/scheine', scheinLesen())
      : await api('PUT', `/api/scheine/${scheinWahl}`, scheinLesen());
    $('dialog-schein').close();
    render();
    toast('Tippschein gespeichert.');
  } catch (err) {
    $('schein-fehler').textContent = err.message;
  }
});

$('schein-loeschen').addEventListener('click', async () => {
  if (!confirm('Diesen Schein wirklich löschen? Die Abrechnung wird neu berechnet.')) return;
  try {
    z = await api('DELETE', `/api/scheine/${scheinWahl}`);
    $('dialog-schein').close();
    render();
    toast('Schein gelöscht.');
  } catch (err) {
    $('schein-fehler').textContent = err.message;
  }
});

// -- Einstellungen --

$('knopf-einstellungen').addEventListener('click', () => {
  $('einst-spieler').value = z.einstellungen.spieler.join('\n');
  $('einst-start').value = z.einstellungen.startDatum;
  $('einst-fehler').textContent = '';
  $('pw-fehler').textContent = '';
  $('adm-fehler').textContent = '';
  ['pw-neu', 'adm-alt', 'adm-neu'].forEach((id) => { $(id).value = ''; });
  $('pw-zeigen').checked = false;
  $('pw-neu').type = 'password';
  zahlungenFormular();
  oeffneDialog($('dialog-einstellungen'));
});

$('einstellungen-formular').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('einst-fehler').textContent = '';
  try {
    z = await api('PUT', '/api/einstellungen', {
      spieler: $('einst-spieler').value.split('\n').map((s) => s.trim()).filter(Boolean),
      startDatum: $('einst-start').value,
    });
    $('dialog-einstellungen').close();
    render();
    toast('Einstellungen gespeichert.');
    beobachteAbruf();
  } catch (err) {
    $('einst-fehler').textContent = err.message;
  }
});

$('passwort-formular').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('pw-fehler').textContent = '';
  try {
    await api('PUT', '/api/passwort', { neu: $('pw-neu').value });
    $('pw-neu').value = '';
    $('pw-zeigen').checked = false;
    $('pw-neu').type = 'password';
    toast('Passwort der Mitglieder geändert. Mitglieder müssen sich neu anmelden.');
  } catch (err) {
    $('pw-fehler').textContent = err.message;
  }
});

$('pw-zeigen').addEventListener('change', (e) => { $('pw-neu').type = e.target.checked ? 'text' : 'password'; });

$('admin-formular').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('adm-fehler').textContent = '';
  try {
    await api('PUT', '/api/admin-passwort', { aktuell: $('adm-alt').value, neu: $('adm-neu').value });
    $('adm-alt').value = '';
    $('adm-neu').value = '';
    toast('Admin-Passwort geändert.');
  } catch (err) {
    $('adm-fehler').textContent = err.message;
  }
});

// -- Korrekturbuchung --

$('knopf-korrektur').addEventListener('click', () => {
  $('k-datum').value = z.heute;
  ['k-lotto', 'k-spiel77', 'k-super6', 'k-notiz'].forEach((id) => { $(id).value = ''; });
  $('k-fehler').textContent = '';
  oeffneDialog($('dialog-korrektur'));
});

$('korrektur-formular').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('k-fehler').textContent = '';
  const zahl = (id) => ($(id).value === '' ? 0 : Number($(id).value));
  try {
    z = await api('POST', '/api/korrekturen', {
      datum: $('k-datum').value, lotto: zahl('k-lotto'), spiel77: zahl('k-spiel77'), super6: zahl('k-super6'), notiz: $('k-notiz').value,
    });
    $('dialog-korrektur').close();
    render();
    toast('Buchung gespeichert.');
  } catch (err) {
    $('k-fehler').textContent = err.message;
  }
});

// ---- Start ----

(async () => {
  // Welches Spiel diese Instanz rechnet, damit schon das Anmeldeformular passend beschriftet ist
  await api('GET', '/api/spiel').then(wendeSpielAn).catch(() => {});
  try {
    const { angemeldet } = await api('GET', '/api/sitzung');
    if (angemeldet) await zeigeApp();
    else zeigeAnmeldung();
  } catch {
    zeigeAnmeldung();
  }
})();
