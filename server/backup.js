/**
 * Tägliche Sicherung der Datenbank: eine konsistente Kopie (VACUUM INTO) je Tag im Ordner
 * DATA_DIR/backups, die letzten 7 bleiben liegen. Die Datei lässt sich direkt als tipp.db zurückspielen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { berlinHeute, berlinMinuten } from './sync.js';

const NAME = /^tipp-\d{4}-\d{2}-\d{2}\.db$/;

export function sichere(db, ordner, heute, behalten = 7) {
  fs.mkdirSync(ordner, { recursive: true });
  const ziel = path.join(ordner, `tipp-${heute}.db`);
  let neu = false;
  if (!fs.existsSync(ziel)) {
    db.prepare('VACUUM INTO ?').run(ziel);
    neu = true;
  }
  const alle = fs.readdirSync(ordner).filter((n) => NAME.test(n)).sort().reverse();
  for (const alt of alle.slice(behalten)) fs.rmSync(path.join(ordner, alt), { force: true });
  return { datei: ziel, neu };
}

/**
 * Stündlich prüfen, gesichert wird ab 3 Uhr morgens (Berlin) einmal je Tag, damit die Kopie den Vortag vollständig enthält.
 * Gibt es noch gar keine Sicherung, entsteht sofort eine.
 */
export function planeSicherung(db, ordner, log = console) {
  const tick = () => {
    try {
      const hatSicherung = fs.existsSync(ordner) && fs.readdirSync(ordner).some((n) => NAME.test(n));
      if (hatSicherung && berlinMinuten() < 180) return;
      const r = sichere(db, ordner, berlinHeute());
      if (r.neu) log.log?.(`[backup] ${r.datei}`);
    } catch (e) {
      log.error?.('[backup] fehlgeschlagen:', e.message);
    }
  };
  const erster = setTimeout(tick, 15000);
  const intervall = setInterval(tick, 3600 * 1000);
  erster.unref();
  intervall.unref();
  return () => { clearTimeout(erster); clearInterval(intervall); };
}
