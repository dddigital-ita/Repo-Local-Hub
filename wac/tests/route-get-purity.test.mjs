/**
 * SENTINELLA ROUTE HANDLER GET — niente side-effect su richiesta prefetchabile.
 *
 * Difetto sul vivo (29/09, hotfix 4f7a45d): il route handler GET /admin/logout
 * cancellava il cookie di sessione e il Link «Esci» nell'header veniva
 * prefetchato da Next a idle — pochi secondi dopo ogni pagina il cookie era
 * morto nel jar, il click successivo rimbalzava al login senza alcun rigetto
 * lato server. Il team finiva nel loop login→click→login e beccava il rate
 * limit. Il logout vero ora è solo POST; il GET è una redirezione innocua.
 *
 * Regola che questa sentinella rende permanente:
 *   1. NESSUN export GET di un route handler può toccare i cookie
 *      (cookies() di next/headers, Set-Cookie, logout()) — il prefetch di
 *      Next esegue i GET: un side-effect lì è un logout (o peggio) a sorpresa.
 *   2. NESSUN GET di /admin può avere side-effect ALIENO alla lettura
 *      (password_hash riscritto, delete/insert/update su tabelle di stato
 *      della sessione) — le GET admin sono letture o download, punto.
 *
 * Le GET legittime con audit (logAudit in login/audit.csv ecc.) restano
 * ammesse: l'audit è traccia, non stato della sessione. Se in futuro un GET
 * dovrà davvero mutare, si gira su POST (form o fetch) — come si è fatto
 * per il logout.
 *
 * Esecuzione: `npm test` (node --test).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { extractGetHandler } from "./extractor-helper.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

/** Raccoglie ricorsivamente tutti i file route.ts di src/app. */
function collectRoutes(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectRoutes(full, acc);
    else if (entry === "route.ts") acc.push(full);
  }
  return acc;
}

/** Estrae il corpo della funzione export GET (o null se non esiste). */
const extractGet = extractGetHandler;

const SIDE_EFFECT_PATTERNS = [
  { re: /await\s+cookies\(\)/, label: "cookies() di next/headers (lettura o scrittura cookie)" },
  { re: /\.set\(\s*["'`]/, label: "set() su cookie store" },
  { re: /\.delete\(\s*["'`]/, label: "delete() su cookie store" },
  { re: /["'`]Set-Cookie["'`]\s*:\s*/i, label: "header Set-Cookie esplicito" },
  { re: /\blogout\s*\(/, label: "logout() (cancella la sessione)" },
  { re: /issueSessionFor\s*\(/, label: "issueSessionFor() (rinnova/riscrive il cookie di sessione)" },
  { re: /["'`]password_hash["'`]\s*,/i, label: "riscrittura password_hash (mutazione di stato account)" },
];

test("la sentinella vede tutti i route handler del progetto", () => {
  const routes = collectRoutes(join(ROOT, "src", "app"));
  assert.ok(routes.length >= 15, `trovati ${routes.length} route.ts: la scansione funziona`);
});

test("nessun export GET di route handler ha side-effect (prefetch-sicuro)", () => {
  const violations = [];
  for (const file of collectRoutes(join(ROOT, "src", "app"))) {
    const src = readFileSync(file, "utf8");
    const getBody = extractGet(src);
    if (!getBody) continue; // niente GET: la sentinella non c'entra
    const rel = file.replace(ROOT, "");
    for (const { re, label } of SIDE_EFFECT_PATTERNS) {
      if (re.test(getBody)) violations.push(`${rel}: GET fa ${label}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Route handler GET con side-effect trovati (il prefetch di Next li esegue):\n${violations.join("\n")}\n` +
      `→ sposta la mutazione su POST (form o fetch), come fatto per /admin/logout (hotfix 4f7a45d).`,
  );
});

test("il caso canario resta cosciente: /admin/logout GET è innocuo e il POST cancella davvero", () => {
  const src = readFileSync(join(ROOT, "src", "app", "admin", "logout", "route.ts"), "utf8");
  assert.match(src, /export\s+async\s+function\s+POST/, "il logout vero è su POST");
  assert.match(src, /await\s+logout\(\)/, "il POST chiama logout()");
  const getBody = extractGet(src);
  assert.ok(getBody, "il GET esiste (redirezione innocua per vecchi bookmark)");
  assert.doesNotMatch(getBody, /logout\s*\(/, "il GET NON deve più cancellare la sessione");
  assert.match(getBody, /redirect|NextResponse/, "il GET risponde con una redirezione");
});

test("la nav fa logout con un form POST, non con un link GET", () => {
  const nav = readFileSync(join(ROOT, "src", "components", "admin-nav.tsx"), "utf8");
  assert.match(nav, /action="\/admin\/logout"\s+method="post"/, "form con method=post");
  assert.match(nav, /type="submit"/, "bottone submit dentro il form");
  assert.doesNotMatch(
    nav.match(/action="\/admin\/logout"[\s\S]{0,600}/)?.[0] ?? "",
    /<Link[^>]*href="\/admin\/logout"/,
    "nessun <Link> prefetchabile verso il logout dentro il form",
  );
});
