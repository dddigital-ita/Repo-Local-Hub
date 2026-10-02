#!/usr/bin/env node
/**
 * PREFLIGHT DI DEPLOY — controllo obbligatorio PRIMA di registrare/deployare
 * l'app su un dominio (lezione dell'incidente del 28/09/2026: l'app Node era
 * stata registrata sul dominio principale e Passenger ha "coperto" il sito
 * WordPress in public_html).
 *
 * Cosa verifica, in ordine:
 *   1. Il dominio di destinazione NON è il dominio principale dell'account
 *      (quello con WordPress alla root): lì il deploy è vietato, punto.
 *   2. La destinazione sembra un sito WordPress (marker wp-content, wp-json,
 *      xmlrpc.php, generator meta): vietato sovrascrivere/schermare.
 *   3. La destinazione NON risponde già con un'altra app Next (salvoOverride
 *      esplicito via env, per i redeploy: si riconosce da /api/health).
 *
 * Uso:
 *   node scripts/deploy-preflight.mjs https://wac.tuodominio.com
 *   DEPLOY_PRIMARY_DOMAINS="dddigital.net,www.dddigital.net" \
 *     node scripts/deploy-preflight.mjs https://wac.dddigital.net
 *
 * Exit 0 = sicuro procedere. Exit 1 = FERMO, non deployare.
 */

const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base || !/^https?:\/\//.test(base)) {
  console.error("Uso: node scripts/deploy-preflight.mjs <https://sottodominio.tuodominio.com>");
  process.exit(1);
}

// Domini principali vietati al deploy: default = dddigital.net (dove vivono i
// siti WordPress). Personalizzabile via env per altri account.
const PRIMARY_DOMAINS = (process.env.DEPLOY_PRIMARY_DOMAINS ?? "dddigital.net,www.dddigital.net")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

// Redeploy su un'app Next già nostra: consenti solo se /api/health risponde
// con lo schema del progetto. Il primo install NON ha questa env: il check (3)
// blocca ogni destinazione che risponde 200 ma non è WordPress né app nostra.
const ALLOW_EXISTING_OWN_APP = process.env.DEPLOY_ALLOW_REDEPLOY === "1";

let url;
try {
  url = new URL(base);
} catch {
  console.error(`✖ URL non valido: ${base}`);
  process.exit(1);
}
const host = url.hostname.toLowerCase();

const failures = [];
const v = (ok, label, extra = "") => {
  console.log(`${ok ? "✓" : "✖"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures.push(label);
};

console.log(`Preflight deploy su: ${base}\n`);

// ── 1. Vietato il dominio principale (root con WordPress) ──────────────────
// Blocca apex e www dei domini principali (lì vivono i WordPress). Gli ALTRI
// sottodomini sono consentiti in linea di principio: il check 2 (marker WP)
// blocca comunque quelli che ospitano un altro WordPress.
const bareHost = host.replace(/^www\./, "");
const apexSet = new Set(PRIMARY_DOMAINS.map((d) => d.replace(/^www\./, "")));
const isPrimary = apexSet.has(bareHost);
v(!isPrimary, "non è il dominio principale dell'account", host);

// Un sottodominio dedicato deve ESISTERE come sottodominio (es. wac.dddigital.net):
// avvisiamo se sembra un apex o www (già coperto sopra) e suggeriamo la procedura.
if (failures.length === 0) {
  console.log(`  → destinazione accettabile come sottodominio dedicato. Verifica in cPanel → Domains`);
  console.log(`    che "${host}" abbia docroot PROPRIO (es. /home/UTENTE/${host.replace(/\./g, "-")}),`);
  console.log(`    mai public_html.`);
}

// ── 2-3. Probe HTTP della destinazione ─────────────────────────────────────
async function probe(path) {
  try {
    const res = await fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const body = res.status === 200 ? await res.text() : "";
    return { res, body };
  } catch (err) {
    return { res: null, body: "", err };
  }
}

const home = await probe("/");
if (!home.res) {
  const code = home.err?.cause?.code ?? home.err?.message ?? "errore di rete";
  v(false, "destinazione raggiungibile", code);
  if (code === "ENOTFOUND") {
    console.log("  → Il DNS non risolve: NORMALE se il sottodominio non esiste ancora.");
    console.log("    Crealo prima in cPanel → Domains → Subdomains (con docroot PROPRIO, mai public_html),");
    console.log("    aspetta la propagazione (o usa AutoSSL) e rilancia il preflight.");
  }
} else {
  const body = home.body || "";
  const wpMarkers = [
    ["/wp-content/", body.includes("/wp-content/")],
    ["/wp-includes/", body.includes("/wp-includes/")],
    ["wp-json", body.includes("wp-json")],
    ["generator meta WordPress", /<meta[^>]+generator[^>]+wordpress/i.test(body)],
  ].filter(([, hit]) => hit).map(([label]) => label);

  if (wpMarkers.length) {
    v(false, "nessun marker WordPress nella home", `trovati marker: ${wpMarkers.join(", ")}`);
  } else {
    v(true, "nessun marker WordPress nella home");
  }

  // xmlrpc.php: WordPress risponde 200/405; molti host bloccano con 403 per
  // sicurezza (inconcludente): in quel caso solo avviso, mai falso positivo.
  const xmlrpc = await probe("/xmlrpc.php");
  if (xmlrpc.res && (xmlrpc.res.status === 200 || xmlrpc.res.status === 405)) {
    v(false, "xmlrpc.php muto (nessun WordPress dietro)", `stato ${xmlrpc.res.status} — WordPress rilevato`);
  } else if (xmlrpc.res && xmlrpc.res.status === 403) {
    console.log("? xmlrpc.php → 403 (probabile blocco security dell'host: inconcludente, vedi marker home)");
  } else if (xmlrpc.res) {
    v(true, `xmlrpc.php → ${xmlrpc.res.status} (nessun WordPress dietro)`);
  } else {
    console.log("? xmlrpc.php non raggiungibile (errore di rete): verifica manuale");
  }

  // Riconoscimento app nostra per i redeploy.
  const health = await probe("/api/health");
  const looksLikeOurApp = health.res?.ok && /"status"\s*:\s*"ok"/.test(health.body || "");
  if (home.res.status === 200 && !wpMarkers.length && !looksLikeOurApp) {
    if (ALLOW_EXISTING_OWN_APP) {
      console.log("? destinazione risponde 200 ma /api/health non è la nostra: consentito da DEPLOY_ALLOW_REDEPLOY=1 — verifica manuale");
    } else {
      v(false, "destinazione libera o app nostra", `la home risponde 200 ma /api/health non riconosciuta: verificare a cosa appartiene PRIMA di deployare`);
    }
  } else if (looksLikeOurApp) {
    v(true, "/api/health riconosciuta (redeploy di un'app nostra)");
  }
}

console.log("");
if (failures.length) {
  console.error("PREFLIGHT FALLITO: NON deployare su questa destinazione.");
  console.error(`Verifiche fallite: ${failures.join(", ")}`);
  console.error("Procedura corretta: cPanel → Domains → crea un sottodominio con docroot dedicato (vedi DEPLOY-CPANEL.md, Parte 1).");
  process.exit(1);
}
console.log("PREFLIGHT OK: la destinazione è un sottodominio dedicato senza WordPress. Si può procedere.");
