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
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { extractGetHandler } from "./extractor-helper.mjs";

// fileURLToPath e non .pathname: i percorsi con spazi (questo repo) verrebbero
// percent-encoded e i readFileSync fallirebbero con ENOENT fantasma.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

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
  // Variante Salento: non esiste un route handler /admin/logout — la pagina
  // (GET innocuo) rende una form verso la server action logoutAction (POST):
  // il prefetch della pagina non cancella nulla, l'uscita vera è solo POST.
  const page = readFileSync(join(ROOT, "src", "app", "admin", "logout", "page.tsx"), "utf8");
  assert.match(page, /LogoutForm/, "la pagina di logout rende la form POST");
  const form = readFileSync(join(ROOT, "src", "components", "logout-form.tsx"), "utf8");
  assert.match(form, /<form id="logout-form" action=\{logoutAction\}/, "la form usa la server action (POST)");
  assert.match(form, /type="submit"/, "bottone submit per il percorso senza JS");
});

test("la nav fa logout con un form POST, non con un link GET", () => {
  const nav = readFileSync(join(ROOT, "src", "components", "admin-nav.tsx"), "utf8");
  // Variante Salento: il form usa la SERVER ACTION logoutAction (stesso POST,
  // stesso effetto del form nativo del gemello verso il route handler).
  assert.match(nav, /<form action=\{logoutAction\}/, "form con la server action di logout (POST)");
  assert.match(nav, /type="submit"/, "bottone submit dentro il form");
  assert.doesNotMatch(nav, /<Link[^>]*href="\/admin\/logout"/, "nessun <Link> prefetchabile verso il logout");
});
