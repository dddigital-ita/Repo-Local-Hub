#!/usr/bin/env node
/**
 * Dev server dell'E2E: carica .env.e2e NEL processo e lancia next dev.
 *
 * Perché non `node --env-file`: Playwright passa NODE_OPTIONS ai figli e
 * Node rifiuta --env-file in NODE_OPTIONS. Qui le variabili sono lette con
 * readFile e messe in process.env PRIMA dell'import di Next: nessuna option
 * da riga di comando, nessun conflitto.
 *
 * Uso (è il webServer di playwright.config.ts):
 *   WAC_DIST_DIR=.next-e2e PORT=3100 node scripts/e2e-dev-server.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const envFile = path.join(process.cwd(), ".env.e2e");
for (const line of readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

await import("next/dist/bin/next");
