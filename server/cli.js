/**
 * Verwaltung im Container (Coolify: Terminal der App):
 *   node server/cli.js passwort <neues-passwort>   setzt ein neues Passwort und beendet alle Anmeldungen
 *   node server/cli.js status                      zeigt Scheine, Ziehungen und den letzten Abruf
 */
import path from 'node:path';
import { oeffneDatenbank, erstelleStore, hashPassword } from './db.js';

const store = erstelleStore(oeffneDatenbank(path.join(process.env.DATA_DIR || '/data', 'tipp.db')));
const [befehl, argument] = process.argv.slice(2);

if (befehl === 'passwort') {
  if (!argument || argument.length < 8) {
    console.error('Aufruf: node server/cli.js passwort <neues-passwort mit mindestens 8 Zeichen>');
    process.exit(1);
  }
  store.setzePasswortHash(await hashPassword(argument));
  store.beendeAlleSitzungen();
  console.log('Passwort geändert, alle Anmeldungen beendet.');
} else if (befehl === 'status') {
  const ziehungen = store.ziehungen().filter((z) => z.serie === 'Samstag');
  const zeit = (ms) => (ms ? new Date(Number(ms)).toISOString() : '-');
  console.log(`Einstellungen: ${JSON.stringify(store.einstellungen())}`);
  console.log(`Scheine: ${store.scheine().length}, Samstagsziehungen: ${ziehungen.length} (davon endgültig: ${ziehungen.filter((z) => z.quoten).length})`);
  console.log(`Letzter Abruf: ${zeit(store.meta('sync_versuch'))}, letzter Erfolg: ${zeit(store.meta('sync_erfolg'))}, Fehler: ${store.meta('sync_fehler') || '-'}`);
} else {
  console.error('Befehle: passwort <neues-passwort> | status');
  process.exit(1);
}
