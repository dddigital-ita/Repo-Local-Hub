#!/usr/bin/env node
// CLI di stato del lock E2E (niente side-effect):
//   node scripts/e2e-lock-cli.mjs [porta]
//
// Exit 0 sempre (è una lettura); lo STATO lo dice la prima riga:
//   LIBERO · OCCUPATO (chi, pid, da quanto) · STANTIO (si cura da solo)
// Senza argomento: porta da WAC_E2E_PORT, poi derivata dal percorso.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const qui = path.dirname(fileURLToPath(import.meta.url));
const argPorta = Number(process.argv[2]);
const { statoLock, portaE2ERepo } = await import(
  pathToFileURL(path.join(qui, "e2e-lock.mjs")).href
);

console.log(statoLock(Number.isFinite(argPorta) && argPorta > 0 ? argPorta : undefined));
console.log(`(porta default del repo: ${portaE2ERepo()})`);
