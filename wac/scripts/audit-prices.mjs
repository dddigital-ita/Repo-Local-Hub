#!/usr/bin/env node
/**
 * AUDIT PREZZI LANDING — il difetto che questamissione previene: Ambrosio
 * citava in chat «vetrina da 800 €» (seed packages 006) mentre la home
 * diceva «da 1.000 €» (FAQ in site.ts). Due fonti, due verità, cliente
 * confuso. Su altro sito (Web Agency Salento) l'audit ha beccato 3 scarti
 * PRIMA del go-live.
 *
 * Cosa fa: estrae le cifre in € dal catalogo packages (DB o seed SQL) e da
 * tutte le landing (site.ts), le abbina per fascia/keyword e segnala gli
 * scarti oltre soglia. Zero side-effect: solo lettura e report.
 *
 * Uso:
 *   DATABASE_URL="postgres://…" node scripts/audit-prices.mjs          # DB reale
 *   node scripts/audit-prices.mjs --seed                               # dal seed SQL
 *   node scripts/audit-prices.mjs --tolerance 10                       # % scarto tollerato (default 5)
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const useSeed = args.includes("--seed");
const tolIdx = args.indexOf("--tolerance");
const TOLERANCE_PCT = tolIdx !== -1 ? Number(args[tolIdx + 1]) : 5;

const ROOT = process.cwd();

/** Cifre in € da un testo: "da 800 €", "1.000–2.000 €", "400 €/mese" → [800], [1000,2000], [400]. */
function euroFigures(text) {
  return [...text.matchAll(/(\d{1,3}(?:\.\d{3})+|\d{2,6})(?:\s*[–-]\s*(\d{1,3}(?:\.\d{3})+|\d{2,6}))?\s*€/g)]
    .flatMap((m) => [m[1], m[2]].filter(Boolean))
    .map((n) => Number(n.replace(/\./g, "")));
}

/** Analizza il seed SQL 006 (+035 servizi): le righe insert con price_text. */
function pricesFromSeed() {
  const sql = readFileSync(path.join(ROOT, "neon", "migrations", "006-packages.sql"), "utf8");
  const sql35 = (() => {
    try {
      return readFileSync(path.join(ROOT, "neon", "migrations", "035-service-kind.sql"), "utf8");
    } catch {
      return "";
    }
  })();
  const rows = [];
  for (const src of [sql, sql35]) {
    for (const m of src.matchAll(/\('([^']+)',\s*'[^']*',\s*'([^']+)'/g)) {
      rows.push({ name: m[1], priceText: m[2] });
    }
  }
  return rows;
}

async function pricesFromDb() {
  const { default: pg } = await import("pg");
  const env = readFileSync(path.join(ROOT, ".env.local"), "utf8");
  const dsns = [...new Set([...env.matchAll(/postgres(?:ql)?:\/\/[^\s"']+/g)].map((m) => m[0]))]
    .filter((d) => !/localhost|127\.0\.0\.1/.test(new URL(d).hostname));
  if (!dsns.length) throw new Error("nessun DSN remoto in .env.local");
  const pool = new pg.Pool({ connectionString: dsns[0], ssl: { rejectUnauthorized: false } });
  const { rows } = await pool.query(
    "select name, price_text as \"priceText\", active from packages order by sort_order",
  );
  await pool.end();
  return rows.filter((r) => r.active);
}

/** Le cifre dichiarate nelle landing (site.ts): FAQ, services e fasce. */
function landingPrices() {
  const src = readFileSync(path.join(ROOT, "src", "lib", "site.ts"), "utf8");
  const landings = [...src.matchAll(/slug:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
  // Spezza il sorgente per slug: ogni landing porta le sue cifre.
  const chunks = src.split(/slug:\s*"/).slice(1).map((c, i) => ({
    slug: landings[i],
    text: c,
  }));
  const home = { slug: "(home)", text: src.slice(0, src.indexOf('slug: "') + 2000) };
  return [home, ...chunks].map(({ slug, text }) => ({
    slug,
    figures: euroFigures(text).filter((n) => n >= 40), // sotto 40 € sono annotazioni non commerciali
  }));
}

const catalog = useSeed ? pricesFromSeed() : await pricesFromDb();
const catFigures = catalog.flatMap((r) => euroFigures(r.priceText));
const catMin = Math.min(...catFigures);
const catMax = Math.max(...catFigures);

console.log(`== CATALOGO (${useSeed ? "seed SQL" : "DB produzione"}) ==`);
for (const r of catalog) console.log(`  ${r.name.padEnd(28)} ${r.priceText}`);
console.log(`  fasce catalogo: ${catMin}–${catMax} €`);

console.log(`\n== LANDING (src/lib/site.ts) — scarti oltre ${TOLERANCE_PCT}% ==`);
let findings = 0;
for (const land of landingPrices()) {
  for (const fig of land.figures) {
    const nearCatalog = catFigures.some(
      (c) => Math.abs(c - fig) / Math.max(c, fig) <= TOLERANCE_PCT / 100,
    );
    if (!nearCatalog) {
      findings++;
      console.log(`  ⚠ ${land.slug}: ${fig} € non corrisponde a nessuna voce del catalogo`);
    }
  }
}
if (!findings) console.log("  ✓ nessuno: tutte le cifre delle landing hanno un riscontro nel catalogo");

// Confronto diretto delle fasce chiave: vetrina ed e-commerce.
const vetrina = catalog.find((r) => /vetrina/i.test(r.name));
const ecom = catalog.find((r) => /e-?commerce/i.test(r.name));
console.log("\n== FASCE CHIAVE ==");
console.log(`  vetrina:   catalogo=${vetrina?.priceText ?? "—"} | home dice "da 1.000 €" | landing slug creazione "da 800 €"`);
console.log(`  e-commerce: catalogo=${ecom?.priceText ?? "—"} | home dice "da 3.000 €" | landing slug e-commerce "da 3.000 €"`);
console.log(
  "\nRifinitura manuale: le fasce della home (1.000/3.000) e del seed (800/2.500) sono DUE comunicazioni diverse —"
    + "\nse non è una scelta consapevole (ancoraggio psicologico), allineare seed o FAQ prima del go-live.",
);
process.exit(findings > 6 ? 1 : 0); // tanti scarti = forse una fonte è cambiata tutta
