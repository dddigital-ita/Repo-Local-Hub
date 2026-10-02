/**
 * TEST TTL CACHE PAGINE PUBBLICHE — il TTL vive in un modulo
 * puro (page-cache-shared) e in testi dichiarati: si verifica
 * senza DB e senza server, con lo stesso metodo del repo
 * (leggere le decisioni dove vivono + eseguire le funzioni
 * pure). Guard gemello-pari: la superficie admin
 * (perf page, pannello) vive in entrambi i repo;
 * i moduli shared viaggiano via twin-sync.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");

// Le funzioni pure di page-cache-shared sono importabili senza
// DB (il proxy le usa: non deve mai tirarsi dietro pg).
const shared = await import(path.join(ROOT, "src", "lib", "page-cache-shared.ts"));
const {
  sanitizePageCacheConfig,
  describePageCacheTtl,
  PAGE_CACHE_KEY,
  PAGE_CACHE_MIN_S,
  PAGE_CACHE_MAX_S,
  PAGE_CACHE_STEP_S,
  DEFAULT_PAGE_CACHE_TTL_S,
} = shared;

const proxySrc = readFileSync(path.join(ROOT, "src", "proxy.ts"), "utf8");
const actionSrc = readFileSync(path.join(ROOT, "src", "app", "admin", "actions.ts"), "utf8");
const perfSrc = readFileSync(
  path.join(ROOT, "src", "app", "admin", "tools", "perf", "page.tsx"),
  "utf8",
);
const panelSrc = readFileSync(
  path.join(ROOT, "src", "components", "page-cache-ttl-panel.tsx"),
  "utf8",
);
const routeSrc = readFileSync(
  path.join(ROOT, "src", "app", "api", "page-cache", "config", "route.ts"),
  "utf8",
);
const storeSrc = readFileSync(path.join(ROOT, "src", "lib", "page-cache-store.ts"), "utf8");

/* ── logica pura: sanitize, default, etichette ──────────── */

test("costanti: range 60s–86400s, default 300s, passo 60s", () => {
  assert.equal(PAGE_CACHE_MIN_S, 60);
  assert.equal(PAGE_CACHE_MAX_S, 86_400);
  assert.equal(PAGE_CACHE_STEP_S, 60);
  assert.equal(DEFAULT_PAGE_CACHE_TTL_S, 300);
  assert.ok(
    DEFAULT_PAGE_CACHE_TTL_S >= PAGE_CACHE_MIN_S && DEFAULT_PAGE_CACHE_TTL_S <= PAGE_CACHE_MAX_S,
  );
  assert.ok((PAGE_CACHE_MAX_S - PAGE_CACHE_MIN_S) % PAGE_CACHE_STEP_S === 0);
});

test("sanitize: default 300s quando la config è assente o corrotta", () => {
  for (const raw of [null, undefined, "garbage", 42, {}, []]) {
    const c = sanitizePageCacheConfig(raw);
    assert.equal(c.ttlSeconds, DEFAULT_PAGE_CACHE_TTL_S, `con ${JSON.stringify(raw)}`);
  }
});

test("sanitize: fuori range e non interi ricadono nel range, arrotondati", () => {
  assert.equal(sanitizePageCacheConfig({ ttlSeconds: 5 }).ttlSeconds, PAGE_CACHE_MIN_S);
  assert.equal(sanitizePageCacheConfig({ ttlSeconds: 999_999 }).ttlSeconds, PAGE_CACHE_MAX_S);
  assert.equal(sanitizePageCacheConfig({ ttlSeconds: 90.7 }).ttlSeconds, 91);
  assert.equal(sanitizePageCacheConfig({ ttlSeconds: "120" }).ttlSeconds, 120);
  assert.equal(
    sanitizePageCacheConfig({ ttlSeconds: "garbage" }).ttlSeconds,
    DEFAULT_PAGE_CACHE_TTL_S,
  );
});

test("describe: etichette leggibili minuti/ore/giorni", () => {
  assert.equal(describePageCacheTtl(300), "5 minuti");
  assert.equal(describePageCacheTtl(60), "1 minuto");
  assert.equal(describePageCacheTtl(3600), "1 ora");
  assert.equal(describePageCacheTtl(7200), "2 ore");
  assert.equal(describePageCacheTtl(86_400), "1 giorno");
  assert.equal(describePageCacheTtl(172_800), "2 giorni");
  assert.equal(describePageCacheTtl(NaN), "5 minuti");
});

/* ── rotta config: dinamica, CDN breve, niente segreti ───── */

test("la rotta config è dinamica, JSON, CDN a 60s e browser rivalida", () => {
  assert.match(routeSrc, /force-dynamic/);
  assert.match(routeSrc, /readPageCacheConfig/);
  assert.match(routeSrc, /vercel-cdn-cache-control/);
  assert.match(routeSrc, /max-age=60/, "il cambio TTL deve arrivare al proxy in fretta");
  assert.match(routeSrc, /must-revalidate/, "il browser rivalida sempre (regola AGENTS.md)");
  assert.doesNotMatch(routeSrc, /secret|token|password/i, "solo un numero pubblico");
  // ADR-007: la cache qui È lecita perché la rotta è pubblica e di
  // sola lettura (il proxy la legge senza credenziali) — la proibizione
  // «nessun header di cache» vale su risposte autenticate o di scrittura.
  assert.doesNotMatch(routeSrc, /export async function (POST|PUT|PATCH|DELETE)/, "sola GET: rotta di lettura, mai di scrittura");
  assert.doesNotMatch(routeSrc, /requireAdmin/, "pubblica per contratto: la legge il proxy, non un utente");
});

/* ── store: content_settings, zero migration ─────────────── */

test("il TTL vive in content_settings (zero migration: nessun DDL)", () => {
  assert.equal(PAGE_CACHE_KEY, "page_cache_ttl");
  assert.match(storeSrc, /content_settings/);
  assert.doesNotMatch(storeSrc, /create table|alter table/);
  assert.match(storeSrc, /sanitizePageCacheConfig\(null\)/, "DB giù → default, mai errore");
});

/* ── proxy: s-maxage SOLO su home e landing canoniche ────── */

test("il proxy applica s-maxage a home e landing canoniche, browser rivalida sempre", () => {
  const idx = proxySrc.indexOf("const cacheable");
  assert.ok(idx !== -1, "il blocco TTL non esiste nel proxy");
  const block = proxySrc.slice(idx, proxySrc.indexOf("return res;", idx));
  assert.match(block, /lower === "\/"/);
  assert.match(block, /LANDINGS\.some/, "solo gli slug CANONICI delle landing");
  assert.match(block, /s-maxage=\$\{ttl\}/);
  assert.match(block, /vercel-cdn-cache-control/);
  assert.match(block, /max-age=0/, "il browser rivalida sempre: la freschezza cede solo alla CDN");
  assert.match(block, /must-revalidate/);
});

test("il proxy legge il TTL via rotta interna: cache breve, timeout, fallback al default", () => {
  const fn = proxySrc.slice(
    proxySrc.indexOf("async function loadPageCache"),
    proxySrc.indexOf("function esc"),
  );
  assert.match(fn, /\/api\/page-cache\/config/);
  assert.match(fn, /cache: "no-store"/);
  assert.match(fn, /AbortSignal\.timeout/);
  assert.match(fn, /PAGE_CACHE_TTL_MS/, "cache in-process breve: lo slider arriva presto");
  assert.match(proxySrc, /PAGE_CACHE_TTL_MS = 30_000/);
  assert.match(fn, /sanitizePageCacheConfig\(/);
  assert.match(fn, /\{\s*\.\.\.DEFAULT_PAGE_CACHE\s*\}/, "errore → TTL default, il sito non rallenta");
});

test("il TTL si applica DOPO cancello e redirect (503 e 301 non si cachano con s-maxage)", () => {
  assert.ok(
    proxySrc.indexOf("snap.active") < proxySrc.indexOf("const cacheable"),
    "la manutenzione vale prima del TTL",
  );
  assert.ok(
    proxySrc.indexOf("NextResponse.redirect") < proxySrc.indexOf("const cacheable"),
    "i redirect SEO escono prima del TTL",
  );
});

test("il proxy non usa pg: il TTL arriva via rotta interna come manutenzione e SEO", () => {
  const imports = proxySrc.slice(0, proxySrc.indexOf("type Snapshot"));
  assert.doesNotMatch(imports, /page-cache-store/, "il proxy importa il modulo PURO, non lo store");
  assert.doesNotMatch(imports, /from "pg"/);
});

/* ── admin: audit obbligatorio e wiring completo ─────────── */

test("l'action richiede admin, sanifica, upserta e registra vecchio→nuovo in audit", () => {
  const idx = actionSrc.indexOf("export async function savePageCacheTtl");
  assert.ok(idx !== -1, "l'action del TTL non esiste");
  const block = actionSrc.slice(idx, actionSrc.indexOf("}", actionSrc.indexOf("revalidatePath", idx)));
  const order = (needle) => {
    const at = block.indexOf(needle);
    assert.ok(at !== -1, `manca ${needle}`);
    return at;
  };
  assert.ok(order("requireAdmin()") < order("PAGE_CACHE_KEY"), "requireAdmin prima di ogni scrittura");
  assert.ok(order("sanitizePageCacheConfig") < order("PAGE_CACHE_KEY, JSON.stringify"), "input sanificato prima del salvataggio");
  assert.ok(block.includes("on conflict (key) do update"), "upsert additivo su content_settings");
  assert.ok(order("readPageCacheConfig()") < order("logAudit("), "l'audit registra il cambio (vecchio→nuovo)");
  assert.match(block, /cache\.ttl/);
  assert.match(block, /\$\{prev\.ttlSeconds\}→\$\{next\.ttlSeconds\}s/);
});

test("wiring: slider montato su /admin/tools/perf, il form invia l'action", () => {
  assert.match(perfSrc, /PageCacheTtlPanel/);
  assert.match(perfSrc, /readPageCacheConfig/);
  assert.match(panelSrc, /savePageCacheTtl/);
  assert.match(panelSrc, /type="range"/);
  assert.match(panelSrc, /PAGE_CACHE_MIN_S/);
  assert.match(panelSrc, /PAGE_CACHE_MAX_S/);
  assert.match(panelSrc, /PAGE_CACHE_STEP_S/);
  assert.match(panelSrc, /Free cache/, "immediatezza via invalidazione vera, non workaround");
});
