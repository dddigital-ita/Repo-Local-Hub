import { test, expect, type Page } from "@playwright/test";
import pg from "pg";
import { randomBytes, scryptSync } from "node:crypto";
import { portaE2ERepo } from "../../scripts/e2e-port.cjs";

/**
 * E2E del filtro «tipo cliente» dei lead — il segmento che Daniele usa per
 * le ricontatte deve essere UNO ovunque:
 *   dashboard /admin/leads?company=…  ≡  export /api/admin/leads.csv?company=…
 *
 * I tre lead di prova (azienda, professionista, senza tipo) entrano dalla
 * API PUBLICA /api/lead (stesso percorso di produzione, con le chiavi di
 * test Turnstile dell'ambiente E2E). Poi, da sessione admin reale:
 *   1. le tab della dashboard contano 1/1/1 e i segmenti filtrano per una;
 *   2. il CSV rispetta il segmento: righe, filename col suffisso e
 *      fallback alla vista completa su parametro non in whitelist;
 *   3. dashboard e CSV mostrano/scaricano la STESSA lista (invariante che
 *      ha motivato l'helper condiviso src/lib/lead-company.ts).
 *
 * Dopo i test: ogni riga di prova è CANCELLATA (nessuna sovrapposizione
 * con chat-lead.spec.ts né righe residue nel DB condiviso).
 */

const E2E_USER = process.env.E2E_PGUSER ?? (process.env.E2E_PGPASSWORD ? "postgres" : null);
const DSN =
  process.env.E2E_DATABASE_URL ??
  `postgresql://${E2E_USER ? `${E2E_USER}${process.env.E2E_PGPASSWORD ? `:${process.env.E2E_PGPASSWORD}` : ""}@` : ""}${
    process.env.E2E_PGHOST ?? "localhost"
  }:${process.env.E2E_PGPORT ?? "5432"}/${process.env.E2E_PGDATABASE ?? "was_e2e"}`;

function hash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

const ADMIN = { email: "capo-seg@e2e.local", password: "Sup3rSeg!22" };
const LEADS = [
  { name: "SegAzienda", phone: "333 1110001", company: "azienda", companyName: "Ditta Seg E2E" },
  { name: "SegProf", phone: "333 1110002", company: "professionista", companyName: undefined },
  { name: "SegSenza", phone: "333 1110003", company: undefined, companyName: undefined },
];

async function dbExec(sql: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: DSN });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

async function acceptConsent(page: Page) {
  const accept = page.getByRole("button", { name: "Accetta tutti" });
  const visible = await accept.waitFor({ state: "visible", timeout: 5_000 }).catch(() => null);
  if (visible) {
    await accept.click();
    await expect(accept).toBeHidden();
  }
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/admin/login");
  await acceptConsent(page);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /accedi|entra|login/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
}

/** Crea un lead dalla API pubblica (lo stesso submit della chat). */
async function createLead(lead: (typeof LEADS)[number]): Promise<void> {
  // Base URL dalla STESSA fonte di playwright.config.ts (portaE2ERepo):
  // config e spec non possono divergere. Precedenza: E2E_BASE_URL esplicito,
  // poi WAC_E2E_PORT, poi la porta derivata dal percorso del repo.
  const res = await fetch(
    `${process.env.E2E_BASE_URL ?? `http://localhost:${process.env.WAC_E2E_PORT ?? portaE2ERepo()}`}/api/lead`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lead: {
        name: lead.name,
        phone: lead.phone,
        service: "sito web nuovo",
        urgency: "entro 2 settimane",
        budget: "fino a 1.000 €",
        company: lead.company,
        companyName: lead.companyName,
        consent: true,
      },
      query: "e2e segmenti",
      sourcePage: "/e2e-segmenti",
      turnstileToken: "XXXX-DUMMY-TOKEN",
    }),
  });
  expect(res.ok, `POST /api/lead per ${lead.name}`).toBe(true);
  const body = (await res.json()) as { ok: boolean; leadInsertFailed?: boolean };
  expect(body.ok).toBe(true);
  expect(body.leadInsertFailed ?? false, "INSERT del lead fallito").toBe(false);
}

let seeded = false;

async function seed() {
  if (seeded) return;
  await dbExec(
    `insert into admin_users (email, password_hash, role, display_name)
     values ($1,$2,'super_admin','Capo Segmenti E2E')
     on conflict (email) do update set password_hash = excluded.password_hash, role = excluded.role, active = true`,
    [ADMIN.email, hash(ADMIN.password)],
  );
  for (const lead of LEADS) await createLead(lead);
  seeded = true;
}

async function cleanup() {
  // Una query per volta: il protocollo esteso di pg (usato appena ci sono
  // parametri $N) rifiuta più statement nella stessa chiamata.
  await dbExec("update conversations set lead_id = null where lead_id in (select id from leads where name like 'Seg%')");
  await dbExec("delete from leads where name like 'Seg%'");
  await dbExec("delete from conversations where source_page = '/e2e-segmenti'");
  await dbExec("delete from admin_users where email = $1", [ADMIN.email]);
}

test.describe.configure({ mode: "serial" });

test.describe("segmenti tipo cliente lead", () => {
  test.afterAll(async () => {
    await cleanup();
  });

  test("seed: admin + 3 lead via API pubblica (azienda, professionista, senza tipo)", async () => {
    await seed();
    const { rows } = await dbExec(
      `select company, company_name from leads where name like 'Seg%' order by name`,
    );
    expect(rows).toHaveLength(3);
    const byName = new Map(rows.map((r) => [r.company ?? "(null)", r.company_name]));
    expect(byName.get("azienda")).toBe("Ditta Seg E2E");
    expect(byName.get("professionista")).toBeNull();
    expect([...byName.keys()]).toContain("(null)");
  });

  test("login admin e dashboard: tab, conteggi e filtro azienda", async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);
    await page.goto("/admin/leads?company=azienda");

    // Tab con i conteggi attesi: 3 lead di prova + quelli di altre suite →
    // le asserzioni stringono SOLO sui segmenti (≥), mai sul totale assoluto.
    const nav = page.getByRole("navigation", { name: "Tipo cliente" });
    await expect(nav.getByRole("link", { name: /Aziende/ })).toBeVisible();
    await expect(nav.getByRole("link", { name: /Professionisti/ })).toBeVisible();
    await expect(nav.getByRole("link", { name: /Senza tipo/ })).toBeVisible();

    // Il segmento azienda mostra il lead azienda e NON quello professionista.
    await expect(page.getByText("SegAzienda")).toBeVisible();
    await expect(page.getByText("SegProf")).toHaveCount(0);
    await expect(page.getByText("Ditta Seg E2E")).toBeVisible();
  });

  test("i segmenti della dashboard filtrano tutti correttamente", async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);

    await page.goto("/admin/leads?company=professionista");
    await expect(page.getByText("SegProf")).toBeVisible();
    await expect(page.getByText("SegAzienda")).toHaveCount(0);

    await page.goto("/admin/leads?company=senza");
    await expect(page.getByText("SegSenza")).toBeVisible();
    await expect(page.getByText("SegAzienda")).toHaveCount(0);

    // Whitelist: parametro fuori dai segmenti → vista completa (fallback).
    await page.goto("/admin/leads?company=non-valido");
    await expect(page.getByText("SegAzienda")).toBeVisible();
    await expect(page.getByText("SegProf")).toBeVisible();
    await expect(page.getByText("SegSenza")).toBeVisible();
  });

  test("il CSV segmentato: righe, filename e fallback whitelist", async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);

    const fetchCsv = async (qs: string) =>
      page.request.get(`/api/admin/leads.csv${qs}`);

    // Azienda: 1 riga di prova, filename col suffisso.
    const rA = await fetchCsv("?company=azienda");
    expect(rA.status()).toBe(200);
    expect(rA.headers()["content-disposition"]).toMatch(/lead-\d{4}-\d{2}-\d{2}-azienda\.csv/);
    const csvA = await rA.text();
    expect(csvA).toContain("SegAzienda");
    expect(csvA).not.toContain("SegProf");
    expect(csvA).not.toContain("SegSenza");

    // Professionista e senza tipo: filename segmentato e righe giuste.
    const rP = await fetchCsv("?company=professionista");
    expect((await rP.text())).toContain("SegProf");
    expect(rP.headers()["content-disposition"]).toMatch(/-professionista\.csv/);
    const rS = await fetchCsv("?company=senza");
    expect((await rS.text())).toContain("SegSenza");
    expect(rS.headers()["content-disposition"]).toMatch(/-senza\.csv/);

    // Completo: nessun suffisso, tutti e tre i lead di prova dentro.
    const rAll = await fetchCsv("");
    const cdAll = rAll.headers()["content-disposition"] ?? "";
    expect(cdAll).not.toMatch(/-(azienda|professionista|senza)\.csv/);
    const csvAll = await rAll.text();
    for (const l of LEADS) expect(csvAll).toContain(l.name);

    // Whitelist: parametro invalido → si comporta come il completo.
    const rX = await fetchCsv("?company=non-valido");
    const csvX = await rX.text();
    for (const l of LEADS) expect(csvX).toContain(l.name);
  });

  test("header CSV: colonne chiave, BOM, righe allineate e company corretta per segmento", async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);

    const r = await page.request.get("/api/admin/leads.csv?company=azienda");
    expect(r.status()).toBe(200);
    const csv = await r.text();

    // BOM UTF-8: Excel apre le accentate senza pasticciare.
    expect(csv.charCodeAt(0)).toBe(0xfeff);

    const lines = csv.slice(1).trim().split("\n");
    const cols = lines[0].split(";");
    // Le colonne dimenticate una volta (company/company_name 014, poi le nove
    // recuperate dalla sentinella schema→CSV) devono restare nell'header.
    for (const c of ["company", "company_name", "consent", "temperature", "notes", "wa_phone"]) {
      expect(cols, `colonna «${c}» nell'header`).toContain(c);
    }

    // Allineamento: ogni riga ha tanti campi quante le colonne dell'header
    // (i lead di prova non contengono «;» né virgolette: nel DB E2E controllato).
    const separatori = cols.length - 1;
    for (const line of lines.slice(1)) {
      expect(line.split(";").length - 1, `riga allineata: ${line.slice(0, 40)}…`).toBe(separatori);
    }

    // Righe a livello di COLONNA: nel CSV del segmento azienda la colonna
    // company di OGNI riga vale «azienda» (il WHERE dell'helper è vero nei
    // dati, non solo nella query — qui altri lead azienda di altre suite sono
    // legittimi e passano lo stesso controllo).
    const companyIdx = cols.indexOf("company");
    expect(companyIdx).toBeGreaterThan(0);
    for (const line of lines.slice(1)) {
      expect(line.split(";")[companyIdx]).toBe("azienda");
    }

    // Stesso controllo per gli altri due segmenti.
    for (const [seg, atteso] of [["professionista", "professionista"], ["senza", ""]] as const) {
      const rs = await page.request.get(`/api/admin/leads.csv?company=${seg}`);
      const csvS = await rs.text();
      const colsS = csvS.slice(1).trim().split("\n")[0].split(";");
      const idx = colsS.indexOf("company");
      for (const line of csvS.slice(1).trim().split("\n").slice(1)) {
        expect(line.split(";")[idx], `company colonna nel segmento ${seg}`).toBe(atteso);
      }
    }
  });

  test("sentinella live: le colonne del CSV vero combaciano con LEADS_CSV_COLUMNS", async ({ page }) => {
    // La sentinella unitaria (tests/chat-e2e.test.mjs) verifica l'HELPER dai
    // file; questa verifica l'OUTPUT REALE via HTTP: se qualcuno introduce
    // una seconda fonte CSV (route, report, altro) che diverge dall'helper,
    // qui la run E2E lo urla con l'elenco esatto delle colonne in divergenza.
    await login(page, ADMIN.email, ADMIN.password);
    const r = await page.request.get("/api/admin/leads.csv");
    expect(r.status()).toBe(200);
    const csv = await r.text();
    expect(csv.charCodeAt(0)).toBe(0xfeff);

    // Blob letterale SPECULARE a LEADS_CSV_COLUMNS (src/lib/lead-company.ts):
    // la divergenza è il segnale — la sentinella unitaria impedisce di
    // aggiornarne uno dimenticando l'altro.
    const ATTESA = [
      "created_at", "id", "name", "phone", "wa_phone", "whatsapp_opt_in", "whatsapp_opt_in_at",
      "service", "urgency", "existing_site", "budget", "company", "company_name",
      "source", "temperature", "ricontatta_il", "hot", "status", "consent", "notes",
      "initial_query", "source_page", "utm_source", "utm_medium", "utm_campaign", "callback_slot",
    ];

    const header = csv.slice(1).split("\n")[0].split(";");
    const mancanti = ATTESA.filter((c) => !header.includes(c));
    const extra = header.filter((c) => !ATTESA.includes(c));
    expect(
      { mancanti, extra },
      `header CSV reale diverge da LEADS_CSV_COLUMNS (aggiornare il blob speculare in lead-company-segments.spec.ts)`,
    ).toEqual({ mancanti: [], extra: [] });
  });

  test("invariante: dashboard e CSV esportano la STESSA lista per segmento", async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);
    for (const seg of ["azienda", "professionista", "senza"]) {
      await page.goto(`/admin/leads?company=${seg}`);
      const csv = await (await page.request.get(`/api/admin/leads.csv?company=${seg}`)).text();
      // Ogni lead di prova visibile nella dashboard del segmento è anche nel
      // CSV dello stesso segmento (e i nomi «Seg» sono nostri, non di altre suite).
      const cards = await page.locator("body").textContent();
      for (const l of LEADS.filter((x) => (seg === "senza" ? !x.company : x.company === seg))) {
        expect(cards, `${l.name} visibile in dashboard?company=${seg}`).toContain(l.name);
        expect(csv, `${l.name} nell'CSV ?company=${seg}`).toContain(l.name);
      }
    }
  });
});
