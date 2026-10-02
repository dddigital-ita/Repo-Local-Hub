#!/usr/bin/env node
/**
 * Soglia bundle: legge l'output di scripts/measure-payload.mjs e fallisce se
 * FIRST_LOAD_GZ_KB supera il budget. La misura è il sostituto della tabella
 * "First Load JS" rimossa in Next 16; il budget di riferimento è la build
 * webpack-16 misurata col metodo corretto (senza i polyfill nomodule che i
 * browser moderni non scaricano): 168,4 kB home gzip. L'allarme suona oltre
 * il +6% (≈ 180 kB): esattamente il regresso da non pagare due volte.
 *
 * Uso:
 *   node scripts/check-bundle-budget.mjs <file-output-measure>
 *   node scripts/check-bundle-budget.mjs <file> --budget 180
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Uso: node scripts/check-bundle-budget.mjs <file-output-measure> [--budget 180]");
  process.exit(2);
}
const budgetFlag = process.argv.indexOf("--budget");
const budget = budgetFlag !== -1 ? Number(process.argv[budgetFlag + 1]) : 180;

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
