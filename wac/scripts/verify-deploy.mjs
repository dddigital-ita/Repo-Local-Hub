#!/usr/bin/env node
/**
 * Verifica post-deploy del sito (Passo 3 di PIANO-NEXT-16-TURBOPACK.md).
 *
 * Esegue le asserzioni minime su un deployment appena pubblicato (staging o
 * produzione): rotte chiave 200, health con database collegato, sistema hero
 * presente nella home in UNA delle due varianti per contratto (hero-ab-gate):
 * animato (marker data-template=, valore letto dal DB) oppure statico
 * (fallback quando l'animato è spento per contratto — es. Salento). L'hero
 * è un gate A/B: la variante attiva è configurazione di sito, non difetto
 * del deploy, quindi il guard accetta entrambe senza eccezioni per sito.
 * Exit 1 al primo fallimento: un deploy da non dichiarare buio.
 *
 * Uso:
 *   node scripts/verify-deploy.mjs https://<deployment>.vercel.app
 *   node scripts/verify-deploy.mjs http://localhost:3483          # locale
 *
 * Con --wp=https://www.tuodominio.com verifica ANCHE che il sito WordPress
 * principale resti online dopo il deploy dell'app (il check che mancava
 * il 28/09/2026, quando l'app registrata sul dominio principale l'ha
 * coperto). Consigliato in ogni deploy su cPanel.
 */
const args = process.argv.slice(2);
const wpArg = args.find((a) => a.startsWith("--wp="));
const base = (args.find((a) => !a.startsWith("--")) ?? "").replace(/\/$/, "");
if (!base || !/^https?:\/\//.test(base)) {
  console.error("Uso: node scripts/verify-deploy.mjs <https://deployment-url> [--wp=https://www.sito-principale.com]");
  process.exit(1);
}

const failures = [];
async function check(label, path, expect = 200) {
  try {
    const res = await fetch(base + path, { redirect: "manual" });
    const pass = res.status === expect;
    console.log(`${pass ? "✓" : "✖"} ${label}: ${res.status}${pass ? "" : ` (atteso ${expect})`}`);
    if (!pass) failures.push(label);
    return res;
  } catch (err) {
    console.log(`✖ ${label}: ERRORE ${err?.cause?.code ?? err?.message ?? err}`);
    failures.push(label);
    return null;
  }
}

console.log(`Verifica deploy su ${base}\n`);
await check("home", "/");
await check("consulenza", "/consulenza");
await check("sitemap", "/sitemap.xml");
await check("robots", "/robots.txt");
await check("health", "/api/health");

const healthRes = await fetch(base + "/api/health");
if (healthRes.ok) {
  const health = await healthRes.json();
  const dbOk = health?.database === "ok";
  console.log(`${dbOk ? "✓" : "✖"} health.database: ${health?.database} (status ${health?.status})`);
  if (!dbOk) failures.push("health.database");
} else {
  failures.push("health.database (non raggiungibile)");
}

const homeRes = await fetch(base + "/");
if (homeRes.ok) {
  const html = await homeRes.text();
  // Variante animata: <section data-template=…> in hero-animated.tsx
  // (il valore è la config DB, quindi il marker prova che il DB risponde).
  // Variante statica: <section class="relative overflow-hidden"> in
  // app/page.tsx — l'hero animato porta invece class="hero-animated
  // relative overflow-hidden" (prefisso hero-animated), che NON matcha
  // questo marcatore: le due varianti si escludono a vicenda.
  const hasAnimated = html.includes("data-template=");
  const hasStatic = html.includes('class="relative overflow-hidden"');
  const hasHero = hasAnimated || hasStatic;
  const variante = hasAnimated
    ? "animato presente (marker DB)"
    : hasStatic
      ? "statico presente (fallback contratto)"
      : "ASSENTE (né animato né statico)";
  console.log(`${hasHero ? "✓" : "✖"} home: sistema hero ${variante}`);
  if (!hasHero) failures.push("home.hero-marker");
} else {
  failures.push("home.hero-marker (home non raggiungibile)");
}

// ── Check 28/09: il WordPress principale deve restare online ──────────────
if (wpArg) {
  const wpBase = wpArg.slice("--wp=".length).replace(/\/$/, "");
  try {
    const wpRes = await fetch(wpBase, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    // 200 = sito vivo. Un redirect 301 verso la stessa casistica è accettabile
    // (es. verso https): ciò che conta è che NON sia 502/503/timeout, cioè
    // il segnale di Passenger che ha preso il posto di PHP.
    const ok = wpRes.status === 200 || wpRes.status === 301;
    console.log(`${ok ? "✓" : "✖"} sito WordPress principale (${wpBase}): ${wpRes.status}${ok ? "" : " — l'app sta coprendo il dominio principale!"}`);
    if (!ok) failures.push("wordpress-principale");
  } catch (err) {
    console.log(`✖ sito WordPress principale (${wpBase}): ERRORE ${err?.cause?.code ?? err?.message ?? err}`);
    failures.push("wordpress-principale");
  }
}

console.log("");
if (failures.length) {
  console.error(`DEPLOY NON VALIDO: ${failures.length} verifiche fallite: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("Deploy valido: tutte le verifiche passate.");
