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
 */
const next = require("next");
const http = require("http");

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
    console.error("Errore d'avvio:", err);
    process.exit(1);
  });
