/**
 * Verwaltung im Container (Coolify: Terminal der App):
 *   node server/cli.js passwort <neues-passwort>         neues Passwort der Mitglieder, beendet deren Anmeldungen
 *   node server/cli.js admin-passwort <neues-passwort>   neues Admin-Passwort, beendet alle Admin-Anmeldungen
 *   node server/cli.js status                      zeigt Scheine, Ziehungen und den letzten Abruf
 */
import path from 'node:path';
import { oeffneDatenbank, erstelleStore, hashPassword } from './db.js';
import { waehleSpiel } from './spiele.js';

const spiel = waehleSpiel(process.env.SPIEL || 'lotto');
const store = erstelleStore(oeffneDatenbank(path.join(process.env.DATA_DIR || '/data', 'tipp.db'), spiel), spiel);
const [befehl, argument] = process.argv.slice(2);

if (befehl === 'passwort' || befehl === 'admin-passwort') {
  if (!argument || argument.length < 8) {
    console.error(`Aufruf: node server/cli.js ${befehl} <neues-passwort mit mindestens 8 Zeichen>`);
    process.exit(1);
  }
  const admin = befehl === 'admin-passwort';
  const hash = await hashPassword(argument);
  if (admin) store.setzeAdminHash(hash);
  else store.setzePasswortHash(hash);
  store.beendeSitzungen(admin ? 'admin' : 'mitglied');
  console.log(`${admin ? 'Admin-Passwort' : 'Passwort der Mitglieder'} geändert, die zugehörigen Anmeldungen sind beendet.`);
} else if (befehl === 'status') {
  const ziehungen = store.ziehungen().filter((z) => z.serie === spiel.serie);
  const zeit = (ms) => (ms ? new Date(Number(ms)).toISOString() : '-');
  console.log(`Einstellungen: ${JSON.stringify(store.einstellungen())}`);
  console.log(`Spiel: ${spiel.name}, Scheine: ${store.scheine().length}, Ziehungen am ${spiel.serie}: ${ziehungen.length} (davon endgültig: ${ziehungen.filter((z) => z.quoten).length})`);
  console.log(`Letzter Abruf: ${zeit(store.meta('sync_versuch'))}, letzter Erfolg: ${zeit(store.meta('sync_erfolg'))}, Fehler: ${store.meta('sync_fehler') || '-'}`);
} else {
  console.error('Befehle: passwort <neues-passwort> | admin-passwort <neues-passwort> | status');
  process.exit(1);
}
