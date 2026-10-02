import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DOMINI,
  RELEASE_MAX,
  SNAPSHOT_MAX,
  diffDominio,
  filtraPerGemello,
  isDominioAttivo,
  jsonCanonico,
  labelDominio,
  mergiaImport,
  sanitizeEntries,
  sanitizeReleases,
  validaExport,
  validaNomeRelease,
} from "../src/lib/domain-snapshots-shared.ts";

/**
 * Guard dello strumento AGGIORNAMENTI PER DOMINIO (decisione 2026-10-01,
 * docs/DECISIONE-UPDATES-BACKUP-2026-10-01.md §9): le funzioni pure sono
 * testate coi dati veri, il wiring pagina/azioni/API è guard testuale come
 * nelle altre sentinelle del progetto.
 */

const ROOT = process.cwd();
const leggi = (p) => readFileSync(path.join(ROOT, ...p.split("/")), "utf8");

test("DOMINI: i cinque attivi della v1 più lo stub ticketing", () => {
  assert.deepEqual(
    DOMINI.map((d) => d.id),
    ["temi", "hero", "ambrosio", "tools", "settings", "ticketing"],
  );
  assert.equal(DOMINI.find((d) => d.id === "ticketing").attivo, false, "il ticketing è stub");
  assert.equal(isDominioAttivo("temi"), true);
  assert.equal(isDominioAttivo("ticketing"), false);
  assert.equal(isDominioAttivo("canaglia"), false);
  assert.equal(labelDominio("hero"), "Hero animato");
});

test("jsonCanonico: chiavi ordinate ricorsivamente, array in ordine", () => {
  assert.equal(jsonCanonico({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(jsonCanonico({ z: { y: 1, x: 2 }, a: [3, { c: 1, b: 2 }] }), '{"a":[3,{"b":2,"c":1}],"z":{"x":2,"y":1}}');
  assert.equal(jsonCanonico({ a: null }), '{"a":null}');
  assert.equal(jsonCanonico("testo"), '"testo"');
  assert.equal(jsonCanonico(undefined), "null");
  // L'ordine delle chiavi NON cambia l'hash: base del dedup.
  assert.equal(jsonCanonico({ a: 1, b: 2 }), jsonCanonico({ b: 2, a: 1 }));
});

test("filtraPerGemello: niente segreti, niente testi di sito, struttura intatta", () => {
  const temi = filtraPerGemello("temi", { site_theme: { theme: "zendesk", mode: "dark", primary: "#ff0000", accent: "#00ff00" } });
  assert.deepEqual(temi.site_theme, { theme: "zendesk", mode: "dark", primary: "#ff0000", accent: "#00ff00" });

  const hero = filtraPerGemello("hero", {
    site_hero: { enabled: true, template: "spotlight", title: "Testo di Crema", subtitle: "Voce di Crema", eyebrow: "x", titleHighlight: "y", placeholder: "z", cursor: "glow" },
  });
  // Le STATI (testi) restano fuori; struttura/flags passano.
  assert.equal(hero.site_hero.title, undefined);
  assert.equal(hero.site_hero.subtitle, undefined);
  assert.equal(hero.site_hero.template, "spotlight");
  assert.equal(hero.site_hero.enabled, true);

  const ambrosio = filtraPerGemello("ambrosio", {
    ai_settings: { enabled: true, provider: "anthropic", api_key_enc: "SEGRETO", system_prompt: "prompt" },
    ai_faqs: [{ question: "q", answer: "a" }],
  });
  assert.equal(ambrosio.ai_settings.api_key_enc, undefined, "la chiave API non viaggia mai");
  assert.equal(ambrosio.ai_settings.provider, "anthropic");
  assert.equal(ambrosio.ai_faqs.length, 1);

  const tools = filtraPerGemello("tools", { calendar_hub: { enabled: true, exportTokenHash: "hash", other: "ok" } });
  assert.equal(tools.calendar_hub.exportTokenHash, undefined, "i token non viaggiano");
  assert.equal(tools.calendar_hub.other, "ok");

  // Dominio senza filtro (settings): il payload passa com'è.
  const settings = filtraPerGemello("settings", { ticket_sla_policy: { alta: 1 } });
  assert.deepEqual(settings, { ticket_sla_policy: { alta: 1 } });
  // Dominio ignoto: payload intatto (difensivo).
  assert.deepEqual(filtraPerGemello("canaglia", { a: 1 }), { a: 1 });
});

test("sanitizeEntries: scarta le righe malformate, rispetta SNAPSHOT_MAX", () => {
  const righe = [];
  // La convenzione è il più recente in testa: la fixture nasce già discendente.
  for (let i = 0; i < SNAPSHOT_MAX + 5; i++) {
    righe.push({ takenAt: `2026-10-01T10:00:${String(SNAPSHOT_MAX + 4 - i).padStart(2, "0")}Z`, takenBy: "a@b.c", nota: "n", sha256: "h".repeat(64), data: { i } });
  }
  const sani = sanitizeEntries(righe);
  assert.equal(sani.length, SNAPSHOT_MAX, "taglia al massimo");
  assert.ok(sani[0].takenAt > sani[1].takenAt, "ordine preservato");
  assert.deepEqual(sanitizeEntries(null), []);
  assert.deepEqual(sanitizeEntries([{ takenAt: "x" }]), [], "riga senza data/sha → scartata");
});

/* ── FASE 2: import con anteprima e conferma ── */

const exportGemello = (dominio, data) =>
  JSON.stringify({ strumento: "aggiornamenti-per-dominio", dominio, per: "gemello", generato: "2026-10-01T10:00:00Z", data });

test("validaExport: accetta SOLO l'export «per gemello», mai quello completo", () => {
  const ok = validaExport(exportGemello("temi", { site_theme: { theme: "zendesk" } }));
  assert.equal(ok.ok, true);
  assert.equal(ok.valore.dominio, "temi");
  // L'export completo contiene segreti e testi di sito: MAI importabile.
  const completo = validaExport(JSON.stringify({ strumento: "aggiornamenti-per-dominio", dominio: "temi", per: "locale", data: {} }));
  assert.equal(completo.ok, false);
  assert.match(completo.errore, /per gemello/);
  assert.equal(validaExport("{non json").ok, false);
  assert.equal(validaExport(JSON.stringify({ strumento: "altro", per: "gemello", dominio: "temi", data: {} })).ok, false);
  const stub = validaExport(exportGemello("ticketing", {}));
  assert.equal(stub.ok, false, "lo stub ticketing non è un dominio attivo");
});

test("diffDominio: uguale/cambiata/nuova, secondo livello per gli oggetti, array come blocco", () => {
  const righe = diffDominio(
    { site_theme: { theme: "classic", mode: "light", primary: "#3d72ec" }, site_hero: { enabled: false } },
    { site_theme: { theme: "zendesk", mode: "light", primary: "#3d72ec" }, site_hero: { enabled: true, template: "lens" } },
  );
  const m = Object.fromEntries(righe.map((r) => [r.chiave, r]));
  assert.equal(m["site_theme.theme"].stato, "cambiata");
  assert.equal(m["site_theme.theme"].dopo, "zendesk");
  assert.equal(m["site_theme.mode"].stato, "uguale");
  assert.equal(m["site_hero.template"].stato, "nuova");
  // Array (ai_faqs): una riga sola, col numero di elementi.
  const faq = diffDominio({ ai_faqs: [1, 2] }, { ai_faqs: [1, 2, 3] });
  assert.equal(faq.length, 1);
  assert.match(faq[0].dopo, /3 elementi/);
});

test("mergiaImport: la voce locale sopravvive ai campi assenti dall'export gemello", () => {
  // L'export hero NON contiene i testi: dopo il merge restano quelli del sito.
  const merged = mergiaImport(
    "hero",
    { site_hero: { enabled: false, template: "spotlight", title: "Testo locale", subtitle: "Voce locale" } },
    { site_hero: { enabled: true, template: "lens" } },
  );
  assert.equal(merged.site_hero.enabled, true);
  assert.equal(merged.site_hero.template, "lens");
  assert.equal(merged.site_hero.title, "Testo locale", "i testi non vengono cancellati dall'import");
  assert.equal(merged.site_hero.subtitle, "Voce locale");
  // Ambrosio: le FAQ sostituiscono (blocco), i settings si fondono.
  const amb = mergiaImport(
    "ambrosio",
    { ai_settings: { enabled: false, provider: "openai", system_prompt: "vecchio" }, ai_faqs: [{ question: "vecchia" }] },
    { ai_settings: { enabled: true, provider: "anthropic" }, ai_faqs: [{ question: "nuova" }] },
  );
  assert.equal(amb.ai_settings.enabled, true);
  assert.equal(amb.ai_settings.provider, "anthropic");
  assert.equal(amb.ai_settings.system_prompt, "vecchio", "il campo locale assente dall'export resta");
  assert.equal(amb.ai_faqs.length, 1);
  assert.equal(amb.ai_faqs[0].question, "nuova");
});

/* ── FASE 3: etichette di release ── */

test("validaNomeRelease: slug leggibile come tools-fix-2026-10-05", () => {
  assert.equal(validaNomeRelease("tools-fix-2026-10-05"), null);
  assert.equal(validaNomeRelease("  go-live-2  "), null, "il trim è della validazione");
  assert.match(validaNomeRelease("ab"), /minimo 3/);
  assert.match(validaNomeRelease("a".repeat(61)), /massimo 60/);
  assert.match(validaNomeRelease("Tools Fix"), /minuscole, cifre e tratti/);
  assert.match(validaNomeRelease("-leading"), /minuscole, cifre e tratti/);
  assert.match(validaNomeRelease("doppio--tratt"), /minuscole, cifre e tratti/);
  assert.match(validaNomeRelease("con_underscore"), /minuscole, cifre e tratti/);
});

test("sanitizeReleases: scarta le righe malformate, punti solo domini attivi, rispetta RELEASE_MAX", () => {
  const righe = [];
  for (let i = 0; i < RELEASE_MAX + 3; i++) {
    righe.push({
      nome: `r-${i}`,
      creataAt: `2026-10-0${(i % 9) + 1}T10:00:00Z`,
      creataDa: "a@b.c",
      nota: "n",
      punti: { temi: `2026-10-01T10:00:0${i}Z`, canaglia: "x" },
    });
  }
  const sani = sanitizeReleases(righe);
  assert.equal(sani.length, RELEASE_MAX, "taglia al massimo");
  // Il punto su un dominio non attivo è scartato, quello valido resta.
  assert.deepEqual(Object.keys(sani[0].punti), ["temi"]);
  assert.deepEqual(sanitizeReleases(null), []);
  assert.deepEqual(
    sanitizeReleases([{ nome: "x", creataAt: "d", creataDa: "a", punti: "no" }]),
    [],
    "punti non oggetto → riga scartata",
  );
  assert.deepEqual(
    sanitizeReleases([{ creataAt: "d", creataDa: "a", punti: {} }]),
    [],
    "senza nome → riga scartata",
  );
});

test("wiring: azioni con guard admin, API con dominio valido e whitelist, pagina monta il pannello", () => {
  const azioni = leggi("src/app/admin/updates-actions.ts");
  assert.match(azioni, /import \{ getAdminUser \} from "@\/lib\/admin"/);
  assert.match(azioni, /redirect\("\/admin\/login"\)/);
  assert.match(azioni, /logAudit\(\s*user\.email,\s*"updates\.snapshot"/);
  assert.match(azioni, /logAudit\(\s*user\.email,\s*"updates\.ripristino"/);
  assert.match(azioni, /revalidatePath\("\/", "layout"\)/, "tema e hero vivono nel root layout");

  const api = leggi("src/app/api/admin/updates-export/[dominio]/route.ts");
  assert.match(api, /getAdminUser/);
  assert.match(api, /if \(!user\) return NextResponse\.json\(\{ error: "unauthorized" \}, \{ status: 401 \}\)/);
  assert.match(api, /DOMINI\.some\(\(d\) => d\.id === dominio\)/);
  assert.match(api, /"Cache-Control": "no-store"/);

  const pagina = leggi("src/app/admin/tools/backup/page.tsx");
  assert.match(pagina, /import UpdatesDomainPanel from "@\/components\/updates-domain-panel"/);
  assert.match(pagina, /listSnapshots/);
  assert.match(pagina, /updates_msg/);

  const pannello = leggi("src/components/updates-domain-panel.tsx");
  assert.match(pannello, /snapshotSalvaAction/);
  assert.match(pannello, /snapshotRipristinaAction/);
  assert.match(pannello, /per=gemello/);
  assert.match(pannello, /confirm\(/, "il ripristino chiede conferma");

  const lib = leggi("src/lib/domain-snapshots.ts");
  assert.doesNotMatch(lib, /api_key_enc/, "la chiave API non entra nel payload Ambrosio");
  assert.match(lib, /createHash\("sha256"\)/);
  assert.match(lib, /dominio_snapshot_\$\{id\}/);
  // FASE 2: l'import scrive SOLO alla conferma, con snapshot pre-import e sha anti-TOCTOU.
  assert.match(lib, /IMPORT_PENDING_KEY = "dominio_import_pending"/);
  assert.match(lib, /il file è cambiato dopo l'anteprima/);
  assert.match(lib, /pre-import \$\{pending\.generato\}/);
  const azioni2 = leggi("src/app/admin/updates-actions.ts");
  assert.match(azioni2, /importAnteprimaAction/);
  assert.match(azioni2, /importConfermaAction/);
  assert.match(azioni2, /importScartaAction/);
  assert.match(azioni2, /file instanceof File/, "l'anteprima legge il file caricato dal form");
  assert.match(pannello, /Anteprima import/);
  assert.match(pannello, /Conferma import/);
  assert.match(pannello, /confirm\("Applicare l'import\?/);

  // FASE 3: etichette di release — creazione e ripristino coordinato.
  const lib2 = leggi("src/lib/domain-snapshots.ts");
  assert.match(lib2, /RELEASES_KEY = "dominio_releases"/);
  assert.match(lib2, /export async function listReleaseLabels/);
  assert.match(lib2, /export async function creaReleaseLabel/);
  assert.match(lib2, /export async function ripristinaReleaseLabel/);
  assert.match(lib2, /salvaSnapshot\(d\.id, takenBy, `release \$\{nomePulito\}`\)/, "l'etichetta congela snapshot freschi");
  const azioni3 = leggi("src/app/admin/updates-actions.ts");
  assert.match(azioni3, /export async function releaseCreaAction/);
  assert.match(azioni3, /export async function releaseRipristinaAction/);
  assert.match(azioni3, /logAudit\(\s*user\.email,\s*"updates\.release"/);
  assert.match(azioni3, /logAudit\(\s*user\.email,\s*"updates\.release-ripristino"/);
  assert.match(pannello, /releaseCreaAction/);
  assert.match(pannello, /releaseRipristinaAction/);
  assert.match(pannello, /Ripristina coordinato/);
  assert.match(pannello, /Ripristinare TUTTI i domini all'etichetta/, "il ripristino coordinato chiede conferma");
  const pagina2 = leggi("src/app/admin/tools/backup/page.tsx");
  assert.match(pagina2, /listReleaseLabels/);
});
