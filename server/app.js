/**
 * Die Web-App: Anmeldung per gemeinsamem Passwort, JSON-Schnittstelle unter /api und die statischen Seiten.
 * Läuft ohne Zugriffsprotokoll; IP-Adressen werden nur als Hash für die Bremse gegen Passwort-Raten
 * höchstens 10 Minuten im Arbeitsspeicher gehalten (siehe Datenschutzerklärung).
 */
import crypto from 'node:crypto';
import express from 'express';
import { hashPassword, verifyPassword, sha256, ANZAHL_FELDER } from './db.js';
import { baueAbrechnung } from './rules.js';
import { berlinHeute, naechsterSpieltag } from './sync.js';

const COOKIE = 'tipp_session';
const SITZUNG_TAGE = 30;
const MAX_FEHLVERSUCHE = 8;
const SPERRE_MS = 10 * 60 * 1000;

class Eingabefehler extends Error {}
const ungueltig = (nachricht) => { throw new Eingabefehler(nachricht); };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function istDatum(s) {
  return typeof s === 'string' && ISO.test(s) && s >= '2000-01-01' && s <= '2100-01-01'
    && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
}

const runden = (n) => Math.round(n * 100) / 100;

// ---- Eingaben prüfen ----

export function pruefeSchein(body) {
  if (!istDatum(body?.gueltigAb)) ungueltig('Bitte ein gültiges Datum „gilt ab“ angeben.');
  if (!Array.isArray(body.felder) || body.felder.length > ANZAHL_FELDER) ungueltig(`Höchstens ${ANZAHL_FELDER} Spielfelder.`);

  const felder = body.felder.map((f, i) => {
    const nums = Array.isArray(f?.nums) ? f.nums : [];
    if (nums.length === 0) return { nums: [], sz: null };
    if (nums.length !== 6) ungueltig(`Spielfeld ${i + 1}: genau 6 Zahlen eingeben.`);
    if (!nums.every((n) => Number.isInteger(n) && n >= 1 && n <= 49)) ungueltig(`Spielfeld ${i + 1}: Zahlen von 1 bis 49.`);
    if (new Set(nums).size !== 6) ungueltig(`Spielfeld ${i + 1}: keine Zahl doppelt.`);
    if (!Number.isInteger(f.sz) || f.sz < 0 || f.sz > 9) ungueltig(`Spielfeld ${i + 1}: Superzahl von 0 bis 9.`);
    return { nums: [...nums].sort((a, b) => a - b), sz: f.sz };
  });
  if (!felder.some((f) => f.nums.length)) ungueltig('Mindestens ein Spielfeld mit 6 Zahlen und Superzahl eingeben.');

  const losnummer = String(body.losnummer ?? '').replace(/\s+/g, '');
  const spiel77 = body.spiel77 === true;
  const super6 = body.super6 === true;
  if (losnummer && !/^\d{7}$/.test(losnummer)) ungueltig('Die Scheinnummer hat 7 Ziffern.');
  if ((spiel77 || super6) && !losnummer) ungueltig('Für Spiel 77 und Super 6 wird die Scheinnummer (7 Ziffern) gebraucht.');

  const kosten = Number(body.kosten);
  if (!(kosten > 0 && kosten <= 500)) ungueltig('Die Kosten pro Woche müssen zwischen 0,01 und 500 € liegen.');

  return { gueltigAb: body.gueltigAb, felder, losnummer, kosten: runden(kosten), spiel77, super6 };
}

export function pruefeEinstellungen(body) {
  const spieler = Array.isArray(body?.spieler) ? body.spieler.map((s) => String(s ?? '').trim()) : [];
  if (spieler.length < 2 || spieler.length > 10) ungueltig('Bitte 2 bis 10 Mitspieler eintragen.');
  if (spieler.some((s) => !s || s.length > 30)) ungueltig('Jeder Name braucht 1 bis 30 Zeichen.');
  if (!istDatum(body.startDatum)) ungueltig('Bitte ein gültiges Startdatum angeben.');
  return { spieler, startDatum: body.startDatum };
}

export function pruefeKorrektur(body) {
  const betrag = (wert, name) => {
    const n = Number(wert ?? 0);
    if (!Number.isFinite(n) || Math.abs(n) > 1e7) ungueltig(`${name}: ungültiger Betrag.`);
    return runden(n);
  };
  if (!istDatum(body?.datum)) ungueltig('Bitte ein gültiges Datum angeben.');
  const k = {
    datum: body.datum,
    lotto: betrag(body.lotto, '6aus49'),
    spiel77: betrag(body.spiel77, 'Spiel 77'),
    super6: betrag(body.super6, 'Super 6'),
    notiz: String(body.notiz ?? '').trim().slice(0, 80),
  };
  if (k.lotto + k.spiel77 + k.super6 === 0) ungueltig('Bitte mindestens einen Betrag eintragen (Abzüge mit Minus).');
  return k;
}

// ---- App ----

export function erstelleApp({ store, sync, jetzt = () => Date.now(), sicheresCookie = true, publicDir }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; "
      + "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));
  app.use(express.json({ limit: '50kb' }));

  // Schutz vor fremden Seiten: Schreibzugriffe nur von der eigenen Adresse
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const herkunft = req.headers['sec-fetch-site'];
    if (herkunft && herkunft !== 'same-origin' && herkunft !== 'none') return res.status(403).json({ error: 'Anfrage von fremder Seite.' });
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Anfrage von fremder Seite.' });
      } catch {
        return res.status(403).json({ error: 'Ungültige Herkunft.' });
      }
    }
    next();
  });

  // ---- Sitzungen ----

  const lesenCookie = (req) => {
    const paar = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
    return paar ? decodeURIComponent(paar.slice(COOKIE.length + 1)) : null;
  };
  const setzeCookie = (res, token, sekunden) => res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sekunden}${sicheresCookie ? '; Secure' : ''}`);

  function aktuelleSitzung(req, res) {
    const token = lesenCookie(req);
    if (!token) return null;
    const hash = sha256(token);
    const laeuftAb = store.sitzung(hash);
    if (!laeuftAb || laeuftAb < jetzt()) return null;
    // Gleitende Laufzeit: wer die App nutzt, bleibt angemeldet
    if (laeuftAb - jetzt() < (SITZUNG_TAGE / 2) * 86400000) {
      store.verlaengereSitzung(hash, jetzt() + SITZUNG_TAGE * 86400000);
      setzeCookie(res, token, SITZUNG_TAGE * 86400);
    }
    return hash;
  }

  // Bremse gegen Passwort-Raten: Hash der IP mit zufälligem Salz, nur im Arbeitsspeicher
  const salz = crypto.randomBytes(16).toString('hex');
  const fehlversuche = new Map();
  const schluessel = (req) => sha256(salz + req.ip);
  const gesperrtFuer = (key) => {
    const e = fehlversuche.get(key);
    return e && e.bis > jetzt() ? Math.ceil((e.bis - jetzt()) / 60000) : 0;
  };
  const merkeFehlversuch = (key) => {
    for (const [k, e] of fehlversuche) if (e.bis < jetzt() && e.zuletzt < jetzt() - SPERRE_MS) fehlversuche.delete(k);
    const e = fehlversuche.get(key) ?? { anzahl: 0, bis: 0, zuletzt: 0 };
    e.anzahl += 1;
    e.zuletzt = jetzt();
    if (e.anzahl >= MAX_FEHLVERSUCHE) { e.anzahl = 0; e.bis = jetzt() + SPERRE_MS; }
    fehlversuche.set(key, e);
  };

  store.raeumeSitzungenAuf(jetzt());
  const aufraeumen = setInterval(() => store.raeumeSitzungenAuf(jetzt()), 12 * 3600000);
  aufraeumen.unref();

  app.get('/api/sitzung', (req, res) => res.json({ angemeldet: Boolean(aktuelleSitzung(req, res)) }));

  app.post('/api/anmelden', async (req, res) => {
    const key = schluessel(req);
    const minuten = gesperrtFuer(key);
    if (minuten) return res.status(429).json({ error: `Zu viele Versuche. Bitte in ${minuten} Minute${minuten === 1 ? '' : 'n'} erneut versuchen.` });
    const passwort = typeof req.body?.passwort === 'string' ? req.body.passwort : '';
    if (!passwort || passwort.length > 200 || !(await verifyPassword(passwort, store.passwortHash()))) {
      merkeFehlversuch(key);
      return res.status(401).json({ error: 'Falsches Passwort.' });
    }
    fehlversuche.delete(key);
    const token = crypto.randomBytes(32).toString('base64url');
    store.legeSitzungAn(sha256(token), jetzt() + SITZUNG_TAGE * 86400000);
    setzeCookie(res, token, SITZUNG_TAGE * 86400);
    res.json({ ok: true });
  });

  app.use('/api', (req, res, next) => {
    const sitzung = aktuelleSitzung(req, res);
    if (!sitzung) return res.status(401).json({ error: 'Nicht angemeldet.' });
    req.sitzung = sitzung;
    next();
  });

  app.post('/api/abmelden', (req, res) => {
    store.beendeSitzung(req.sitzung);
    setzeCookie(res, '', 0);
    res.json({ ok: true });
  });

  // ---- Daten ----

  function zustand() {
    const { spieler, startDatum } = store.einstellungen();
    const heute = berlinHeute(jetzt());
    const korrekturen = store.korrekturen();
    const abrechnung = baueAbrechnung({
      ziehungen: store.ziehungen(), scheine: store.scheine(), startDatum, heute, korrekturen, spieler,
    });
    return {
      heute,
      naechsterSpieltag: naechsterSpieltag(jetzt()),
      einstellungen: { spieler, startDatum },
      scheine: store.scheine(),
      korrekturen,
      abrechnung,
      sync: sync.status(),
    };
  }

  app.get('/api/zustand', (req, res) => res.json(zustand()));

  app.put('/api/einstellungen', (req, res) => {
    const neu = pruefeEinstellungen(req.body);
    const alt = store.einstellungen();
    store.speichereEinstellungen(neu);
    if (neu.startDatum < alt.startDatum) sync.starte('startdatum');
    res.json(zustand());
  });

  function pruefeEindeutig(s, ausserId = null) {
    if (store.scheine().some((x) => x.gueltigAb === s.gueltigAb && x.id !== ausserId)) {
      ungueltig('Für dieses Datum gibt es schon einen Schein. Bitte den vorhandenen bearbeiten.');
    }
  }

  app.post('/api/scheine', (req, res) => {
    const s = pruefeSchein(req.body);
    pruefeEindeutig(s);
    store.legeScheinAn(s);
    res.json(zustand());
  });

  app.put('/api/scheine/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!store.schein(id)) return res.status(404).json({ error: 'Schein nicht gefunden.' });
    const s = pruefeSchein(req.body);
    pruefeEindeutig(s, id);
    store.aktualisiereSchein(id, s);
    res.json(zustand());
  });

  app.delete('/api/scheine/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!store.schein(id)) return res.status(404).json({ error: 'Schein nicht gefunden.' });
    store.loescheSchein(id);
    res.json(zustand());
  });

  app.post('/api/korrekturen', (req, res) => {
    store.legeKorrekturAn(pruefeKorrektur(req.body));
    res.json(zustand());
  });

  app.delete('/api/korrekturen/:id', (req, res) => {
    if (!store.loescheKorrektur(Number(req.params.id))) return res.status(404).json({ error: 'Buchung nicht gefunden.' });
    res.json(zustand());
  });

  app.post('/api/abruf', (req, res) => {
    const status = sync.status();
    const kuerzlich = status.letzterVersuch && jetzt() - status.letzterVersuch < 30000;
    if (!status.laeuft && !kuerzlich) sync.starte('manuell');
    res.json({ gestartet: !status.laeuft && !kuerzlich, sync: sync.status() });
  });

  app.put('/api/passwort', async (req, res) => {
    const { aktuell, neu } = req.body ?? {};
    if (typeof aktuell !== 'string' || !(await verifyPassword(aktuell, store.passwortHash()))) {
      return res.status(401).json({ error: 'Das aktuelle Passwort stimmt nicht.' });
    }
    if (typeof neu !== 'string' || neu.length < 8 || neu.length > 200) ungueltig('Das neue Passwort braucht mindestens 8 Zeichen.');
    store.setzePasswortHash(await hashPassword(neu));
    store.beendeAlleSitzungen(req.sitzung);
    res.json({ ok: true });
  });

  app.all('/api/*splat', (req, res) => res.status(404).json({ error: 'Unbekannte Adresse.' }));

  // ---- Seiten ----

  app.use(express.static(publicDir, { index: 'index.html', maxAge: 0, etag: true }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof Eingabefehler) return res.status(400).json({ error: err.message });
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') return res.status(400).json({ error: 'Ungültige Daten.' });
    console.error('[app]', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  });

  return app;
}
