#!/usr/bin/env node
/**
 * FRAMER-FIRSTLOAD (livello runtime del bundle-watch): scarica l'HTML delle
 * pagine pubbliche da un server Next avviato sulla build di release, segue i
 * tag <script> (esclusi i nomodule, che i browser moderni non scaricano) e
 * cerca i marker framer-motion nei byte reali che il browser scaricherebbe.
 *
 * Il livello statico (tests/framer-firstload.sentinel.test.mjs) becca gli
 * import diretti/indiretti dal grafo del repo; questo becca TUTTO ciò che
 * finisce nei chunk, incluse librerie terze che a loro volta importano
 * framer. Fallisce con exit 1 alla prima contaminazione.
 *
 * Uso (dietro un server di misura, come check-bundle-budget):
 *   node scripts/check-framer-firstload.mjs http://localhost:3483
 */
import http from "node:http";

const base = process.argv[2] ?? "http://localhost:3483";
/** Rotte pubbliche sorvegliate: la home, una landing locale e la chat. */
const ROUTES = ["/", "/siti-web-gallipoli", "/consulenza?q=sito+web"];
const MARKERS = ["useReducedMotion", "AnimatePresence"];

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

let contaminated = 0;
for (const route of ROUTES) {
  const html = (await get(base + route)).toString();
  const tags = [...html.matchAll(/<script[^>]*src="(\/_next\/[^"]+?\.js)"[^>]*>/g)];
  const jsRefs = [...new Set(tags.map((t) => t[1]))];
  let framerKb = 0;
  let totalKb = 0;
  for (const ref of jsRefs) {
    const tag = tags.find((t) => t[1] === ref)[0];
    const buf = await get(base + ref);
    const kb = buf.length / 1024;
    // nomodule = polyfill legacy: i browser moderni non lo scaricano mai.
    if (/nomodule/i.test(tag)) continue;
    totalKb += kb;
    const body = buf.toString();
    if (MARKERS.some((m) => body.includes(m))) {
      framerKb += kb;
      contaminated++;
      console.error(`✖ ${route} → chunk contaminato: ${ref.split("/").pop()} (${kb.toFixed(1)} kB)`);
    }
  }
  const ok = framerKb === 0;
  console.log(
    `${ok ? "✓" : "✖"} ${route}: first load ${totalKb.toFixed(1)} kB · framer-motion ${framerKb.toFixed(1)} kB`,
  );
}

if (contaminated > 0) {
  console.error(
    "\nframer-motion è nel first load di pagine pubbliche: sposta l'animazione su " +
      "IntersectionObserver + CSS (vedi src/components/motion.tsx) o confina il " +
      "componente in /admin e /consulenza.",
  );
  process.exit(1);
}
console.log("\nnessun chunk framer-motion nel first load pubblico ✓");
