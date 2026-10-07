/**
 * Datenbank (SQLite im Volume DATA_DIR) und alle Zugriffe darauf.
 * Gespeichert werden nur Tatsachen: Einstellungen, Tippscheine, amtliche Ziehungen,
 * Korrekturbuchungen und Sitzungen. Gewinne und Bilanz rechnet rules.js jedes Mal neu.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

// ---- Passwörter: scrypt mit zufälligem Salz, gespeichert wird nur der Hash ----

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored ?? '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(String(password), Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(actual, expected);
}

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// ---- Schema ----

import { SPIELE, leeresFeld } from './spiele.js';

/** `standard` ({ spieler, startDatum }) bestimmt nur die Vorgaben einer neuen Datenbank, vorhandene Werte bleiben. */
export function oeffneDatenbank(datei, standard = SPIELE.lotto) {
  if (datei !== ':memory:') fs.mkdirSync(path.dirname(datei), { recursive: true });
  const db = new DatabaseSync(datei);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS einstellungen (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      spieler TEXT NOT NULL,
      start_datum TEXT NOT NULL,
      passwort_hash TEXT,
      admin_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS scheine (
      id INTEGER PRIMARY KEY,
      gueltig_ab TEXT NOT NULL,
      felder TEXT NOT NULL,
      losnummer TEXT NOT NULL DEFAULT '',
      kosten REAL NOT NULL,
      spiel77 INTEGER NOT NULL DEFAULT 1,
      super6 INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS ziehungen (
      datum TEXT PRIMARY KEY,
      serie TEXT NOT NULL,
      nums TEXT NOT NULL,
      sz INTEGER,
      euro TEXT,
      spiel77 TEXT,
      super6 TEXT,
      quoten TEXT,
      quelle TEXT NOT NULL,
      geprueft TEXT,
      abgerufen_am INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS korrekturen (
      id INTEGER PRIMARY KEY,
      datum TEXT NOT NULL,
      lotto REAL NOT NULL DEFAULT 0,
      spiel77 REAL NOT NULL DEFAULT 0,
      super6 REAL NOT NULL DEFAULT 0,
      notiz TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS zahlungen (
      id INTEGER PRIMARY KEY,
      bezahlt_bis TEXT NOT NULL,
      betrag REAL NOT NULL,
      eingegangen_am TEXT NOT NULL,
      notiz TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sitzungen (
      token_hash TEXT PRIMARY KEY,
      laeuft_ab INTEGER NOT NULL,
      rolle TEXT NOT NULL DEFAULT 'mitglied'
    );

    CREATE TABLE IF NOT EXISTS meta (
      schluessel TEXT PRIMARY KEY,
      wert TEXT
    );
  `);
  // Datenbanken aus der Zeit vor den Rollen bekommen die neuen Spalten nachgerüstet.
  // Bestehende Sitzungen werden dabei zu Mitglieds-Sitzungen (geringste Rechte).
  const hatSpalte = (tabelle, spalte) => db.prepare(`PRAGMA table_info(${tabelle})`).all().some((c) => c.name === spalte);
  if (!hatSpalte('einstellungen', 'admin_hash')) db.exec('ALTER TABLE einstellungen ADD COLUMN admin_hash TEXT');
  if (!hatSpalte('ziehungen', 'euro')) db.exec('ALTER TABLE ziehungen ADD COLUMN euro TEXT');
  if (!hatSpalte('sitzungen', 'rolle')) db.exec("ALTER TABLE sitzungen ADD COLUMN rolle TEXT NOT NULL DEFAULT 'mitglied'");
  db.prepare(
    `INSERT OR IGNORE INTO einstellungen (id, spieler, start_datum) VALUES (1, ?, ?)`
  ).run(JSON.stringify(standard.spieler), standard.startDatum);
  return db;
}

// ---- Zugriffe ----

/** Füllt die Spielfelder eines Scheins auf die feste Zahl der Zeilen auf und bringt sie in die Form des Spiels. */
const feldAuffuellen = (felder, spiel) => {
  const leer = leeresFeld(spiel);
  const euro = spiel.feld.extra.art === 'euro';
  return Array.from({ length: spiel.felder }, (_, i) => {
    const f = felder?.[i] ?? leer;
    return euro
      ? { nums: f.nums ?? [], euro: f.euro ?? [] }
      : { nums: f.nums ?? [], sz: Number.isInteger(f.sz) ? f.sz : null };
  });
};

const scheinZeile = (r, spiel) => ({
  id: r.id,
  gueltigAb: r.gueltig_ab,
  felder: feldAuffuellen(JSON.parse(r.felder), spiel),
  losnummer: r.losnummer,
  kosten: r.kosten,
  spiel77: r.spiel77 === 1,
  super6: r.super6 === 1,
});

const ziehungZeile = (r) => ({
  date: r.datum,
  serie: r.serie,
  nums: JSON.parse(r.nums),
  sz: r.sz,
  euro: r.euro ? JSON.parse(r.euro) : null,
  spiel77: r.spiel77,
  super6: r.super6,
  quoten: r.quoten ? JSON.parse(r.quoten) : null,
  quelle: r.quelle,
  geprueft: r.geprueft,
  abgerufenAm: r.abgerufen_am,
});

export function erstelleStore(db, spiel = SPIELE.lotto) {
  const q = (sql) => db.prepare(sql);
  return {
    db,

    meta(schluessel) {
      return q('SELECT wert FROM meta WHERE schluessel = ?').get(schluessel)?.wert ?? null;
    },
    setzeMeta(schluessel, wert) {
      q('INSERT INTO meta (schluessel, wert) VALUES (?, ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert')
        .run(schluessel, wert === null ? null : String(wert));
    },

    einstellungen() {
      const r = q('SELECT spieler, start_datum FROM einstellungen WHERE id = 1').get();
      return { spieler: JSON.parse(r.spieler), startDatum: r.start_datum };
    },
    speichereEinstellungen({ spieler, startDatum }) {
      q('UPDATE einstellungen SET spieler = ?, start_datum = ? WHERE id = 1').run(JSON.stringify(spieler), startDatum);
    },
    /** Passwort der Mitglieder (sehen und erfassen, aber keine Einstellungen). */
    passwortHash() {
      return q('SELECT passwort_hash FROM einstellungen WHERE id = 1').get().passwort_hash;
    },
    setzePasswortHash(hash) {
      q('UPDATE einstellungen SET passwort_hash = ? WHERE id = 1').run(hash);
    },
    /** Passwort des Admins (darf zusätzlich Einstellungen und Passwörter ändern). */
    adminHash() {
      return q('SELECT admin_hash FROM einstellungen WHERE id = 1').get().admin_hash;
    },
    setzeAdminHash(hash) {
      q('UPDATE einstellungen SET admin_hash = ? WHERE id = 1').run(hash);
    },

    scheine() {
      return q('SELECT * FROM scheine ORDER BY gueltig_ab, id').all().map((r) => scheinZeile(r, spiel));
    },
    schein(id) {
      const r = q('SELECT * FROM scheine WHERE id = ?').get(id);
      return r ? scheinZeile(r, spiel) : null;
    },
    legeScheinAn(s) {
      const r = q('INSERT INTO scheine (gueltig_ab, felder, losnummer, kosten, spiel77, super6) VALUES (?, ?, ?, ?, ?, ?)')
        .run(s.gueltigAb, JSON.stringify(s.felder), s.losnummer, s.kosten, s.spiel77 ? 1 : 0, s.super6 ? 1 : 0);
      return Number(r.lastInsertRowid);
    },
    aktualisiereSchein(id, s) {
      q('UPDATE scheine SET gueltig_ab = ?, felder = ?, losnummer = ?, kosten = ?, spiel77 = ?, super6 = ? WHERE id = ?')
        .run(s.gueltigAb, JSON.stringify(s.felder), s.losnummer, s.kosten, s.spiel77 ? 1 : 0, s.super6 ? 1 : 0, id);
    },
    loescheSchein(id) {
      q('DELETE FROM scheine WHERE id = ?').run(id);
    },

    ziehungen() {
      return q('SELECT * FROM ziehungen ORDER BY datum').all().map(ziehungZeile);
    },
    ziehung(datum) {
      const r = q('SELECT * FROM ziehungen WHERE datum = ?').get(datum);
      return r ? ziehungZeile(r) : null;
    },
    speichereZiehung(z, jetzt) {
      q(`INSERT INTO ziehungen (datum, serie, nums, sz, euro, spiel77, super6, quoten, quelle, geprueft, abgerufen_am)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(datum) DO UPDATE SET serie = excluded.serie, nums = excluded.nums, sz = excluded.sz, euro = excluded.euro,
           spiel77 = excluded.spiel77, super6 = excluded.super6, quoten = excluded.quoten, quelle = excluded.quelle,
           geprueft = excluded.geprueft, abgerufen_am = excluded.abgerufen_am`)
        .run(z.date, z.serie, JSON.stringify(z.nums), z.sz ?? null, z.euro ? JSON.stringify(z.euro) : null, z.spiel77 ?? null, z.super6 ?? null,
          z.quoten ? JSON.stringify(z.quoten) : null, z.quelle, z.geprueft ?? null, jetzt);
    },

    korrekturen() {
      return q('SELECT * FROM korrekturen ORDER BY datum DESC, id DESC').all();
    },
    legeKorrekturAn(k) {
      return Number(q('INSERT INTO korrekturen (datum, lotto, spiel77, super6, notiz) VALUES (?, ?, ?, ?, ?)')
        .run(k.datum, k.lotto, k.spiel77, k.super6, k.notiz).lastInsertRowid);
    },
    loescheKorrektur(id) {
      return q('DELETE FROM korrekturen WHERE id = ?').run(id).changes > 0;
    },

    zahlungen() {
      return q('SELECT * FROM zahlungen ORDER BY bezahlt_bis, id').all().map((r) => ({
        id: r.id, bezahltBis: r.bezahlt_bis, betrag: r.betrag, eingegangenAm: r.eingegangen_am, notiz: r.notiz,
      }));
    },
    legeZahlungAn(z) {
      return Number(q('INSERT INTO zahlungen (bezahlt_bis, betrag, eingegangen_am, notiz) VALUES (?, ?, ?, ?)')
        .run(z.bezahltBis, z.betrag, z.eingegangenAm, z.notiz).lastInsertRowid);
    },
    loescheZahlung(id) {
      return q('DELETE FROM zahlungen WHERE id = ?').run(id).changes > 0;
    },

    legeSitzungAn(tokenHash, laeuftAb, rolle = 'mitglied') {
      q('INSERT INTO sitzungen (token_hash, laeuft_ab, rolle) VALUES (?, ?, ?)').run(tokenHash, laeuftAb, rolle);
    },
    sitzung(tokenHash) {
      const r = q('SELECT laeuft_ab, rolle FROM sitzungen WHERE token_hash = ?').get(tokenHash);
      return r ? { laeuftAb: r.laeuft_ab, rolle: r.rolle } : null;
    },
    verlaengereSitzung(tokenHash, laeuftAb) {
      q('UPDATE sitzungen SET laeuft_ab = ? WHERE token_hash = ?').run(laeuftAb, tokenHash);
    },
    beendeSitzung(tokenHash) {
      q('DELETE FROM sitzungen WHERE token_hash = ?').run(tokenHash);
    },
    /** Beendet alle Sitzungen einer Rolle, optional bis auf eine (die eigene). */
    beendeSitzungen(rolle, ausser = null) {
      q('DELETE FROM sitzungen WHERE rolle = ? AND token_hash != ?').run(rolle, ausser ?? '');
    },
    beendeAlleSitzungen() {
      q('DELETE FROM sitzungen').run();
    },
    raeumeSitzungenAuf(jetzt) {
      q('DELETE FROM sitzungen WHERE laeuft_ab < ?').run(jetzt);
    },
  };
}
