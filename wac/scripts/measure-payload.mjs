#!/usr/bin/env node
/**
 * Misura del payload client reale (first load) di una build Next.
 *
 * Da Next 16 la tabella "First Load JS" è scomparsa dall'output di build:
 * questa misura è il suo sostituto permanente per la sorveglianza bundle
 * (Passo 4 di PIANO-NEXT-16-TURBOPACK.md). Scarica l'HTML della route,
 * estrae i riferimenti a /_next/*.js e *.css, li scarica e somma le
 * dimensioni gzip (gzipSync deterministico, indipendente dal server).
 *
 * Uso:
 *   node scripts/measure-payload.mjs [url] [route]
 *   default: http://localhost:3483 /
 *
 * Esempio completo (build + misura):
 *   WAC_DIST_DIR=.next-prod npx next build
 *   WAC_DIST_DIR=.next-prod PORT=3483 npx next start &
 *   node scripts/measure-payload.mjs http://localhost:3483 /
 */
import http from "node:http";
import zlib from "node:zlib";

const base = process.argv[2] ?? "http://localhost:3483";
const route = process.argv[3] ?? "/";

function get(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`${res.statusCode} su ${url}`));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

const html = (await get(base.replace(/\/$/, "") + route)).toString();
const refs = [
  ...new Set(
    [...html.matchAll(/(?:src|href)="(\/_next\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]),
  ),
];
let js = 0;
let css = 0;
for (const ref of refs) {
  const buf = await get(base.replace(/\/$/, "") + ref);
  const gz = zlib.gzipSync(buf).length;
  if (ref.endsWith(".css")) css += gz;
  else js += gz;
}
const htmlGz = zlib.gzipSync(Buffer.from(html)).length;
const kb = (n) => (n / 1024).toFixed(1);
console.log(`route=${route} assets=${refs.length}`);
console.log(`js_gz=${kb(js)}kB css_gz=${kb(css)}kB html_gz=${kb(htmlGz)}kB`);
console.log(`FIRST_LOAD_GZ_KB=${kb(js + css + htmlGz)}`);
