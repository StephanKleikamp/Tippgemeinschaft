// Seitenzählung (Cockpit auf stats.stephan-kleikamp.de): jede Instanz trägt ihre eigene Kennung in den Tracker-Tag ein.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPIELE } from '../server/spiele.js';
import { erstelleSync } from '../server/sync.js';
import { erstelleApp } from '../server/app.js';
import { neuerStore, stubQuellen, stilleLogs } from './helpers.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

async function lade(spiel) {
  const store = await neuerStore({ spiel });
  const sync = erstelleSync({ store, quellen: stubQuellen(), spiel, jetzt: () => Date.parse('2026-10-06T10:00:00Z'), log: stilleLogs, pause: 0 });
  const app = erstelleApp({ store, sync, spiel, sicheresCookie: false, publicDir: PUBLIC });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const basis = `http://127.0.0.1:${server.address().port}`;
  const antworten = await Promise.all(['/', '/index.html'].map((p) => fetch(basis + p)));
  const html = await Promise.all(antworten.map((a) => a.text()));
  const csp = antworten[0].headers.get('content-security-policy');
  await new Promise((r) => server.close(r));
  return { html, csp };
}

for (const id of ['lotto', 'eurojackpot']) {
  test(`${id}: Tracker-Tag mit eigener Kennung, data-minimal, CSP erlaubt die Statistik-Adresse`, async () => {
    const { html, csp } = await lade(SPIELE[id]);
    for (const h of html) {
      assert.match(h, new RegExp(`<script defer src="https://stats\\.stephan-kleikamp\\.de/tracker\\.js" data-app="${id}" data-minimal></script>`));
      assert.ok(!h.includes('__TRACKER_APP__'), 'kein Platzhalter mehr');
    }
    assert.match(csp, /script-src 'self' https:\/\/stats\.stephan-kleikamp\.de;/);
    assert.match(csp, /connect-src 'self' https:\/\/stats\.stephan-kleikamp\.de;/);
  });
}
