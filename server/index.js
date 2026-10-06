/**
 * Startpunkt: Datenbank öffnen, Passwort sicherstellen, Zeitgeber für Abruf und Sicherung starten, Server hochfahren.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { oeffneDatenbank, erstelleStore, hashPassword } from './db.js';
import { erstelleQuellen } from './sources.js';
import { erstelleSync } from './sync.js';
import { planeSicherung } from './backup.js';
import { erstelleApp } from './app.js';

const hier = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || '/data';
const PORT = Number(process.env.PORT) || 3000;

const db = oeffneDatenbank(path.join(DATA_DIR, 'tipp.db'));
const store = erstelleStore(db);

// Erstes Passwort: aus INITIAL_PASSWORD, sonst zufällig und einmalig im Log. Danach zählt nur der Hash in der Datenbank.
if (!store.passwortHash()) {
  let passwort = process.env.INITIAL_PASSWORD;
  const erzeugt = !passwort || passwort.length < 8;
  if (erzeugt) passwort = crypto.randomBytes(12).toString('base64url');
  store.setzePasswortHash(await hashPassword(passwort));
  if (erzeugt) console.log(`Erstes Passwort (bitte nach der Anmeldung ändern): ${passwort}`);
}

const sync = erstelleSync({ store, quellen: erstelleQuellen() });
const stoppeSync = sync.plane();
const stoppeSicherung = planeSicherung(db, path.join(DATA_DIR, 'backups'));

const app = erstelleApp({
  store,
  sync,
  sicheresCookie: process.env.COOKIE_INSECURE !== '1', // nur für lokale Tests ohne HTTPS
  publicDir: path.join(hier, '..', 'public'),
});

const server = app.listen(PORT, '0.0.0.0', () => console.log(`Tippgemeinschaft läuft auf Port ${PORT}`));

const beenden = () => {
  stoppeSync();
  stoppeSicherung();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', beenden);
process.on('SIGINT', beenden);
