#!/usr/bin/env node
/**
 * twin-sync — allinea i file condivisi per contratto tra i repo gemelli
 * (manifest twin-sync.json): funzioni e strumenti, MAI contenuti, pagine
 * o file admin. Direzione di default: il repo del manifest (source-repo,
 * WebAgencyCrema) verso il gemello; --from <dir> inverte.
 *
 * Dry-run di default: senza --apply mostra il piano e l'esito del confronto.
 * I blocchi «twin-sync: per-repo» sono gestiti per-repo: il confronto li
 * esclude e il sync NON li sovrascrive (la costante dev di un repo non
 * finisce nell'altro — stesso esterno, interni diversi per contratto).
 *
 * Uso:
 *   node scripts/twin-sync.mjs                 # dry-run, Crema → gemello
 *   node scripts/twin-sync.mjs --check         # solo esito (exit 1 se diverge)
 *   node scripts/twin-sync.mjs --apply         # scrive i file nel gemello
 *   node scripts/twin-sync.mjs --from ../altro # inverte la direzione
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const checkOnly = args.includes("--check");
const fromIdx = args.indexOf("--from");
const fromArg = fromIdx > -1 ? args[fromIdx + 1] : null;

const root = process.cwd();
const manifestPath = path.join(root, "twin-sync.json");
if (!existsSync(manifestPath)) {
  console.error("twin-sync: manifest non trovato (twin-sync.json) — eseguire dal repo che lo contiene.");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

/** La controparte: dalla direzione decisa (default: source → twin). */
function twinRoot() {
  if (fromArg) return path.resolve(root, fromArg); // invertita: --from È la fonte
  const parent = path.dirname(root);
  return path.join(parent, manifest["twin-name"]);
}
const srcRoot = fromArg ? twinRoot() : root;
const dstRoot = fromArg ? root : twinRoot();

/** Divide il testo in segmenti: fuori blocco (confrontato) e dentro (mai toccato). */
function segmenti(testo) {
  const RE = /^\/\/ twin-sync: per-repo BEGIN[\s\S]*?^\/\/ twin-sync: per-repo END.*$/m;
  const out = [];
  let rest = testo;
  while (true) {
    const m = rest.match(RE);
    if (!m) break;
    if (m.index > 0) out.push({ per: false, text: rest.slice(0, m.index) });
    out.push({ per: true, text: m[0] });
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) out.push({ per: false, text: rest });
  return out;
}

/** Il confronto: segmenti FUORI blocco uguali = file allineato per contratto. */
function confronta(a, b) {
  const sa = segmenti(a).filter((s) => !s.per).map((s) => s.text).join("");
  const sb = segmenti(b).filter((s) => !s.per).map((s) => s.text).join("");
  return sa === sb;
}

/**
 * La scrittura di apply NON copia il file intero: i blocchi per-repo della
 * DESTINAZIONE restano suoi (le sue costanti d'ambiente), tutto il resto
 * arriva dalla sorgente. Se la destinazione non ha un blocco lì dove la
 * sorgente sì (prima adozione), il blocco della sorgente viene inserito —
 * sarà il repo destinatario ad adattare le sue costanti nel commit che segue.
 */
function fondi(sorgente, destinazione) {
  const blocchiDst = segmenti(destinazione).filter((s) => s.per).map((s) => s.text);
  let i = 0;
  let out = "";
  for (const seg of segmenti(sorgente)) {
    if (!seg.per) {
      out += seg.text;
    } else if (i < blocchiDst.length) {
      out += blocchiDst[i++];
    } else {
      out += seg.text; // prima adozione: niente blocco locale da preservare
    }
  }
  return out;
}

let uguali = 0;
let daSincronizzare = [];
let mancanti = [];

for (const rel of manifest.files) {
  const src = path.join(srcRoot, rel);
  const dst = path.join(dstRoot, rel);
  if (!existsSync(dst)) {
    // File nuovo nel contratto: in apply viene CREATO nel gemello (copia
    // intera: non c'è una versione locale da preservare). In dry-run è
    // segnalato come mancante, senza scrivere.
    if (existsSync(src) && apply) {
      writeFileSync(dst, readFileSync(src, "utf8"));
      daSincronizzare.push({ rel, scritto: true, creato: true });
    } else {
      mancanti.push({ rel, src: existsSync(src), dst: false });
    }
    continue;
  }
  if (!existsSync(src)) {
    mancanti.push({ rel, src: false, dst: true });
    continue;
  }
  const a = readFileSync(src, "utf8");
  const b = readFileSync(dst, "utf8");
  if (confronta(a, b)) {
    uguali++;
  } else if (apply) {
    writeFileSync(dst, fondi(a, b));
    daSincronizzare.push({ rel, scritto: true });
  } else {
    daSincronizzare.push({ rel, scritto: false });
  }
}

const direzione = fromArg ? `${path.basename(srcRoot)} → ${path.basename(dstRoot)} (invertita)` : `${manifest["source-repo"]} → ${manifest["twin-name"]}`;
console.log(`twin-sync [${direzione}] — dry-run: ${apply ? "NO (applico)" : "sì"} · ${manifest.files.length} file nel manifest`);
for (const { rel, scritto, creato } of daSincronizzare)
  console.log(`  ${apply && scritto ? (creato ? "✚ CREATO" : "✚ SINC") : "≠ DIVERGE"}  ${rel}`);
for (const m of mancanti) console.log(`  ? MANCANTE ${m.rel} (sorgente: ${m.src ? "ok" : "NO"}, destinazione: ${m.dst ? "ok" : "NO"})`);
console.log(`Risultato: ${uguali} uguali · ${daSincronizzare.length} da sincronizzare · ${mancanti.length} mancanti`);

if (mancanti.length > 0) process.exit(2);
if (daSincronizzare.length > 0 && (checkOnly || !apply)) process.exit(1);
