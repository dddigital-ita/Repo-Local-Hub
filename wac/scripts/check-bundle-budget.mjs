#!/usr/bin/env node
/**
 * Soglia bundle: legge l'output di scripts/measure-payload.mjs e fallisce se
 * FIRST_LOAD_GZ_KB supera il budget. La misura è il sostituto della tabella
 * "First Load JS" rimossa in Next 16.
 *
 * Storia del contratto (vedi anche .github/workflows/bundle-watch.yml):
 *   210 kB  allarme sul regresso Turbopack (base webpack-16 ~198 kB)
 *   255 kB  dal 30/09: base reale 242 kB dopo la dieta framer-motion
 *           (reveal/banner/barra/hero in CSS nativo); +5% di margine.
 *           Un framer-motion intero (~70 kB gz) fa scattare l'allarme.
 *
 * Uso:
 *   node scripts/check-bundle-budget.mjs <file-output-measure>
 *   node scripts/check-bundle-budget.mjs <file> --budget 255
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Uso: node scripts/check-bundle-budget.mjs <file-output-measure> [--budget 210]");
  process.exit(2);
}
const budgetFlag = process.argv.indexOf("--budget");
const budget = budgetFlag !== -1 ? Number(process.argv[budgetFlag + 1]) : 255;

let text;
try {
  text = readFileSync(file, "utf8");
} catch {
  console.error(`File non trovato: ${file} — lancia prima scripts/measure-payload.mjs`);
  process.exit(2);
}
const match = text.match(/FIRST_LOAD_GZ_KB=([\d.]+)/);
if (!match) {
  console.error("Output senza FIRST_LOAD_GZ_KB: lancia prima scripts/measure-payload.mjs");
  process.exit(2);
}
const kb = Number(match[1]);
const ok = kb <= budget;
console.log(`${ok ? "✓" : "✖"} first load: ${kb} kB gzip (budget ${budget} kB)`);
process.exit(ok ? 0 : 1);
