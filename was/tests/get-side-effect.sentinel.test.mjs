/**
 * SENTINELLA — nessun side-effect sui Route Handler GET.
 *
 * Perché esiste: qui su WebAgencyCrema «Esci» era un <Link> verso
 * /admin/logout, un Route Handler GET che cancellava il cookie di sessione.
 * Next prefetcha i link visibili a idle: il prefetch eseguiva il GET →
 * logout() → la sessione moriva da sola pochi secondi dopo ogni pagina
 * caricata (rimbalzi silenziosi al login, nessuna traccia in audit). L'E2E
 * non lo vedeva: click immediati, prima che il prefetch partisse.
 *
 * Regola: un GET deve essere sicuro da richiamare QUANDUNQUE — prefetch,
 * crawler, refresh. Cookie e scritture DB stanno nel POST (server action o
 * route handler dedicato).
 *
 * Come funziona: scanner lessicale dei route.ts/route.tsx (stesso approccio
 * del contrast test: leggere i sorgenti, non importarli). Per ogni
 * `export (async) function GET` estrae il corpo (contatore di graffe) e
 * segnala:
 *   - scritture sul cookie store: `cookies().set/delete/extend(...)` diretto
 *     o via variabile `const store = await cookies()` → `store.set(...)`
 *     (SOLO il cookie store: un `.set` su response.headers è legittimo);
 *   - SQL di scrittura nei letterali: INSERT INTO / UPDATE x SET / DELETE FROM;
 *   - chiamate a funzioni con nome di uscita (logout/signOut): è il modo
 *     indiretto in cui il footgun storico si presenta (`await logout()` non
 *     mostra il cookie ma È la cancellazione della sessione).
 *
 * Limite dichiarato: lessicale, non semantico — un helper rinominato che
 * scrive su DB senza SQL nel letterale sfugge (per quello c'è il test E2E
 * logout-prefetch, che prova il percorso reale a idle).
 *
 * Le eccezioni vivono in WHITELIST: una riga per caso, col motivo. Non è
 * un meccanismo per taccolare la sentinella.
 *
 * Portata dal gemello Web Agency Salento (dove la lezione era stata
 * formalizzata): qui il footgun era nato, la sentinella torna a casa.
 *
 * Esecuzione: `npm test` (node --test).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app");

/** Pattern vietati dentro un GET (il `why` spiega a chi viene colpito). */
const FORBIDDEN = [
  { re: /insert\s+into\s/i, why: "INSERT nel GET" },
  { re: /\bupdate\s+\w+\s+set\b/i, why: "UPDATE nel GET" },
  { re: /delete\s+from\s/i, why: "DELETE nel GET" },
  { re: /\b(logout|signout|sign_out)\s*\(/i, why: "chiamata a logout() nel GET" },
];

/**
 * Route consentiti a portare side-effect nel GET. INSERIRE solo dopo una
 * discussione, col motivo scritto: un GET non è mai prefetch-safe se
 * scrive. Forma: `percorso: motivo`.
 */
const WHITELIST = {
  // Cron esterno: il GET È il contratto (Vercel Cron / scheduler chiamano
  // GET), ogni scrittura sta dietro il gate CRON_SECRET — non è raggiungibile
  // da un prefetch del browser, che non porta mai l'header del segreto.
  "/api/cron/tick": "scheduler esterno: GET by design, scritture dietro CRON_SECRET",
  // OAuth callback (Meta + LinkedIn): il GET È il contratto del
  // provider (redirect indietro con ?code= + ?state=). Non è
  // prefetchabile con successo: serve un code+state appena emessi,
  // e lo state si confronta in tempo costante col cookie httpOnly
  // da 10 minuti (assente/non combaciante → redirect, nessuna
  // scrittura). La scrittura è UN upsert idempotente
  // (ON CONFLICT channel,external_id) che popola channel_accounts
  // con app secret e token CIFRATI — il contratto che il webhook
  // omnicanale verifica già (X-Hub-Signature-256 / X-LI-Signature).
  "/api/auth/meta/callback": "OAuth callback: GET è il contratto del provider, state CSRF httpOnly 10 min, upsert idempotente con token cifrati",
  "/api/auth/linkedin/callback": "OAuth callback: GET è il contratto del provider, state CSRF httpOnly 10 min, upsert idempotente con token cifrati",
};

function listRouteFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRouteFiles(p));
    else if (/^route\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

/** Corpo di ogni export GET del file: contatore di graffe dalla firma. */
function getHandlerBodies(source) {
  const bodies = [];
  const re = /export\s+(async\s+)?function\s+GET\s*\(/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const open = source.indexOf("{", m.index + m[0].length);
    if (open === -1) continue;
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i++) {
      const c = source[i];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end !== -1) bodies.push(source.slice(open, end + 1));
  }
  return bodies;
}

/** Scritture sul cookie store nel corpo: diretta o via variabile assegnata. */
function cookieWriteViolations(body) {
  const hits = [];
  // Diretta, anche incatenata tra parentesi: cookies().delete(...) oppure
  // (await cookies()).set(...) — la seconda forma era un buco del rilevatore.
  if (/cookies\(\s*\)\s*\)*\s*\.\s*(set|delete|extend)\s*\(/.test(body)) {
    hits.push("cookies().set/delete/extend nel GET");
  }
  for (const m of body.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?cookies\(\s*\)/g)) {
    const id = m[1];
    if (new RegExp(`\\b${id}\\s*\\.\\s*(set|delete|extend)\\s*\\(`).test(body)) {
      hits.push(`scrittura cookie via \`${id}\` (assegnato da cookies()) nel GET`);
    }
  }
  return hits;
}

/** Percorso del file → route URL (convenzione app directory). */
function routeOf(file) {
  return (
    file
      .replace(APP_DIR, "")
      .replace(/\/route\.(ts|tsx)$/, "")
      .replace(/\(([^)]+)\)\//g, "") // i route group non compaiono nell'URL
      .replace(/\/\[[^\]]+\]/g, "/[param]") || "/"
  );
}

function scanAll() {
  const violations = [];
  for (const file of listRouteFiles(APP_DIR)) {
    const source = readFileSync(file, "utf8");
    const route = routeOf(file);
    for (const body of getHandlerBodies(source)) {
      for (const { re, why } of FORBIDDEN) {
        if (re.test(body)) violations.push({ route, file, why });
      }
      for (const why of cookieWriteViolations(body)) {
        violations.push({ route, file, why });
      }
    }
  }
  return violations.filter((v) => !(v.route in WHITELIST));
}

test("sentinella: nessun side-effect nei route handler GET", () => {
  const violations = scanAll();
  assert.deepEqual(
    violations,
    [],
    `GET con side-effect trovati (prefetch = esecuzione a sorpresa):

${violations.map((v) => `  ${v.route} — ${v.why}\n    in ${v.file}`).join("\n\n")}

Un GET deve essere sicuro da richiamare quando vuole (prefetch, crawler,
refresh): sposta la scrittura nel POST (server action o route handler),
oppure — se davvero non si può — documenta l'eccezione in WHITELIST.`,
  );
});

test("la sentinella rileva davvero: il footgun storico di Crema viene beccato", () => {
  // Il route handler che causava i logout fantasma qui su WebAgencyCrema, e
  // le sue varianti dirette: se il rilevatore non li vede, la sentinella è cieca.
  const footguns = [
    // Il caso reale: side-effect indiretto via logout() nel GET.
    `export async function GET(req: Request) {
  await logout();
  return NextResponse.redirect(new URL("/admin/login", req.url));
}`,
    // Scrittura cookie diretta e via variabile.
    `export function GET() {
  (await cookies()).delete("wac_admin");
  return Response.json({ ok: true });
}`,
    `export async function GET() {
  const store = await cookies();
  store.set("v", "1");
  return Response.json({ ok: true });
}`,
    // SQL di scrittura.
    `export async function GET() {
  await pool.query("insert into logs (line) values ($1)", ["x"]);
  return Response.json({ ok: true });
}`,
  ];
  for (const source of footguns) {
    const bodies = getHandlerBodies(source);
    assert.equal(bodies.length, 1, "estratta una sola firma GET");
    const hits = [...FORBIDDEN.filter(({ re }) => re.test(bodies[0])).map((f) => f.why), ...cookieWriteViolations(bodies[0])];
    assert.ok(hits.length > 0, `il footgun dev'essere rilevato:\n${source}`);
  }

  // Un GET onesto (solo letture: cookie().get, SELECT, header di risposta)
  // non deve allarmare — compreso il .set su response.headers, legittimo.
  const onesto = `export async function GET() {
  const store = await cookies();
  const theme = store.get("theme")?.value ?? "light";
  const rows = await pool.query("select * from settings");
  const res = Response.json({ theme, rows: rows.rows.length });
  res.headers.set("cache-control", "no-store");
  return res;
}`;
  const hits = [
    ...FORBIDDEN.filter(({ re }) => re.test(getHandlerBodies(onesto)[0])).map((f) => f.why),
    ...cookieWriteViolations(getHandlerBodies(onesto)[0]),
  ];
  assert.deepEqual(hits, [], "lettura cookie, SELECT e header di risposta sono innocui");
});

test("la sentinella copre la lezione di /admin/logout (GET senza side-effect)", () => {
  // Il percorso incriminato: oggi il route.ts fa il logout SOLO sul POST e
  // il GET è una redirezione innocua per vecchi bookmark. Qui si verifica
  // che il file live non rientri MAI nelle violazioni — se qualcuno
  // rimettesse il vecchio route handler con side-effect, questo test
  // fallisce prima del deploy.
  const violations = scanAll().filter((v) => v.route === "/admin/logout");
  assert.deepEqual(violations, [], "/admin/logout deve restare senza side-effect sul GET");
});
