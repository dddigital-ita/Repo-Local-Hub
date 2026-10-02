/* eslint-disable @typescript-eslint/no-require-imports --
 * File di boot CommonJS per Passenger: gira sotto Node puro, fuori dal
 * compiler di Next, quindi require() è l'unico modo (niente build step). */

/**
 * SERVER.JS — punto d'ingresso per cPanel "Setup Node.js App" (Phusion
 * Passenger). Passenger vuole un file che avvii un server HTTP su una porta
 * assegnata dall'hosting: Next standalone non è configurato nel progetto
 * (la build è quella standard), quindi qui facciamo partire `next start`
 * programmaticamente, lasciando a Passenger la gestione di porta, processo
 * e riavvii.
 *
 * Variabili lette dall'interfaccia "Setup Node.js App":
 *   PORT            — impostata da Passenger (default 3000 in locale)
 *   NODE_ENV        — impostare "production" nel pannello
 *
 * Il resto delle env (DATABASE_URL, ADMIN_SESSION_SECRET, …) vive in
 * .env.local nella root dell'app: Next lo carica da solo in produzione
 * come fa in sviluppo, quindi il wizard può scriverlo senza restart.
 *
 * ── BOOT GUARD (lezione dell'incidente del 28/09/2026) ─────────────────
 * Se l'app viene registrata per errore nella docroot del sito principale
 * (public_html con WordPress), il solo avvio copre tutte le rotte PHP e
 * mette offline i siti WordPress. Da quel giorno server.js RIFIUTA
 * l'avvio quando rileva una docroot che sembra di WordPress, a meno che
 * l'operatore non forzi consapevolmente con WAC_ALLOW_ANY_DOCROOT=1.
 *
 * Il rilevamento è euristico sul CONTENUTO della cartella (mai sul nome):
 * servono almeno 2 marker WP indipendenti, così una cartella nostra non
 * può mai superare la soglia.
 */
const fs = require("fs");
const path = require("path");
const http = require("http");

const APP_DIR = __dirname;

/** Path noti che non devono MAI ospitare l'app (regola del 28/09). */
const FORBIDDEN_PATH_SEGMENTS = ["public_html", "www", "htdocs"];

function detectWpMarkers(dir) {
  const found = [];
  try {
    if (fs.existsSync(path.join(dir, "wp-config.php"))) found.push("wp-config.php");
    if (fs.existsSync(path.join(dir, "wp-settings.php"))) found.push("wp-settings.php");
    if (fs.statSync(path.join(dir, "wp-admin")).isDirectory()) found.push("wp-admin/");
    if (fs.statSync(path.join(dir, "wp-includes")).isDirectory()) found.push("wp-includes/");
    if (fs.statSync(path.join(dir, "wp-content")).isDirectory()) found.push("wp-content/");
  } catch {
    // permessi di lettura parziali: bastano i marker già trovati
  }
  return found;
}

function bootGuardFailure(reason, detail) {
  console.error("==============================================================");
  console.error("AVVIO RIFIUTATO — " + reason);
  console.error(detail);
  console.error("");
  console.error("Perché: avviare l'app qui metterebbe offline il sito WordPress");
  console.error("presente nella stessa cartella (Passenger intercetta tutto).");
  console.error("");
  console.error("Procedura corretta (DEPLOY-CPANEL.md, Parte 0):");
  console.error("  1. cPanel → Domains → crea un sottodominio dedicato");
  console.error("     (es. app.tuodominio.com) con docroot PROPRIO,");
  console.error("     MAI public_html né il dominio principale.");
  console.error("  2. Setup Node.js App: Application root = la cartella del");
  console.error("     sottodominio, Application URL = il sottodominio.");
  console.error("  3. Prima di registrare: node scripts/deploy-preflight.mjs");
  console.error("");
  console.error("Se sai ciò che fai e la cartella NON ospita davvero un sito");
  console.error("WordPress: WAC_ALLOW_ANY_DOCROOT=1 nelle env dell'app.");
  console.error("==============================================================");
  process.exit(1);
}

function runBootGuard() {
  // 1) Vietato per nome: public_html e affini (la regola dell'incidente).
  const abs = APP_DIR.split(path.sep);
  const hitSegment = FORBIDDEN_PATH_SEGMENTS.find(
    (seg) => abs.includes(seg) || abs.some((p) => p.toLowerCase() === seg.toLowerCase()),
  );
  if (hitSegment && process.env.WAC_ALLOW_ANY_DOCROOT !== "1") {
    bootGuardFailure(
      `l'app vive dentro una cartella vietata ("${hitSegment}")`,
      `Percorso corrente: ${APP_DIR}`,
    );
  }

  // 2) Vietato per contenuto: docroot con dentro un WordPress.
  const markers = detectWpMarkers(APP_DIR);
  const WP_THRESHOLD = 2;
  if (markers.length >= WP_THRESHOLD && process.env.WAC_ALLOW_ANY_DOCROOT !== "1") {
    bootGuardFailure(
      `la cartella contiene un'installazione WordPress`,
      `Marker trovati: ${markers.join(", ")} — Percorso: ${APP_DIR}`,
    );
  }

  // 3) Avviso (non blocco): pochi marker WP, situazione ambigua.
  if (markers.length > 0 && process.env.WAC_ALLOW_ANY_DOCROOT !== "1") {
    console.warn(`> AVVISO boot guard: marker WordPress parziali nella docroot (${markers.join(", ")}). Verifica su cPanel → Domains che questa cartella non sia la docroot del sito principale.`);
  }
}

runBootGuard();

const next = require("next");

const port = Number(process.env.PORT) || 3000;
const hostname = process.env.HOSTNAME || "0.0.0.0";

const app = next({ dev: false, dir: __dirname });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    http
      .createServer((req, res) => {
        handle(req, res);
      })
      .listen(port, hostname, () => {
        console.log(`> Ready on http://${hostname}:${port} (NODE_ENV=${process.env.NODE_ENV || "development"})`);
      });
  })
  .catch((err) => {
    console.error("Avvio Next fallito:", err);
    process.exit(1);
  });
