#!/usr/bin/env node
/**
 * Diagnosa bundle: elenca gli asset della route col relativo peso gzip,
 * ordinati dal più pesante. Compagna di scripts/measure-payload.mjs:
 * mentre quello dice QUANTO pesa la first load, questo dice DOVE.
 *
 * Funziona SENZA server per le route prerenderizzate (SSG, come la home):
 * legge l'HTML da <dist>/server/app/index.html e misura i file dal disco.
 *
 * Uso:
 *   node scripts/bundle-what.mjs                    # home, dist .next-prod
 *   WAC_DIST_DIR=.next node scripts/bundle-what.mjs
 *   node scripts/bundle-what.mjs --live http://localhost:3483 /   # con server
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const DIST = path.join(ROOT, process.env.WAC_DIST_DIR ?? ".next-prod");
const liveIdx = process.argv.indexOf("--live");
const liveUrl = liveIdx !== -1 ? process.argv[liveIdx + 1] : null;
const liveRoute = liveIdx !== -1 ? process.argv[liveIdx + 2] ?? "/" : null;

function human(kb) {
  return `${kb.toFixed(1).padStart(8)} kB`;
}

function report(rows) {
  rows.sort((a, b) => b.kb - a.kb);
  let js = 0;
  let css = 0;
  for (const r of rows) {
    if (r.type === "css") css += r.kb;
    else js += r.kb;
    console.log(`${human(r.kb)}  ${r.type.toUpperCase()}  ${r.asset}`);
  }
  console.log("—".repeat(60));
  console.log(`js_gz=${js.toFixed(1)}kB css_gz=${css.toFixed(1)}kB  (senza html)`);
}

/* ── Modalità LIVE (server acceso): fetch HTML + asset via HTTP ── */
if (liveUrl) {
  const http = await import("node:http");
  const get = (url) =>
    new Promise((resolve, reject) => {
      http.get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`${res.statusCode} ${url}`));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      }).on("error", reject);
    });
  const base = liveUrl.replace(/\/$/, "");
  const html = (await get(base + liveRoute)).toString();
  const refs = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="(\/_next\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]),
    ),
  ];
  const rows = [];
  for (const ref of refs) {
    const buf = await get(base + ref);
    rows.push({
      asset: ref.replace("/_next/static/", ""),
      type: ref.endsWith(".css") ? "css" : "js",
      kb: zlib.gzipSync(buf).length / 1024,
    });
  }
  report(rows);
  process.exit(0);
}

/* ── Modalità DISCO (SSG): HTML prerenderizzato + file dal disco ── */
const htmlPath = path.join(DIST, "server", "app", "index.html");
if (!fs.existsSync(htmlPath)) {
  console.error(`HTML prerenderizzato non trovato: ${htmlPath}`);
  console.error("La home è SSG solo se prerenderizzata: usa --live con il server acceso.");
  process.exit(2);
}
const html = fs.readFileSync(htmlPath, "utf8");
const refs = [
  ...new Set(
    [...html.matchAll(/(?:src|href)="(\/_next\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]),
  ),
];
const rows = [];
for (const ref of refs) {
  const file = path.join(DIST, "static", ref.replace("/_next/static/", ""));
  if (!fs.existsSync(file)) {
    console.error(`asset mancante: ${ref}`);
    continue;
  }
  rows.push({
    asset: ref.replace("/_next/static/", ""),
    type: ref.endsWith(".css") ? "css" : "js",
    kb: zlib.gzipSync(fs.readFileSync(file)).length / 1024,
  });
}
report(rows);
