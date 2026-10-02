/**
 * SENTINELLA FRAMER-FIRSTLOAD — framer-motion NON deve raggiungere il client
 * delle pagine pubbliche.
 *
 * Perché esiste: framer-motion (~43 kB gzip webpack, ~70 Turbopack) era nel
 * first load di OGNI pagina pubblica solo per dissolvenze — il vettore era la
 * catena client di layout (banner cookie) + Reveal + hero. Dal 2026-09-30 le
 * pagine pubbliche animano con IntersectionObserver + CSS (vedi motion.tsx)
 * e framer resta confinato dove il payload non viaggia coi visitatori:
 * /admin (nav, toaster, pills) e /consulenza (Chat).
 *
 * Due livelli di guardia:
 *
 * 1. QUI (statico, in ogni `npm test`): grafo degli import dai file che
 *    finiscono nel client pubblico. Il layout (src/app/layout.tsx) e i suoi
 *    componenti diretti NON devono importare framer né componenti che lo
 *    importano. Risolve in millisecondi, senza build: becca la regressione
 *    PRIMA che arrivi in CI (es. «metto motion nel banner» o «il footer
 *    importa Chat»).
 *
 * 2. SUL BUILD (runtime, nel workflow bundle-watch.yml): scansione dell'HTML
 *    delle pagine pubbliche + chunk referenziati, cerca i marker framer
 *    (useReducedMotion/AnimatePresence) nei byte scaricati dal browser.
 *    Il passo `framer-firstload` del workflow fallisce il CI se un chunk
 *    contaminato entra nel first load. È la verità definitiva: becca anche
 *    contaminazioni indirette (una lib che a sua volta importa framer).
 *
 * Le eccezioni vanno in PUBLIC_OK_FRAMER con motivo scritto: non un buco
 * per taccolare la sentinella.
 *
 * Variante Crema (adattata dal gemello Web Agency Salento, dove la sentinella
 * era nata il 30/09): le due ricette reveal sono state UNIFICATE sulla stessa
 * (classi `rv` + StaggerSlot, motion.tsx byte-identico); l'inventario framer
 * di questo repo contiene in più `toggle.tsx` (AppleToggle di /admin/operators).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Senza slash finale: gli inventory-key sono percorsi relativi (f.replace(ROOT + "/")).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

/** File i cui import finiscono nel client delle pagine pubbliche (grado 0). */
const PUBLIC_ENTRYPOINTS = [
  "src/app/layout.tsx", // ogni pagina pubblica passa da qui
  "src/app/page.tsx", // home
  "src/app/[slug]/page.tsx", // 17 landing
  "src/components/search-bar.tsx",
  "src/components/hero-animated.tsx",
  "src/components/motion.tsx",
  "src/components/consent.tsx",
];

/**
 * Percorsi ammessi a importare framer raggiungibili da file pubblici.
 * Oggi VUOTO: il layout non deve tirare nulla che importi framer. Se una
 * regressione dovesse essere davvero inevitabile, si documenta qui il motivo
 * — e il livello 2 (build) resterà comunque a sorvegliare i byte reali.
 */
const PUBLIC_OK_FRAMER = {};

function listTsFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listTsFiles(p));
    else if (/\.(tsx|ts)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Risolve un import relativo/alias al file del repo, se esiste. */
function resolveImport(fromFile, spec) {
  const candidates = [];
  if (spec.startsWith("@/")) {
    const base = join(SRC, spec.slice(2));
    candidates.push(base);
  } else if (spec.startsWith(".")) {
    const base = resolve(dirname(fromFile), spec);
    candidates.push(base);
  } else {
    return null; // pacchetto npm: il grafo si ferma qui (framer importato DIRETTO è beccato sotto)
  }
  for (const c of candidates) {
    for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) {
      const p = c + ext;
      if (existsSync(p) && !p.includes("/app/api/")) return p;
    }
  }
  return null;
}

/** Import locali di un file (stringhe tra virgolette di import/from). */
function localImports(file) {
  const src = readFileSync(file, "utf8");
  const specs = [];
  for (const m of src.matchAll(/(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g)) {
    specs.push(m[1]);
  }
  // import di solo tipo incluso (import type {...} from "..."): già coperto sopra.
  // dynamic import: anche queste tirano il modulo nel chunk client.
  for (const m of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
    specs.push(m[1]);
  }
  return specs;
}

function importsFramer(file) {
  const src = readFileSync(file, "utf8");
  return /from\s*["']framer-motion["']|import\(\s*["']framer-motion["']\s*\)/.test(src);
}

test("sentinella framer: nessun file pubblico importa direttamente framer-motion", () => {
  const violations = PUBLIC_ENTRYPOINTS.filter((f) => {
    const p = join(ROOT, f);
    return existsSync(p) && importsFramer(p);
  });
  assert.deepEqual(
    violations,
    [],
    `File pubblici che importano framer-motion:\n  ${violations.join("\n  ")}\n\n` +
      `Le pagine pubbliche animano con IntersectionObserver + CSS (motion.tsx). ` +
      `framer è ammesso solo in /admin e /consulenza.`,
  );
});

test("sentinella framer: il grafo degli import pubblici non raggiunge framer (profondità 4)", () => {
  // BFS dai file che il client pubblico carica: se un componente del layout
  // importa (anche indirettamente) un file che importa framer, qui si becca.
  const visited = new Set();
  const violations = [];
  const queue = PUBLIC_ENTRYPOINTS.filter((f) => existsSync(join(ROOT, f))).map((f) => ({
    file: join(ROOT, f),
    path: [f],
    depth: 0,
  }));
  while (queue.length) {
    const { file, path, depth } = queue.shift();
    if (visited.has(file) || depth > 4) continue;
    visited.add(file);
    if (importsFramer(file)) {
      const rel = file.replace(ROOT + "/", "");
      if (!(rel in PUBLIC_OK_FRAMER)) violations.push([...path, rel].join(" → "));
      continue;
    }
    for (const spec of localImports(file)) {
      const resolved = resolveImport(file, spec);
      if (resolved && !visited.has(resolved)) {
        queue.push({ file: resolved, path: [...path, spec], depth: depth + 1 });
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `framer-motion raggiungibile dal client pubblico:\n\n  ${violations.join("\n\n  ")}\n\n` +
      `Spezza la catena: il file finale deve usare animazioni CSS (vedi motion.tsx, ` +
      `globals.css §REVEAL) oppure restare confinato in /admin e /consulenza.`,
  );
});

test("sentinella framer: l'elenco dei file ammessi corrisponde alla realtà del repo", () => {
  // Se qualcuno aggiunge/rimuove un import framer, questo test lo espone:
  // l'inventario dev'essere una scelta consapevole, non un accumulo.
  // Variante Crema: qui la Chat è MIGRATA anch'essa (chat.css § ex
  // framer-motion), quindi l'inventario ha i 5 componenti admin;
  // il gemello ha in più Chat.tsx, noi abbiamo toggle.tsx (/admin/operators)
  // e maintenance-panel.tsx (switch iOS della manutenzione, 2026-10-02).
  const attesi = new Set([
    "src/components/admin-nav.tsx",
    "src/components/admin-toaster.tsx",
    "src/components/maintenance-panel.tsx",
    "src/components/status-pills.tsx",
    "src/components/toggle.tsx",
  ]);
  const reali = new Set(
    listTsFiles(SRC)
      .filter((f) => importsFramer(f))
      .map((f) => f.replace(ROOT + "/", "")),
  );
  const extra = [...reali].filter((f) => !attesi.has(f));
  const spariti = [...attesi].filter((f) => !reali.has(f));
  assert.deepEqual(
    { extra, spariti },
    { extra: [], spariti: [] },
    `Inventario framer-motion cambiato.\nNuovi import non previsti: ${extra.join(", ") || "—"}\n` +
      `Import rimossi: ${spariti.join(", ") || "—"}\nAggiorna l'attesa di questo test di proposito.`,
  );
});
