#!/usr/bin/env node
/**
 * Verifica post-deploy del sito (Passo 3 di PIANO-NEXT-16-TURBOPACK.md).
 *
 * Esegue le asserzioni minime su un deployment appena pubblicato (staging o
 * produzione): rotte chiave 200, health con database collegato, marker del
 * sistema hero presente nella home (prova che il DB di produzione risponde).
 * Exit 1 al primo fallimento: un deploy da non dichiarare buio.
 *
 * Uso:
 *   node scripts/verify-deploy.mjs https://<deployment>.vercel.app
 *   node scripts/verify-deploy.mjs http://localhost:3483          # locale
 */
const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base || !/^https?:\/\//.test(base)) {
  console.error("Uso: node scripts/verify-deploy.mjs <https://deployment-url>");
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
  const hasHero = html.includes("data-template=");
  console.log(`${hasHero ? "✓" : "✖"} home: marker sistema hero ${hasHero ? "presente (DB collegato)" : "ASSENTE"}`);
  if (!hasHero) failures.push("home.hero-marker");
} else {
  failures.push("home.hero-marker (home non raggiungibile)");
}

console.log("");
if (failures.length) {
  console.error(`DEPLOY NON VALIDO: ${failures.length} verifiche fallite: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("Deploy valido: tutte le verifiche passate.");
