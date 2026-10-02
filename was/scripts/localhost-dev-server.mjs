#!/usr/bin/env node
/**
 * Dev server per istanze localhost NON primarie (quelle create dall'installer
 * con --env=.env.localhost-XXXX). Carica il file env NEL processo prima di
 * importare Next — stesso schema di scripts/e2e-dev-server.mjs (un runner
 * esterno può passare NODE_OPTIONS ai figli e Node rifiuta --env-file in
 * NODE_OPTIONS: qui le variabili sono lette con readFile e messe in
 * process.env PRIMA dell'import di Next, nessuna option da riga di comando).
 *
 *   node scripts/localhost-dev-server.mjs -p 3300
 *   WAC_ENV_FILE=.env.localhost-3300 node scripts/localhost-dev-server.mjs -p 3300
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const envArg = process.argv.find((a) => a.startsWith("--env="))?.split("=").slice(1).join("=");
const envFile = path.join(process.cwd(), envArg ?? process.env.WAC_ENV_FILE ?? ".env.local");

for (const line of readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
console.log(`> env caricata: ${path.basename(envFile)} (DATABASE_URL → ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":••••@") ?? "manca"})`);

await import("next/dist/bin/next");
