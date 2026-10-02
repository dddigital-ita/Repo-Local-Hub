#!/usr/bin/env node
// CLI della guard della porta E2E (il guard è anche globalSetup di
// Playwright, ma come script da riga di comando serve a controllare a mano
// PRIMA di lanciare la suite — o in CI come step dedicato):
//
//   node scripts/e2e-port-guard-cli.mjs [porta]
//
// Exit 0 = porta libera o solo processi di questo repo. Exit 1 = processo
// estraneo in ascolto (stampa pid, cwd e rimedio). Senza argomento usa la
// porta da WAC_E2E_PORT, poi quella derivata dal percorso (scripts/e2e-port.cjs).
//
// Questo wrapper esiste perché il guard è importato da playwright.config.ts
// (catena compilata come CJS: niente import.meta lì) — qui Node esegue un
// ESM vero e il confronto argv funziona.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const qui = path.dirname(fileURLToPath(import.meta.url));
const argPorta = Number(process.argv[2]);
const { default: runPortGuard, portaE2ERepo } = await import(
  pathToFileURL(path.join(qui, "e2e-port-guard.mjs")).href
);

try {
  // Read-only: la verifica a mano NON acquisisce il lock (che poi non
  // rilascerebbe) — per quello c'è la run Playwright, col suo teardown.
  runPortGuard(Number.isFinite(argPorta) && argPorta > 0 ? argPorta : undefined, { lock: false });
  console.log(`✓ e2e-port-guard: porta pulita (libera o solo processi di questo repo) — default ${portaE2ERepo()}.`);
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exit(1);
}
