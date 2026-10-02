/**
 * GUARD DI SITO — OAuth social (Meta Facebook+IG, LinkedIn).
 *
 * Verifica il WIRING del flusso senza toccare provider
 * reali (servirebbero credenziali) e senza DB: le funzioni
 * di social-oauth.ts tirano dentro next/headers e pg, quindi
 * si leggono i sorgenti e si assertano le decisioni dove
 * vivono — stessa ricetta degli altri guard.
 *
 * GEMELLO: NO. Route e pagine non entrano nel twin-sync
 * (perimetro «pagine/route mai condivise») e questo guard
 * protegge il wiring di Crema. La sentinella GET-purity
 * (gemello-pari) già sorveglia il comportamento dei GET:
 * qui verifichiamo che i callback siano ancora whitelistati
 * con il loro motivo, così la coppia resta onesta.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");

const read = (...parts) => readFileSync(path.join(ROOT, ...parts), "utf8");

const metaStart = read("src", "app", "api", "auth", "meta", "start", "route.ts");
const metaCb = read("src", "app", "api", "auth", "meta", "callback", "route.ts");
const liStart = read("src", "app", "api", "auth", "linkedin", "start", "route.ts");
const liCb = read("src", "app", "api", "auth", "linkedin", "callback", "route.ts");
const lib = read("src", "lib", "social-oauth.ts");
const panel = read("src", "components", "social-channels-panel.tsx");
const page = read("src", "app", "admin", "settings", "social", "page.tsx");
const settingsHub = read("src", "app", "admin", "settings", "page.tsx");
const toolsHub = read("src", "app", "admin", "tools", "page.tsx");
const envExample = read(".env.example");
const sentinel = read("tests", "get-side-effect.sentinel.test.mjs");

/* ── start: POST only, 405 esplicito su GET ─────────── */

test("start Meta/LinkedIn: GET → 405 JSON esplicito, nessun effetto collaterale", () => {
  for (const src of [metaStart, liStart]) {
    assert.match(src, /export async function GET\(\)/);
    assert.match(src, /status: 405/, "il GET deve rispondere 405, non 404 né redirect");
  }
});

/* ── ADR-007: nessun header di cache su route autenticate o di scrittura ── */

test("ADR-007: le 4 route OAuth NON espongono header di cache su nessuna risposta", () => {
  // start = POST autenticato (requireAdmin) che scrive il cookie state;
  // callback = GET che compie la scrittura (upsert token). Entrambe sotto
  // la proibizione ADR-007 §3: "nessun header di cache su risposte
  // autenticate o di scrittura" — né Cache-Control, né cache CDN.
  for (const src of [metaStart, metaCb, liStart, liCb]) {
    assert.match(src, /force-dynamic/, "mai ISR/static: il flusso OAuth è sempre vivo al click");
    assert.doesNotMatch(src, /cache-control/i, "risposte autenticate o di scrittura: nessun Cache-Control (ADR-007 §3)");
    assert.doesNotMatch(src, /vercel-cdn-cache-control/i, "niente cache CDN su route OAuth");
    assert.doesNotMatch(src, /s-maxage/, "s-maxage è del proxy sulle pagine pubbliche, non su /api/auth");
  }
});

test("start: requireAdmin PRIMA di ogni altra azione, state cookie prima del 302", () => {
  // Il redirect di app_non_configurata precede lo state (non c'è
  // nulla da piantare senza credenziali); il 302 al provider —
  // l'unico che conta — esce SEMPRE dopo il cookie.
  for (const [src, configFn, authFn] of [
    [metaStart, "getMetaAppConfig()", "metaAuthorizationUrl("],
    [liStart, "getLinkedinAppConfig()", "linkedinAuthorizationUrl("],
  ]) {
    const post = src.slice(src.indexOf("export async function POST"));
    const order = (needle) => {
      const at = post.indexOf(needle);
      assert.ok(at !== -1, `manca ${needle}`);
      return at;
    };
    assert.ok(order("requireAdmin()") < order(configFn), "l'admin vale prima del provider");
    assert.ok(order("newOAuthState()") < order("setOAuthStateCookie("));
    assert.ok(order("setOAuthStateCookie(") < order(authFn), "lo state CSRF esiste già quando il browser lascia il sito");
  }
  assert.match(metaStart, /STATE_COOKIE = "meta_oauth_state"/);
  assert.match(liStart, /STATE_COOKIE = "linkedin_oauth_state"/);
});

test("start: app non configurata → redirect alla scheda col segnale, mai 500", () => {
  assert.match(metaStart, /redirect\("\/admin\/settings\/social\?meta=app_non_configurata"\)/);
  assert.match(liStart, /redirect\("\/admin\/settings\/social\?linkedin=app_non_configurata"\)/);
});

/* ── callback: contratto provider, state CSRF, UNA scrittura ── */

test("callback: GET (contratto provider) con state CSRF verificato PRIMA di qualsiasi scambio", () => {
  for (const src of [metaCb, liCb]) {
    assert.match(src, /export async function GET\(req: Request\)/);
    assert.match(src, /searchParams\.get\("code"\)/);
    assert.match(src, /searchParams\.get\("state"\)/);
    assert.ok(
      src.indexOf("verifyOAuthState(") < src.indexOf("exchangeMetaCode(") ||
        src.indexOf("verifyOAuthState(") < src.indexOf("exchangeLinkedinCode("),
      "lo state si verifica prima di toccare il provider",
    );
  }
});

test("callback: nessuna scrittura di cookie nel GET (lo state scade da solo in 10 min)", () => {
  for (const src of [metaCb, liCb]) {
    assert.doesNotMatch(src, /from "next\/headers"/, "il callback non importa cookies()");
    assert.doesNotMatch(src, /\.set\(|\.delete\(/, "il GET non cancella/pianta cookie: UNA sola scrittura, l'upsert");
  }
});

test("callback: la scrittura è l'upsert idempotente con credenziali CIFRATE", () => {
  assert.match(metaCb, /upsertChannelAccount\(\s*"facebook"/);
  assert.match(metaCb, /upsertChannelAccount\(\s*"instagram"/);
  assert.match(metaCb, /facebookCredentials\(/);
  assert.match(metaCb, /instagramCredentials\(/);
  assert.match(liCb, /upsertChannelAccount\(\s*"linkedin"/);
  assert.match(liCb, /`urn:li:organization:\$\{org\.id\}`/, "external_id LinkedIn = URN organizzazione");
  assert.match(liCb, /linkedinCredentials\(/);
  // Le credenziali nascono CIFRATE nella lib: mai un segreto in chiaro nel DB.
  assert.match(lib, /secretEnc: encryptKey\(/);
  assert.match(lib, /accessTokenEnc: encryptKey\(/);
});

test("callback: fail() torna sempre alla scheda social col segnale nel query", () => {
  assert.match(metaCb, /redirect\(`\/admin\/settings\/social\?meta=\$\{encodeURIComponent\(message\)\}`\)/);
  assert.match(liCb, /redirect\(`\/admin\/settings\/social\?linkedin=\$\{encodeURIComponent\(message\)\}`\)/);
  for (const src of [metaCb, liCb]) {
    assert.match(src, /state_non_valido/);
    assert.match(src, /app_non_configurata/);
    assert.match(src, /catch \(e\)/, "errori provider → banner, mai pagina bianca");
  }
});

test("callback: whitelistati nella sentinella GET-purity CON motivo (gemello-pari, va avanti in coppia)", () => {
  for (const route of ["/api/auth/meta/callback", "/api/auth/linkedin/callback"]) {
    assert.match(
      sentinel,
      new RegExp(`["']${route}["']:\\s*["']OAuth callback[^"']*["']`, "s"),
      `${route} manca nella WHITELIST della sentinella: senza motivo, il GET con upsert è una violazione non documentata`,
    );
  }
});

/* ── lib: state, scope, costanti ────────────────────── */

test("lib: state CSRF 10 minuti, cookie httpOnly/sameSite-lax/secure-in-prod", () => {
  assert.match(lib, /OAUTH_STATE_TTL_SECONDS = 600/);
  const set = lib.slice(lib.indexOf("export async function setOAuthStateCookie"), lib.indexOf("export async function verifyOAuthState"));
  assert.match(set, /httpOnly: true/);
  assert.match(set, /sameSite: "lax"/);
  assert.match(set, /secure: process\.env\.NODE_ENV === "production"/);
  assert.match(set, /maxAge: OAUTH_STATE_TTL_SECONDS/);
});

test("lib: confronto state in tempo costante (safeEqual condiviso), mai ===", () => {
  const verify = lib.slice(lib.indexOf("export async function verifyOAuthState"), lib.indexOf("/* ── URL di avvio"));
  assert.match(verify, /safeEqual\(/, "il confronto state deve essere a tempo costante");
  assert.doesNotMatch(verify, /actual === expected/, "confronto diretto: timing attack sullo state");
});

test("lib: scope Meta copre pagine+metadata+IG basic+messaging; LinkedIn w_identity (messaging SPENTO)", () => {
  assert.match(lib, /"pages_show_list"/);
  assert.match(lib, /"pages_manage_metadata"/);
  assert.match(lib, /"instagram_basic"/);
  assert.match(lib, /"pages_messaging"/);
  assert.match(lib, /LINKEDIN_SCOPE = "w_identity"/);
  // Il messaging LinkedIn resta SPENTO: w_organization_social
  // è citato SOLO nei commenti (la decisione), mai come scope.
  const scopeInCode = lib
    .split("\n")
    .filter((l) => l.includes("w_organization_social") && !l.trim().startsWith("*") && !l.trim().startsWith("//"));
  assert.equal(scopeInCode.length, 0, "w_organization_social deve vivere solo nei commenti: finché non c'è l'approvazione Marketing Developer Platform non si richiede");
});

test("lib: redirect URI dal dominio del sito (stessa base di absoluteUrl)", () => {
  assert.match(lib, /META_REDIRECT_PATH = "\/api\/auth\/meta\/callback"/);
  assert.match(lib, /LINKEDIN_REDIRECT_PATH = "\/api\/auth\/linkedin\/callback"/);
  assert.match(lib, /absoluteUrl\(/);
});

test("lib: vista pannello — solo facebook/instagram/linkedin, token mascherato, mai segreti in chiaro", () => {
  const view = lib.slice(lib.indexOf("export async function getSocialChannelsView"), lib.indexOf("/** redirect_uri registrati"));
  assert.match(view, /where channel in \('facebook','instagram','linkedin'\)/);
  assert.match(view, /hintFor\(token\)/, "il token compare SOLO come impronta mascherata");
  assert.match(view, /catch \{\s*return \[\]/, "DB non migrato: nessun account, nessun errore 500");
  const hint = lib.slice(lib.indexOf("function hintFor"), lib.indexOf("export async function getSocialChannelsView"));
  assert.match(hint, /slice\(0, 6\)/);
  assert.match(hint, /slice\(-4\)/);
});

/* ── pannello + pagina + hub + env ──────────────────── */

test("pannello: i «Collega» sono form POST ai rispettivi /start (il GET è 405 per contratto)", () => {
  assert.match(panel, /method="post"/);
  assert.match(panel, /formAction="\/api\/auth\/meta\/start"/);
  assert.match(panel, /formAction="\/api\/auth\/linkedin\/start"/);
  assert.match(panel, /disabled=\{!configured\}/, "senza credenziali app il bottone non parte");
});

test("pagina admin: requireAdmin, dinamica, noindex, back verso Tools, vista account e config provider", () => {
  assert.match(page, /await requireAdmin\(\)/);
  assert.match(page, /export const dynamic = "force-dynamic"/);
  assert.match(page, /robots: \{ index: false \}/);
  assert.match(page, /backHref="\/admin\/settings"/);
  assert.match(page, /backLabel="Impostazioni"/);
  assert.match(page, /getSocialChannelsView\(\)/);
  assert.match(page, /getMetaAppConfig\(\)/);
  assert.match(page, /getLinkedinAppConfig\(\)/);
});

test("hub Impostazioni: Canali social nella sezione Canali (non più in Tools)", () => {
  assert.match(settingsHub, /href="\/admin\/settings\/social"/);
  assert.match(settingsHub, /Icon={AtSign}/);
  // La scheda vive nella sezione Canali: fra Telegram e la chiusura della sezione.
  const canali = settingsHub.slice(settingsHub.indexOf('title="Canali"'), settingsHub.indexOf('title="Protezione"'));
  assert.match(canali, /href="\/admin\/settings\/social"/, "la card deve stare nella sezione Canali");
  assert.doesNotMatch(toolsHub, /\/admin\/tools\/social/, "l'hub Tools non la espone più");
});

test(".env.example: chiavi Meta e LinkedIn + i due redirect URI da registrare", () => {
  for (const key of ["META_APP_ID", "META_APP_SECRET", "LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"]) {
    assert.match(envExample, new RegExp(`^${key}=$`, "m"), `manca ${key} in .env.example`);
  }
  assert.match(envExample, /https:\/\/www\.DOMINIO\.IT\/api\/auth\/meta\/callback/);
  assert.match(envExample, /https:\/\/www\.DOMINIO\.IT\/api\/auth\/linkedin\/callback/);
});

/* ── contratto webhook: l'OAuth popola channel_accounts ── */

test("l'OAuth scrive ESATTAMENTE il contratto che il webhook legge (registry + migration)", () => {
  // Il webhook trova l'account via findChannelAccount(channel, external_id)
  // e verifica la firma con credentials.secretEnc: l'upsert deve produrre
  // quelle due chiavi per ogni canale social.
  const registry = read("src", "lib", "channel-registry.ts");
  assert.match(registry, /findChannelAccount/);
  assert.match(registry, /secretEnc/, "l'adapter legge il secret cifrato dal credentials");
  const migration = read("neon", "migrations", "045-social-channels.sql");
  const constraint = migration.match(/channel in \(([^)]+)\)/)?.[1] ?? "";
  for (const c of ["facebook", "instagram", "linkedin"]) {
    assert.ok(constraint.includes(`'${c}'`), `il CHECK di 045 non copre '${c}' che l'OAuth popola`);
  }
});
