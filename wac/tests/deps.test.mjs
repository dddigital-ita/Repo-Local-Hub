/**
 * SENTINELLA DELLE DIPENDENZE — i pacchetti su cui il progetto si regge
 * devono restare dichiarati nel manifest, bloccati nel lockfile e
 * risolvibili a runtime.
 *
 * Due gruppi, due esigenze diverse:
 * - CRITICHE: la base su cui gira tutto (next/react per l'app, pg/neon per
 *   il DB). Ognuna ha una versione MINIMA: la sentinella fallisce se una
 *   pulizia futura aggiorna sotto quella soglia o la elimina.
 * - EMOJI + ICONE: frimousse (il picker della chat, scelto dopo il confronto
 *   con emoji-picker-react ed emoji-mart) e le due famiglie di icone del
 *   registry admin (@phosphor-icons/react, @tabler/icons-react).
 *
 * TOMBSTONE: emoji-picker-react ed emoji-mart sono stati RIMOSSI nel
 * cleanup del picker (frimousse è la scelta definitiva, commit 8e5c37c).
 * Un test qui sotto li sorveglia: se qualcuno li rimette nel manifest
 * senza usarli, la suite fallisce e la dipendenza morta torna alla luce.
 *
 * Il test verifica i TRE livelli dove una dipendenza può rompersi:
 * 1. `package.json` la dichiara in `dependencies` (servono a runtime nel
 *    bundle, non sono devDependencies) e rispetta la versione minima;
 * 2. `package-lock.json` la ha bloccata — se il manifest e il lockfile
 *    divergono, l'installazione pulita (deploy, CI) fallisce PRIMA del
 *    deploy, non dopo;
 * 3. ogni entry point si importa davvero con Node dal repo — l'exports
 *    map può essere corretta a occhio e rotta a runtime (vedi i deep
 *    import Phosphor, necessari sotto `moduleResolution: NodeNext`).
 *
 * NOTA: `drizzle` e `ai` NON fanno parte dello stack di questo progetto
 * (il DB è pg + neon serverless, la rotta AI è custom): se qualcuno li
 * aggiungerà davvero, andranno inseriti qui con la loro soglia minima.
 *
 * Esecuzione: `npm test` (node --test).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, accessSync, constants as fsConstants } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("..", import.meta.url);

/** Confronta una versione installata con una minima: `[a,b,c] >= [min]`. */
function almeno(versione, minima) {
  const a = versione.split(/[.\-+]/).map((p) => Number.parseInt(p, 10) || 0);
  const b = minima.split(/[.\-+]/).map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true; // uguale
}

const CRITICHE = [
  { name: "next", min: "16.3.0", role: "framework dell'app (App Router, build --webpack)" },
  { name: "react", min: "19.1.0", role: "runtime UI" },
  // react-dom NON è dichiarato nel manifest: arriva come dipendenza di next
  // e npm lo blocca da solo nel lockfile — la sentinella lo verifica lì.
  { name: "react-dom", min: "19.1.0", manifest: false, role: "rendering lato client (transitiva di next)" },
  { name: "pg", min: "8.16.0", role: "client PostgreSQL" },
  { name: "neon", min: "1.0.0", role: "driver serverless PostgreSQL" },
  { name: "@neon/env", min: "1.4.0", role: "validazione ambiente" },
  { name: "@neon/config", min: "1.7.0", role: "config condivisa" },
];

const EMOJI_ICONE = [
  { name: "frimousse", role: "picker emoji non stilizzato della chat" },
  { name: "@phosphor-icons/react", role: "icone «concetto» del registry admin" },
  { name: "@tabler/icons-react", role: "icone brand e pillole del registry admin" },
];

// Dipendenze rimosse di proposito: se tornano nel manifest, la suite blocca.
const RIMOSSI = [
  { name: "emoji-picker-react", motivo: "sostituito da frimousse nel picker della chat" },
  { name: "emoji-mart", motivo: "sostituito da frimousse nel picker della chat" },
];

const TUTTE = [...CRITICHE, ...EMOJI_ICONE];

function leggiManifest() {
  return JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8"));
}

function leggiLockfile() {
  return JSON.parse(readFileSync(new URL("package-lock.json", ROOT), "utf8"));
}

test("dipendenze critiche + emoji/icone: dichiarate in package.json come dependencies", () => {
  const pkg = leggiManifest();
  for (const { name, role, manifest = true } of TUTTE) {
    if (!manifest) continue; // transitiva (es. react-dom): verificata nel lockfile
    const range = pkg.dependencies?.[name];
    assert.ok(
      typeof range === "string" && range.length > 0,
      `${name} (${role}) manca in dependencies: serve a runtime nel bundle`,
    );
  }
});

test("dipendenze critiche: il manifest rispetta le versioni minime", () => {
  const pkg = leggiManifest();
  for (const { name, min, role, manifest = true } of CRITICHE) {
    if (!manifest) continue;
    const range = pkg.dependencies?.[name] ?? "";
    // estrae tutti i numeri di versione dal range (es. "^16.3.6" → 16.3.6,
    // ">=18.2.0 <19" → la prima soglia); li confronta con il minimo.
    const numeri = range.match(/\d+(?:\.\d+){1,2}/g);
    assert.ok(numeri && numeri.length > 0, `${name} (${role}): range "${range}" illeggibile`);
    assert.ok(
      numeri.some((v) => almeno(v, min)),
      `${name} (${role}): range "${range}" sotto il minimo ${min}`,
    );
  }
});

test("dipendenze critiche + emoji/icone: bloccate nel lockfile con versione e sorgente", () => {
  const lock = leggiLockfile();
  for (const { name } of TUTTE) {
    const entry = lock.packages?.[`node_modules/${name}`];
    assert.ok(entry, `${name} non è in package-lock.json: il manifest e il lockfile divergono`);
    assert.match(entry.version ?? "", /^\d/, `${name} non ha una versione bloccata`);
    assert.match(
      entry.resolved ?? "",
      /^https:\/\//,
      `${name} non ha un sorgente risolto nel lockfile`,
    );
  }
});

test("dipendenze critiche: le versioni installate nel lockfile rispettano i minimi", () => {
  const lock = leggiLockfile();
  for (const { name, min, role } of CRITICHE) {
    // include anche le transitiva (react-dom): il lockfile è la loro fonte di verità
    const versione = lock.packages?.[`node_modules/${name}`]?.version ?? "";
    assert.ok(
      almeno(versione, min),
      `${name} (${role}): installata ${versione}, sotto il minimo ${min}`,
    );
  }
});

test("dipendenze emoji + icone: ogni entry point si importa davvero con Node", async () => {
  for (const { name } of EMOJI_ICONE) {
    const mod = await import(name);
    assert.ok(
      mod && typeof mod === "object",
      `${name} si risolve ma non esporta un modulo valido`,
    );
  }
});

test("dipendenze critiche + emoji/icone: la guardia pre-commit esiste ed è attiva", () => {
  // L'hook `githooks/pre-commit` è il braccio operativo di questa sentinella:
  // blocca i commit in cui manifest e lockfile divergono. Qui si verifica che
  // esista, sia eseguibile, controlli i due file e che il suo script Node
  // incorporato sia almeno sintatticamente valido — e che il postinstall lo
  // installi davvero (core.hooksPath) su ogni clone fresco.
  const hookPath = new URL("githooks/pre-commit", ROOT);
  const hook = readFileSync(hookPath, "utf8");
  assert.ok(hook.length > 100, "githooks/pre-commit è vuoto o troncato");
  accessSync(hookPath, fsConstants.X_OK); // lancia se non eseguibile
  assert.match(hook, /package\.json/, "l'hook non menziona package.json");
  assert.match(hook, /package-lock\.json/, "l'hook non menziona package-lock.json");
  assert.match(
    hook, /--no-verify/,
    "l'hook non documenta la via d'uscita d'emergenza (--no-verify)",
  );
  const inizio = hook.indexOf("node -e '");
  const fine = hook.lastIndexOf("\n'");
  assert.ok(inizio !== -1 && fine > inizio, "script Node incorporato non trovato nell'hook");
  const script = hook.slice(inizio + "node -e '".length, fine);
  new vm.Script(script); // lancia SyntaxError se il controllo incorporato è rotto
  const pkg = leggiManifest();
  assert.match(
    pkg.scripts?.postinstall ?? "",
    /core\.hooksPath/,
    "il postinstall non installa più gli hook (core.hooksPath)",
  );
});

test("dipendenze rimosse: emoji-picker-react ed emoji-mart non tornano nel manifest", () => {
  // Tombstone: frimousse ha vinto, questi due non servono più. Se serve
  // davvero uno di loro, si rimette CON l'uso nel codice e si aggiorna qui.
  const pkg = leggiManifest();
  const lock = leggiLockfile();
  for (const { name, motivo } of RIMOSSI) {
    assert.ok(
      !pkg.dependencies?.[name] && !pkg.devDependencies?.[name],
      `${name} è stato rimosso dal progetto (${motivo}): non reinserirlo senza usarlo`,
    );
    assert.ok(
      !lock.packages?.[`node_modules/${name}`],
      `${name} è nel lockfile ma non nel manifest: il lockfile è disallineato`,
    );
  }
});

test("dipendenze emoji + icone: i deep import Phosphor del registry risolvono", () => {
  const registry = readFileSync(new URL("src/components/icon-registry.tsx", ROOT), "utf8");
  const specifiers = [...new Set(
    [...registry.matchAll(/"@phosphor-icons\/react\/[^"]+"/g)].map((m) => m[0].slice(1, -1)),
  )];
  assert.ok(specifiers.length >= 5, "il registry non usa più i deep import Phosphor?");
  for (const spec of specifiers) {
    const resolved = import.meta.resolve(spec);
    assert.match(resolved, /^file:\/.*node_modules\/@phosphor-icons\/react\//, `${spec} non risolve`);
  }
});
