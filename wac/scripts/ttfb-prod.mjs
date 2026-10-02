#!/usr/bin/env node
/**
 * TTFB PRODUZIONE — strumento MANUALE del piano prestazioni 2026-10-02.
 *
 * Misura il time-to-first-byte delle pagine dei due siti di produzione:
 * gli hub admin (/admin, /admin/settings, /admin/tools) E le pagine
 * pubbliche (home + landing SEO, slug diverso per gemello), PRIMA e
 * DOPO ogni rilascio (Step 1, deploy 0.8.0…), e salva:
 *
 *   - docs/telemetria-ttfb/<fase>-<siti>-<data>.json  (dati grezzi del run)
 *   - docs/TELEMETRIA-TTFB.md                          (report accumulabile:
 *     le sezioni nuove vanno in CIMA, così l'ultimo stato si legge subito)
 *
 * Ogni run è una sezione con la STESSA tabella → prima e dopo si leggono
 * affiancate; `--confronta` aggiunge in cima il Δ (ms e %) fra le due fasi
 * più recenti.
 *
 * Serve una sessione admin VERA di produzione: il login è dietro Turnstile,
 * lo script NON fa login — copia il cookie dalla sessione del tuo browser
 * (DevTools → Application → Cookies → `wac_admin`, TTL 12h) e passalo via
 * ambiente. Un redirect verso il login (cookie scaduto) annulla il run.
 *
 *   ADMIN_COOKIE_CREMA="wac_admin=…" \
 *   ADMIN_COOKIE_SALENTO="wac_admin=…" \
 *   node scripts/ttfb-prod.mjs --fase prima
 *   # … Step 1 + deploy …
 *   ADMIN_COOKIE_CREMA="wac_admin=…" node scripts/ttfb-prod.mjs --fase dopo-step1
 *   node scripts/ttfb-prod.mjs --confronta
 *
 *   # Prodlike (server locale), sito per sito — col cookie di sessione prodlike:
 *   node scripts/ttfb-prod.mjs --site crema --base-crema http://localhost:3105 \
 *     --fase prodlike-prima
 *
 * Il freddo si misura con `--attesa 330` dopo ≥5 minuti di inattività
 * (finestra di scale-to-zero di Neon), mai ripetendo i colpi. Il cookie non
 * finisce mai nel report né nei JSON: solo «cookie: sì».
 *
 * Regole AGENTS.md rispettate: nessun cron/keepalive/probe — lo strumento
 * gira solo quando lo lanci tu.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_MD = path.join(ROOT, "docs", "TELEMETRIA-TTFB.md");
const REPORT_DIR = path.join(ROOT, "docs", "telemetria-ttfb");

/** I due gemelli: lo script è byte-identico nei due repo, il sito è un argomento. */
export const SITI = {
  crema: { label: "WebAgencyCrema", base: "https://www.webagencycrema.com" },
  salento: { label: "Web Agency Salento", base: "https://www.webagencysalento.com" },
};

/** Gli hub admin del piano: le pagine che pagavano 18–21 query a navigazione. */
export const PAGINE = ["/admin", "/admin/settings", "/admin/tools"];

/**
 * Le pagine PUBBLICHE del piano, per sito: la home e la landing SEO
 * principale (slug diverso per gemello — lo script resta identico,
 * la pagina è dato per sito come la base). Misurabili senza cookie,
 * in qualsiasi momento: nessuna sessione admin coinvolta.
 */
export const PAGINE_PUBBLICHE = {
  crema: ["/", "/seo-crema"],
  salento: ["/", "/seo-salento"],
};

/** Insiemi misurabili: gli hub admin (default), le pagine pubbliche, entrambi. */
export const INSIEMI = ["admin", "pubbliche", "tutte"];

/** Le pagine di un sito per l'insieme scelto. */
export function paginePerInsieme(key, args) {
  if (args.insieme === "pubbliche") return PAGINE_PUBBLICHE[key];
  if (args.insieme === "tutte") return [...PAGINE, ...PAGINE_PUBBLICHE[key]];
  return PAGINE;
}

/** L'insieme «pubbliche» è pubblico: nessun cookie di sessione richiesto. */
export function serveCookie(args) {
  return args.insieme !== "pubbliche";
}

export const TIMEOUT_MS_DEFAULT = 30_000;
const UA = "wac-ttfb/1.0 (misurazione manuale del piano prestazioni)";

/** Intestazione fissa del report: una volta sola, sempre in cima al file. */
export const INTESTAZIONE_MD =
  "# Telemetria TTFB produzione — admin e pagine pubbliche (prima/dopo)\n\n" +
  "Report di `scripts/ttfb-prod.mjs` (piano prestazioni 2026-10-02): ogni run è una sezione\n" +
  "con la stessa tabella e le sezioni nuove stanno in CIMA; `--confronta` aggiunge il Δ fra\n" +
  "le due fasi più recenti. Il cookie di sessione non compare mai in questo file.\n";

const AIUTO = `Uso:
  ADMIN_COOKIE_CREMA="wac_admin=…" ADMIN_COOKIE_SALENTO="wac_admin=…" \\
    node scripts/ttfb-prod.mjs --fase prima
  node scripts/ttfb-prod.mjs --confronta

Argomenti:
  --fase NOME     etichetta del run (obbligatoria senza --confronta), es. prima | dopo-step1
  --site SITO     both (predefinito) | crema | salento
  --insieme NOME  admin (predefinito) | pubbiche (home+landing, SENZA cookie) | tutte
  --campioni N    richieste per pagina (predefinito 5)
  --attesa SEC    attesa prima di misurare, per il freddo (es. 330 dopo ≥5 min di inattività)
  --base URL      sovrascrive la base di TUTTI i siti scelti
  --base-crema URL    sovrascrive la base del solo Crema (es. prodlike http://localhost:3105)
  --base-salento URL  sovrascrive la base del solo Salento (es. prodlike http://localhost:3105)
  --timeout MS    timeout per richiesta (predefinito ${TIMEOUT_MS_DEFAULT})
  --confronta     confronta le due fasi più recenti e aggiorna il report
  --help          questo aiuto
`;

export function parseArgs(argv) {
  const args = {
    fase: null,
    site: "both",
    insieme: "admin",
    campioni: 5,
    attesa: 0,
    base: null,
    baseSiti: {},
    timeout: TIMEOUT_MS_DEFAULT,
    confronta: false,
    aiuto: false,
  };
  let i = 0;
  const valore = (nome) => {
    const v = argv[++i];
    if (v === undefined || v.startsWith("--")) throw new Error(`Valore mancante per ${nome}`);
    return v;
  };
  while (i < argv.length) {
    const a = argv[i];
    switch (a) {
      case "--fase": args.fase = valore("--fase"); break;
      case "--site": args.site = valore("--site"); break;
      case "--insieme": args.insieme = valore("--insieme"); break;
      case "--campioni": args.campioni = Number(valore("--campioni")); break;
      case "--attesa": args.attesa = Number(valore("--attesa")); break;
      case "--base": args.base = valore("--base"); break;
      case "--base-crema": args.baseSiti.crema = valore("--base-crema"); break;
      case "--base-salento": args.baseSiti.salento = valore("--base-salento"); break;
      case "--timeout": args.timeout = Number(valore("--timeout")); break;
      case "--confronta": args.confronta = true; break;
      case "--help":
      case "-h": args.aiuto = true; return args;
      default: throw new Error(`Argomento non riconosciuto: ${a} (usa --help)`);
    }
    i++;
  }
  if (args.aiuto) return args;
  if (!Number.isInteger(args.campioni) || args.campioni < 1 || args.campioni > 50)
    throw new Error("--campioni deve essere un intero fra 1 e 50.");
  if (!Number.isFinite(args.attesa) || args.attesa < 0 || args.attesa > 3600)
    throw new Error("--attesa deve essere un numero di secondi fra 0 e 3600.");
  if (!Number.isFinite(args.timeout) || args.timeout < 1000)
    throw new Error("--timeout deve essere un numero di millisecondi ≥ 1000.");
  if (!INSIEMI.includes(args.insieme))
    throw new Error(`--insieme non valido: ${args.insieme} (uso: ${INSIEMI.join(" | ")})`);
  for (const [nome, v] of [
    ...(args.base === null ? [] : [["--base", args.base]]),
    ...Object.entries(args.baseSiti).map(([k, v]) => [`--base-${k}`, v]),
  ]) {
    try {
      new URL(v);
    } catch {
      throw new Error(`${nome} non è un URL valido: ${v}`);
    }
  }
  return args;
}

/** Mediana semplice (arrotondata a ms interi): il «caricamento tipico» del piano. */
export function mediana(numeri) {
  if (numeri.length === 0) return null;
  const s = [...numeri].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function aggrega(campioni) {
  const ttfb = campioni.map((c) => c.ttfbMs);
  return {
    n: campioni.length,
    min: Math.min(...ttfb),
    mediana: mediana(ttfb),
    max: Math.max(...ttfb),
    media: Math.round(ttfb.reduce((a, b) => a + b, 0) / campioni.length),
  };
}

/** Il Δ% del piano: negativo = miglioramento. */
export function deltaPercent(dopo, prima) {
  if (!prima || prima === 0) return null;
  return Math.round(((dopo - prima) / prima) * 100);
}

/** Il valore più frequente (per regione funzione / cache: la modalità dei campioni). */
export function modalita(vals) {
  const conteggi = new Map();
  for (const v of vals) conteggi.set(v, (conteggi.get(v) ?? 0) + 1);
  let best = "";
  let n = 0;
  for (const [v, c] of conteggi) if (c > n) [best, n] = [v, c];
  return best;
}

/** Una riga pagina del run → riga markdown della tabella. */
export function rigaPagina(p) {
  return `| \`${p.path}\` | ${p.min}ms | **${p.mediana}ms** | ${p.max}ms | ${p.media}ms | ${p.n} | \`${p.funzione || "—"}\` | \`${p.cache || "—"}\` |`;
}

export function renderMarkdown(run) {
  const parti = [];
  parti.push(
    `## [${run.fase}] ${run.quando} — ${run.siti.map((s) => s.label).join(" + ")}\n\n` +
      `Campioni per pagina: ${run.campioni}` +
      (run.attesaSec ? `, attesa iniziale ${run.attesaSec}s (misurazione a freddo)` : ", a caldo") +
      `. Misurato da \`${run.misuratoDa}\`. ` +
      `Cookie di sessione: ${run.cookiePresente ? "sì (mai nel report)" : "no"}.`,
  );
  for (const sito of run.siti) {
    parti.push(
      `### ${sito.label} — ${sito.base}\n\n` +
        [
          "| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |",
          "|---|---|---|---|---|---|---|---|",
          ...sito.pagine.map(rigaPagina),
        ].join("\n"),
    );
  }
  return parti.join("\n\n") + "\n";
}

/** Confronto due run (prima/dopo) per lo stesso insieme di siti+pagine. */
export function renderConfronto(prima, dopo) {
  const parti = [`## Confronto [${prima.fase}] → [${dopo.fase}] (${dopo.quando})`];
  for (const sitoDopo of dopo.siti) {
    const sitoPrima = prima.siti.find((s) => s.base === sitoDopo.base);
    if (!sitoPrima) {
      parti.push(
        `### ${sitoDopo.label} — ${sitoDopo.base}\n\n_Base diversa fra i due run (produzione vs prodlike?): righe omesse._`,
      );
      continue;
    }
    const righe = ["| Pagina | PRIMA mediana | DOPO mediana | Δ | Δ% |", "|---|---|---|---|---|"];
    for (const p of sitoDopo.pagine) {
      const q = sitoPrima.pagine.find((x) => x.path === p.path);
      if (!q) continue;
      const d = p.mediana - q.mediana;
      const dp = deltaPercent(p.mediana, q.mediana);
      righe.push(
        `| \`${p.path}\` | ${q.mediana}ms | **${p.mediana}ms** | ${d > 0 ? "+" : ""}${d}ms | ${dp === null ? "—" : `${dp > 0 ? "+" : ""}${dp}%`} |`,
      );
    }
    parti.push(`### ${sitoDopo.label} — ${sitoDopo.base}\n\n${righe.join("\n")}`);
  }
  return parti.join("\n\n") + "\n";
}

/**
 * Inserisce una nuova sezione nel report: le sezioni nuove vanno IN CIMA,
 * subito dopo l'intestazione fissa (che resta una sola, prima riga del file).
 * Se il corpo esistente non ha l'intestazione (file scritto a mano), la aggiunge.
 */
export function componiReport(corpoEsistente, sezione) {
  if (!corpoEsistente || !corpoEsistente.trim()) {
    return INTESTAZIONE_MD + "\n---\n\n" + sezione;
  }
  // L'intestazione fissa è il blocco in testa fino al primo "---": la
  // riconosciamo dall'H1 (non dal testo esatto, che può variare fra
  // versioni dello strumento) così i report vecchi restano accumulabili.
  if (corpoEsistente.startsWith("# Telemetria TTFB produzione")) {
    const fine = corpoEsistente.indexOf("\n---");
    if (fine !== -1) {
      const testa = corpoEsistente.slice(0, fine);
      const resto = corpoEsistente.slice(fine).replace(/^\s*---\s*\n/, "");
      return testa + "\n---\n\n" + sezione + "\n" + resto;
    }
  }
  return INTESTAZIONE_MD + "\n---\n\n" + sezione + "\n" + corpoEsistente;
}

export function slug(s) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "run"
  );
}

/** Nome del JSON grezzo: precisione ai ms → due run non si sovrascrivono. */
export function nomeJson(fase, sitiKeys, iso) {
  return `${slug(fase)}-${sitiKeys.join("+")}-${iso.replace(/[:.]/g, "-")}.json`;
}

/** La base per un sito: override specifico (--base-<sito>) → override generico
 *  (--base) → dominio di produzione. Barra finale tolta. */
export function basePer(key, args, siti = SITI) {
  return (args.baseSiti?.[key] ?? args.base ?? siti[key].base).replace(/\/+$/, "");
}

function cookiePer(sitoKey, sitiSelezionati) {
  const perSito = process.env[`ADMIN_COOKIE_${sitoKey.toUpperCase()}`];
  if (perSito) return perSito.trim();
  if (sitiSelezionati.length === 1 && process.env.ADMIN_COOKIE) return process.env.ADMIN_COOKIE.trim();
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Una richiesta: TTFB = tempo fino agli header (il body la pagina lo consuma
 *  comunque, per non lasciare socket a metà). redirect manuale: un 307 verso
 *  /admin/login significa «sessione non valida» e blocca il run. */
async function misura(base, pathname, cookie, timeoutMs) {
  const t0 = performance.now();
  const headers = { "user-agent": UA };
  if (cookie) headers.cookie = cookie; // hub admin: le pagine pubbliche misurano senza sessione
  const res = await fetch(base + pathname, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const ttfbMs = Math.round(performance.now() - t0);
  await res.text();
  return {
    ttfbMs,
    totalMs: Math.round(performance.now() - t0),
    status: res.status,
    cache: res.headers.get("x-vercel-cache") ?? "",
    vercelId: res.headers.get("x-vercel-id") ?? "",
    versoLogin: (res.headers.get("location") ?? "").includes("/admin/login"),
    at: new Date().toISOString(),
  };
}

export async function esegui(args) {
  if (!args.fase)
    throw new Error(
      "Manca --fase (es. --fase prima / --fase dopo-step1): il report è confrontabile solo con fasi etichettate.",
    );
  const sitiSelezionati = args.site === "both" ? Object.keys(SITI) : [args.site];
  if (!sitiSelezionati.every((k) => k in SITI))
    throw new Error(`--site non valido: ${args.site} (uso: both | crema | salento)`);

  // Solo gli hub admin richiedono la sessione: le pagine pubbliche
  // (home e landing) si misurano senza cookie, da chiunque.
  const conCookie = serveCookie(args);
  const cookies = Object.fromEntries(
    sitiSelezionati.map((k) => [k, conCookie ? cookiePer(k, sitiSelezionati) : null]),
  );
  if (conCookie) {
    const mancanti = sitiSelezionati.filter((k) => !cookies[k]);
    if (mancanti.length) {
      throw new Error(
        `Cookie mancante per: ${mancanti.join(", ")}. Esporta ADMIN_COOKIE_<SITO>="wac_admin=…" ` +
          `(o ADMIN_COOKIE per un sito singolo): il login di produzione è dietro Turnstile, lo script non fa login.`,
      );
    }
  }

  if (args.attesa > 0) {
    console.log(`Attesa ${args.attesa}s prima di misurare (finestra per il freddo: Neon scale-to-zero)…`);
    await sleep(args.attesa * 1000);
  }

  const run = {
    fase: args.fase,
    quando: new Date().toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }),
    generato: new Date().toISOString(),
    campioni: args.campioni,
    attesaSec: args.attesa,
    misuratoDa: os.hostname(),
    cookiePresente: conCookie,
    siti: [],
  };

  console.log(`TTFB produzione — fase "${args.fase}" — ${args.campioni} campioni/pagina`);

  for (const key of sitiSelezionati) {
    const site = SITI[key];
    const base = basePer(key, args);
    console.log(`\n— ${site.label} (${base}) —`);
    const pagine = [];
    for (const pathname of paginePerInsieme(key, args)) {
      const campioni = [];
      for (let i = 0; i < args.campioni; i++) {
        const r = await misura(base, pathname, cookies[key], args.timeout);
        if (r.status >= 300 && r.status < 400) {
          throw new Error(
            `${pathname} risponde con un redirect (${r.status}${r.versoLogin ? " verso il login" : ""}): ` +
              (r.versoLogin
                ? "sessione non valida — ricopia il cookie wac_admin fresco dal browser (TTL 12h) e rilancia."
                : "controlla --base e la pagina."),
          );
        }
        if (r.status !== 200)
          throw new Error(`${pathname} risponde ${r.status}: annullo il run (i dati non sarebbero confrontabili).`);
        campioni.push(r);
        await sleep(250);
      }
      const agg = aggrega(campioni);
      // La FUNZIONE è il 2° segmento di x-vercel-id (es. fra1::iad1 → iad1):
      // è lì che lo Step 1 deve spostarla (atteso fra1 dopo il cambio region).
      const pagina = {
        path: pathname,
        ...agg,
        funzione: modalita(campioni.map((c) => (c.vercelId || "").split("::")[1] ?? "")),
        cache: modalita(campioni.map((c) => c.cache)),
        campioni,
      };
      pagine.push(pagina);
      console.log(
        `  ✓ ${pathname.padEnd(18)} TTFB mediana ${String(agg.mediana).padStart(5)}ms  ` +
          `(min ${agg.min} · max ${agg.max} · n=${agg.n})  funzione=${pagina.funzione || "—"}`,
      );
    }
    run.siti.push({ key, label: site.label, base, pagine });
  }

  // JSON grezzo del run + sezione markdown accumulata nel report (in cima).
  mkdirSync(REPORT_DIR, { recursive: true });
  const jsonPath = path.join(REPORT_DIR, nomeJson(args.fase, sitiSelezionati, run.generato));
  writeFileSync(jsonPath, JSON.stringify(run, null, 2) + "\n");

  const precedente = existsSync(REPORT_MD) ? readFileSync(REPORT_MD, "utf8") : "";
  writeFileSync(REPORT_MD, componiReport(precedente, renderMarkdown(run)));
  console.log(`\nReport aggiornato: ${path.relative(ROOT, REPORT_MD)}`);
  console.log(`Dati grezzi:        ${path.relative(ROOT, jsonPath)}`);
  console.log(`Poi, per il Δ prima→dopo: node scripts/ttfb-prod.mjs --confronta`);
  return run;
}

/**
 * --confronta: le due fasi più recenti misurate sugli STESSI URL (produzione
 * e prodlike hanno basi diverse → gruppi separati, mai mescolati). Fra i
 * gruppi vince quello con più fasi; a parità di fasi, quello col run più
 * recente. Dentro il gruppo: prima = fase più vecchia, dopo = più recente
 * (per una fase ripetuta vale l'ultimo run).
 */
export function caricaConfronto(dir = REPORT_DIR) {
  if (!existsSync(dir)) throw new Error(`Nessun run ancora salvato in ${dir}: lancia prima le misure.`);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (files.length < 2) throw new Error("Servono almeno due run salvati per confrontare.");
  const parse = (f) => JSON.parse(readFileSync(path.join(dir, f), "utf8"));

  // L'ultimo run per (fase + insieme di basi): la stessa fase può esistere
  // sia su produzione sia su prodlike, e si può ripetere.
  const perFaseBasi = new Map();
  for (const f of files) {
    const run = parse(f);
    if (!run || !run.fase || !Array.isArray(run.siti)) continue;
    const basi = run.siti.map((s) => s.base).sort().join("|");
    perFaseBasi.set(`${run.fase}\u0000${basi}`, run);
  }

  // Raggruppa per insieme di basi → mappa fase → ultimo run.
  const gruppi = new Map();
  for (const run of perFaseBasi.values()) {
    const basi = run.siti.map((s) => s.base).sort().join("|");
    if (!gruppi.has(basi)) gruppi.set(basi, new Map());
    gruppi.get(basi).set(run.fase, run);
  }

  const candidati = [...gruppi.entries()]
    .map(([basi, fasi]) => ({ basi, fasi: [...fasi.values()].sort((a, b) => (a.generato < b.generato ? -1 : 1)) }))
    .sort(
      (a, b) =>
        b.fasi.length - a.fasi.length ||
        (a.fasi[a.fasi.length - 1].generato < b.fasi[b.fasi.length - 1].generato ? 1 : -1),
    );

  const gruppo = candidati[0];
  if (!gruppo || gruppo.fasi.length < 2) {
    const dettaglio = candidati.map((c) => `${c.fasi.length} fase/i su ${c.basi}`).join("; ") || "nessun gruppo valido";
    throw new Error(`Servono due FASI diverse per confrontare, misurate sugli stessi URL (gruppi: ${dettaglio}).`);
  }
  return { prima: gruppo.fasi[0], dopo: gruppo.fasi[gruppo.fasi.length - 1] };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.aiuto) {
    console.log(AIUTO);
    return;
  }
  if (args.confronta) {
    const { prima, dopo } = caricaConfronto();
    const confronto = renderConfronto(prima, dopo);
    console.log(confronto);
    const precedente = existsSync(REPORT_MD) ? readFileSync(REPORT_MD, "utf8") : "";
    const rigaTitolo = confronto.split("\n")[0];
    if (precedente.includes(rigaTitolo)) {
      console.log("Confronto già presente nel report (stesse fasi): niente da aggiungere.");
      return;
    }
    writeFileSync(REPORT_MD, componiReport(precedente, confronto));
    console.log(`Confronto aggiunto in cima al report: ${path.relative(ROOT, REPORT_MD)}`);
    return;
  }
  await esegui(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`✖ ${err.message}`);
    process.exit(2);
  });
}
