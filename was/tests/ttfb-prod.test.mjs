import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  INSIEMI,
  INTESTAZIONE_MD,
  PAGINE,
  PAGINE_PUBBLICHE,
  SITI,
  aggrega,
  basePer,
  caricaConfronto,
  componiReport,
  deltaPercent,
  mediana,
  modalita,
  nomeJson,
  parseArgs,
  paginePerInsieme,
  renderConfronto,
  renderMarkdown,
  rigaPagina,
  serveCookie,
  slug,
} from "../scripts/ttfb-prod.mjs";

/**
 * Guard dello strumento TTFB produzione (scripts/ttfb-prod.mjs, piano
 * prestazioni 2026-10-02): si testano solo le funzioni pure (parse, aggrega,
 * render, componiReport, caricaConfronto con directory temporanea). Le
 * misure vere su produzione restano manuali e le lancia l'utente col cookie.
 */

const tmpDir = () => mkdtempSync(path.join(os.tmpdir(), "ttfb-prod-test-"));

test("PAGINE e SITI: gli hub admin, le pagine pubbliche per sito e i due domini", () => {
  assert.deepEqual(PAGINE, ["/admin", "/admin/settings", "/admin/tools"]);
  // Landing SEO con slug diverso per gemello: dato per sito, script identico.
  assert.deepEqual(PAGINE_PUBBLICHE.crema, ["/", "/seo-crema"]);
  assert.deepEqual(PAGINE_PUBBLICHE.salento, ["/", "/seo-salento"]);
  assert.deepEqual(INSIEMI, ["admin", "pubbliche", "tutte"]);
  assert.equal(SITI.crema.base, "https://www.webagencycrema.com");
  assert.equal(SITI.salento.base, "https://www.webagencysalento.com");
});

test("paginePerInsieme e serveCookie: admin → hub, pubbiche → home+landing senza sessione", () => {
  const a = { insieme: "admin" };
  const p = { insieme: "pubbliche" };
  const t = { insieme: "tutte" };
  assert.deepEqual(paginePerInsieme("crema", a), PAGINE);
  assert.deepEqual(paginePerInsieme("salento", a), PAGINE);
  assert.deepEqual(paginePerInsieme("crema", p), ["/", "/seo-crema"]);
  assert.deepEqual(paginePerInsieme("salento", p), ["/", "/seo-salento"]);
  assert.deepEqual(paginePerInsieme("crema", t), [...PAGINE, "/", "/seo-crema"]);
  assert.deepEqual(paginePerInsieme("salento", t), [...PAGINE, "/", "/seo-salento"]);
  assert.equal(serveCookie(a), true);
  assert.equal(serveCookie(t), true);
  assert.equal(serveCookie(p), false);
});

test("parseArgs: default e argomenti completi", () => {
  assert.deepEqual(parseArgs([]), {
    fase: null,
    site: "both",
    insieme: "admin",
    campioni: 5,
    attesa: 0,
    base: null,
    baseSiti: {},
    timeout: 30_000,
    confronta: false,
    aiuto: false,
  });
  const a = parseArgs([
    "--fase", "dopo-step1",
    "--site", "crema",
    "--insieme", "tutte",
    "--campioni", "3",
    "--attesa", "330",
    "--base", "http://localhost:3105/",
    "--base-crema", "http://localhost:3105",
    "--base-salento", "http://127.0.0.1:3105",
    "--timeout", "5000",
  ]);
  assert.equal(a.fase, "dopo-step1");
  assert.equal(a.site, "crema");
  assert.equal(a.insieme, "tutte");
  assert.equal(a.campioni, 3);
  assert.equal(a.attesa, 330);
  assert.equal(a.base, "http://localhost:3105/");
  assert.equal(a.baseSiti.crema, "http://localhost:3105");
  assert.equal(a.baseSiti.salento, "http://127.0.0.1:3105");
  assert.equal(a.timeout, 5000);
  assert.equal(parseArgs(["--confronta"]).confronta, true);
  assert.equal(parseArgs(["--help"]).aiuto, true);
});

test("parseArgs: rifiuta argomenti sconosciuti, valori mancanti e numeri insensati", () => {
  assert.throws(() => parseArgs(["--boh"]), /non riconosciuto/);
  assert.throws(() => parseArgs(["--fase"]), /Valore mancante/);
  assert.throws(() => parseArgs(["--fase", "--confronta"]), /Valore mancante/);
  assert.throws(() => parseArgs(["--campioni", "0"]), /--campioni/);
  assert.throws(() => parseArgs(["--campioni", "abc"]), /--campioni/);
  assert.throws(() => parseArgs(["--campioni", "2.5"]), /--campioni/);
  assert.throws(() => parseArgs(["--attesa", "-1"]), /--attesa/);
  assert.throws(() => parseArgs(["--timeout", "500"]), /--timeout/);
  assert.throws(() => parseArgs(["--base", "non-un-url"]), /non è un URL valido/);
  assert.throws(() => parseArgs(["--base-salento", "webagencysalento.com"]), /non è un URL valido/);
  assert.throws(() => parseArgs(["--insieme", "pubbica"]), /--insieme non valido/);
  assert.throws(() => parseArgs(["--insieme"]), /Valore mancante/);
});

test("basePer: override per sito → override generico → dominio di produzione", () => {
  assert.equal(basePer("crema", { base: null, baseSiti: { crema: "http://localhost:3105/" } }), "http://localhost:3105");
  // Il sito non toccato dall'override specifico resta in produzione...
  assert.equal(basePer("salento", { base: null, baseSiti: { crema: "http://localhost:3105" } }), "https://www.webagencysalento.com");
  // ...a meno che l'override generico non lo copra.
  assert.equal(basePer("salento", { base: "http://localhost:3105", baseSiti: {} }), "http://localhost:3105");
  // Senza override: dominio di produzione, barra finale tolta.
  assert.equal(basePer("crema", { base: null, baseSiti: {} }), "https://www.webagencycrema.com");
});

test("mediana: dispari, pari (arrotondata), singolo, vuoto", () => {
  assert.equal(mediana([3, 1, 2]), 2);
  assert.equal(mediana([1, 2, 3, 4]), 3); // (2+3)/2 → Math.round(2.5)
  assert.equal(mediana([100, 200]), 150);
  assert.equal(mediana([5]), 5);
  assert.equal(mediana([]), null);
});

test("aggrega: min, mediana, max, media, n", () => {
  const agg = aggrega([{ ttfbMs: 300 }, { ttfbMs: 100 }, { ttfbMs: 200 }]);
  assert.deepEqual(agg, { n: 3, min: 100, mediana: 200, max: 300, media: 200 });
});

test("deltaPercent: negativo = miglioramento; base assente → null", () => {
  assert.equal(deltaPercent(1100, 2000), -45);
  assert.equal(deltaPercent(3000, 2000), 50);
  assert.equal(deltaPercent(2000, 2000), 0);
  assert.equal(deltaPercent(100, 0), null);
  assert.equal(deltaPercent(100, null), null);
});

test("modalita: valore più frequente; vuoto → stringa vuota", () => {
  assert.equal(modalita(["a", "b", "a"]), "a");
  assert.equal(modalita(["iad1", "iad1", "fra1"]), "iad1");
  assert.equal(modalita([]), "");
});

test("slug e nomeJson: nome file unico al ms, due run non si sovrascrivono", () => {
  assert.equal(slug("Dopo Step 1!"), "dopo-step-1");
  assert.equal(slug(""), "run");
  const a = nomeJson("dopo-step1", ["crema", "salento"], "2026-10-01T17:30:45.123Z");
  assert.equal(a, "dopo-step1-crema+salento-2026-10-01T17-30-45-123Z.json");
  const b = nomeJson("dopo-step1", ["crema", "salento"], "2026-10-01T17:30:45.456Z");
  assert.notEqual(a, b);
});

test("rigaPagina: path, mediana in grassetto, funzione e cache o trattino", () => {
  assert.equal(
    rigaPagina({ path: "/admin", min: 100, mediana: 200, max: 300, media: 220, n: 5, funzione: "iad1", cache: "DYNAMIC" }),
    "| `/admin` | 100ms | **200ms** | 300ms | 220ms | 5 | `iad1` | `DYNAMIC` |",
  );
  assert.equal(
    rigaPagina({ path: "/admin/tools", min: 1, mediana: 2, max: 3, media: 2, n: 5, funzione: "", cache: "" }),
    "| `/admin/tools` | 1ms | **2ms** | 3ms | 2ms | 5 | `—` | `—` |",
  );
});

const runEsempio = (fase, quando, attesaSec = 0) => ({
  fase,
  quando,
  generato: "2026-10-01T17:30:00.000Z",
  campioni: 5,
  attesaSec,
  misuratoDa: "host-di-test",
  cookiePresente: true,
  siti: [
    {
      key: "crema",
      label: "WebAgencyCrema",
      base: "https://www.webagencycrema.com",
      pagine: [
        { path: "/admin", n: 5, min: 1800, mediana: 1800, max: 1900, media: 1800, funzione: "iad1", cache: "DYNAMIC", campioni: [] },
        { path: "/admin/settings", n: 5, min: 1900, mediana: 2100, max: 2300, media: 2100, funzione: "iad1", cache: "DYNAMIC", campioni: [] },
      ],
    },
  ],
});

test("renderMarkdown: sezione con fase, siti, tabella completa, nessun cookie", () => {
  const md = renderMarkdown(runEsempio("prima", "1/10/2026, 17:30"));
  assert.ok(md.startsWith("## [prima] 1/10/2026, 17:30 — WebAgencyCrema\n"));
  assert.ok(md.includes("### WebAgencyCrema — https://www.webagencycrema.com"));
  assert.ok(md.includes("| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |"));
  assert.ok(md.includes(rigaPagina({ path: "/admin", min: 1800, mediana: 1800, max: 1900, media: 1800, n: 5, funzione: "iad1", cache: "DYNAMIC" })));
  assert.ok(md.includes("a caldo"));
  assert.ok(md.includes("Cookie di sessione: sì (mai nel report)"));
  assert.ok(md.endsWith("\n"));
  // Le due pagine del run sono nella tabella; il cookie non compare mai.
  assert.ok(md.includes("`/admin/settings`"));
  assert.doesNotMatch(md, /wac_admin=/);
  // A freddo l'attesa è dichiarata nella sezione.
  assert.ok(renderMarkdown(runEsempio("prima-freddo", "1/10/2026, 18:00", 330)).includes("attesa iniziale 330s (misurazione a freddo)"));
  assert.ok(renderMarkdown({ ...runEsempio("x", "y"), cookiePresente: false }).includes("Cookie di sessione: no."));
});

test("renderConfronto: heading con entrambe le fasi, Δ con segno, Δ%", () => {
  const prima = runEsempio("prima", "1/10/2026, 17:30");
  const dopo = runEsempio("dopo-step1", "2/10/2026, 09:00");
  dopo.siti[0].pagine[0].mediana = 1100; // /admin: 2000 → 1100
  const md = renderConfronto(prima, dopo);
  assert.ok(md.startsWith("## Confronto [prima] → [dopo-step1] (2/10/2026, 09:00)"));
  assert.ok(md.includes("`/admin` | 1800ms | **1100ms** | -700ms | -39% |"));
  // Le pagine senza corrispondenza di mediana restano confrontate: qui /admin/settings è identica → 0ms.
  assert.ok(md.includes("`/admin/settings`"));
  // Sito presente solo nel run "dopo" → saltato senza errori.
  const dopoExtra = {
    ...dopo,
    siti: [...dopo.siti, { key: "salento", label: "Web Agency Salento", base: "https://www.webagencysalento.com", pagine: [] }],
  };
  const mdExtra = renderConfronto(prima, dopoExtra);
  assert.ok(mdExtra.includes("### WebAgencyCrema"));
  // Sito con base diversa fra i due run: sezione con nota, nessuna riga inventata.
  assert.ok(mdExtra.includes("### Web Agency Salento"));
  assert.ok(mdExtra.includes("Base diversa fra i due run"));
  assert.equal((mdExtra.match(/PRIMA mediana/g) || []).length, 1);
});

test("componiReport: intestazione una sola volta e sezioni nuove in cima", () => {
  const secA = "## [prima] 1/10/2026, 17:30 — WebAgencyCrema\n\n\ntabella A\n";
  const secB = "## [dopo-step1] 2/10/2026, 09:00 — WebAgencyCrema\n\n\ntabella B\n";
  const secC = "## Confronto [prima] → [dopo-step1] (2/10/2026, 09:10)\n\n\ntabella C\n";

  // Primo run: file assente → intestazione + prima sezione.
  const uno = componiReport("", secA);
  assert.ok(uno.startsWith(INTESTAZIONE_MD));
  assert.ok(uno.includes("---"));
  assert.ok(uno.includes(secA));
  assert.equal((uno.match(/# Telemetria TTFB produzione/g) || []).length, 1);

  // Secondo run: la sezione nuova va in cima, la vecchia resta, un'intestazione sola.
  const due = componiReport(uno, secB);
  assert.equal((due.match(/# Telemetria TTFB produzione/g) || []).length, 1);
  assert.ok(due.indexOf("## [dopo-step1]") < due.indexOf("## [prima]"));
  assert.ok(due.includes(secA));

  // Confronto: si aggiunge ancora sopra, l'ordine resta leggibile.
  const tre = componiReport(due, secC);
  assert.equal((tre.match(/# Telemetria TTFB produzione/g) || []).length, 1);
  assert.ok(tre.indexOf("## Confronto") < tre.indexOf("## [dopo-step1]"));
  assert.ok(tre.indexOf("## [dopo-step1]") < tre.indexOf("## [prima]"));

  // File scritto a mano senza intestazione: si aggiunge l'intestazione e si conserva tutto.
  const manuale = componiReport("## vecchia nota a mano\n", secB);
  assert.ok(manuale.startsWith(INTESTAZIONE_MD));
  assert.ok(manuale.includes("## vecchia nota a mano"));
  assert.ok(manuale.indexOf("## [dopo-step1]") < manuale.indexOf("## vecchia nota a mano"));

  // Report con l'intestazione di una versione precedente dello strumento:
  // il blocco in testa (fino al primo ---) resta, la sezione nuova va sopra.
  const intestazioneVecchia =
    "# Telemetria TTFB produzione — admin (prima/dopo lo Step 1)\n\n" +
    "Report vecchio.\n";
  const conVecchia = componiReport(
    intestazioneVecchia + "\n---\n\n" + secA,
    secB,
  );
  assert.ok(conVecchia.startsWith("# Telemetria TTFB produzione — admin (prima/dopo lo Step 1)"));
  assert.ok(conVecchia.includes("Report vecchio."));
  assert.ok(conVecchia.indexOf("## [dopo-step1]") < conVecchia.indexOf("## [prima]"));
  assert.equal((conVecchia.match(/# Telemetria TTFB produzione/g) || []).length, 1);
});

test("caricaConfronto: due fasi → prima/dopo; fase ripetuta → vale l'ultima; errori chiari", () => {
  const dir = tmpDir();
  try {
    // Dir inesistente.
    assert.throws(() => caricaConfronto(path.join(dir, "nope")), /Nessun run/);
    // Dir vuota.
    assert.throws(() => caricaConfronto(dir), /almeno due run/);
    // Una sola fase (due run) → errore.
    writeFileSync(path.join(dir, "prima-both-1.json"), JSON.stringify({ fase: "prima", generato: "2026-10-01T10:00:00.000Z", siti: [] }));
    writeFileSync(path.join(dir, "prima-both-1b.json"), JSON.stringify({ fase: "prima", generato: "2026-10-01T10:05:00.000Z", siti: [] }));
    assert.throws(() => caricaConfronto(dir), /due FASI diverse/);

    // Tre run su due fasi: la fase ripetuta tiene l'ultimo per ora di generazione.
    writeFileSync(path.join(dir, "dopo-step1-both-2.json"), JSON.stringify({ fase: "dopo-step1", generato: "2026-10-01T11:00:00.000Z", siti: [] }));
    writeFileSync(path.join(dir, "dopo-step1-both-3.json"), JSON.stringify({ fase: "dopo-step1", generato: "2026-10-01T12:00:00.000Z", siti: [] }));
    const { prima, dopo } = caricaConfronto(dir);
    assert.equal(prima.fase, "prima");
    // Fase "prima" ripetuta (file 1b): vale l'ultimo run di quella fase.
    assert.equal(prima.generato, "2026-10-01T10:05:00.000Z");
    assert.equal(dopo.fase, "dopo-step1");
    assert.equal(dopo.generato, "2026-10-01T12:00:00.000Z");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("caricaConfronto: produzione e prodlike non si mescolano mai in un confronto", () => {
  const dir = tmpDir();
  try {
    const sitiProd = [
      { key: "crema", base: "https://www.webagencycrema.com", pagine: [] },
      { key: "salento", base: "https://www.webagencysalento.com", pagine: [] },
    ];
    const sitiProdlike = [{ key: "crema", base: "http://localhost:3105", pagine: [] }];
    writeFileSync(path.join(dir, "prima-both-1.json"), JSON.stringify({ fase: "prima", generato: "2026-10-01T10:00:00.000Z", siti: sitiProd }));
    writeFileSync(path.join(dir, "dopo-step1-both-2.json"), JSON.stringify({ fase: "dopo-step1", generato: "2026-10-01T11:00:00.000Z", siti: sitiProd }));
    // Il run prodlike è il più recente: NON deve diventare il "dopo" del confronto produzione.
    writeFileSync(path.join(dir, "prodlike-prima-1.json"), JSON.stringify({ fase: "prodlike-prima", generato: "2026-10-01T12:00:00.000Z", siti: sitiProdlike }));
    let r = caricaConfronto(dir);
    assert.equal(r.prima.fase, "prima");
    assert.equal(r.dopo.fase, "dopo-step1");

    // Quando anche il prodlike ha due fasi (e i run più recenti), vince il suo gruppo.
    writeFileSync(path.join(dir, "prodlike-dopo-2.json"), JSON.stringify({ fase: "prodlike-dopo", generato: "2026-10-01T13:00:00.000Z", siti: sitiProdlike }));
    r = caricaConfronto(dir);
    assert.equal(r.prima.fase, "prodlike-prima");
    assert.equal(r.dopo.fase, "prodlike-dopo");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("caricaConfronto: l'ordine segue generato, non il nome del file", () => {
  const dir = tmpDir();
  try {
    mkdirSync(dir, { recursive: true });
    // Nome con data precedente ma generato più recente: vince la fase con generato maggiore.
    writeFileSync(path.join(dir, "aaa-vecchio.json"), JSON.stringify({ fase: "vecchio", generato: "2026-09-30T08:00:00.000Z", siti: [] }));
    writeFileSync(path.join(dir, "zzz-nuovo.json"), JSON.stringify({ fase: "nuovo", generato: "2026-10-01T08:00:00.000Z", siti: [] }));
    const { prima, dopo } = caricaConfronto(dir);
    assert.equal(prima.fase, "vecchio");
    assert.equal(dopo.fase, "nuovo");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
