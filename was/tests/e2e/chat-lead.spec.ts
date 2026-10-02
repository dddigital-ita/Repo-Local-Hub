import { test, expect } from "@playwright/test";
import pg from "pg";

/**
 * E2E della chat lead-gen — il percorso che fa vivere il sito:
 *   home → ricerca nella barra → /consulenza?q=…
 *   → script di qualificazione: service, timing, existing_site, budget,
 *     company (+ company_name se azienda), name, phone, consent
 *   → POST /api/lead → riga in `leads` + conversation marcata `lead_captured`
 *
 * Nota sul flusso reale: il greeting apre la chat e i bottoni del primo step
 * appaiono SUBITO senza il testo della domanda (che è implicito nel greeting);
 * le domande successive arrivano invece come messaggi con typing delay.
 * L'API persiste i messaggi del visitatore (/api/chat/message); le domande
 * dello script vivono solo nel client — per questo le asserzioni DB contano
 * i messaggi visitor, non il totale.
 *
 * Il DB è il disposable locale `was_e2e` (scripts/e2e-db-reset.mjs): le
 * asserzioni di persistenza interrogano Postgres DOPO il submit. L'AI
 * (Ambrosio) è spenta di default su un DB fresco: lo script è deterministico.
 */

/** DSN del DB E2E: in CI il workflow passa E2E_PG* (servizio Postgres con password).
 *  In locale (trust auth) nessun utente esplicito: libpq usa l'utente del SO,
 *  che è il superuser del Postgres Homebrew (qui il ruolo «postgres» non esiste). */
const E2E_USER = process.env.E2E_PGUSER ?? (process.env.E2E_PGPASSWORD ? "postgres" : null);
const DSN =
  process.env.E2E_DATABASE_URL ??
  `postgresql://${E2E_USER ? `${E2E_USER}${process.env.E2E_PGPASSWORD ? `:${process.env.E2E_PGPASSWORD}` : ""}@` : ""}${
    process.env.E2E_PGHOST ?? "localhost"
  }:${process.env.E2E_PGPORT ?? "5432"}/${process.env.E2E_PGDATABASE ?? "was_e2e"}`;
const QUERY = "sito per il ristorante";

async function dbRow(query: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: DSN });
  await client.connect();
  try {
    const res = await client.query(query, params);
    return res.rows[0] ?? null;
  } finally {
    await client.end();
  }
}

test.describe("chat lead-gen", () => {
  test("dalla ricerca allo script: greeting e bottoni del primo step", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("searchbox", { name: /cerca/i }).fill(QUERY);
    await page.getByRole("searchbox", { name: /cerca/i }).press("Enter");
    await expect(page).toHaveURL(new RegExp(`/consulenza\\?q=${encodeURIComponent(QUERY)}`));

    // La chat parte da sola (splash 2s + init): il greeting riporta la query
    // cercata e i bottoni dello step `service` sono già pronti.
    await expect(page.getByText(new RegExp(`Cerchi «${QUERY}»\\?`))).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /Un sito web nuovo/ })).toBeVisible();
  });

  test("percorso completo: 9 step, lead nel DB, conversazione lead_captured", async ({ page }) => {
    await page.goto(`/consulenza?q=${encodeURIComponent(QUERY)}`);
    const body = page.locator("body");

    // 1. service (bottoni, senza testo della domanda) — scelgo "Un sito web nuovo".
    await body.getByRole("button", { name: /Un sito web nuovo/ }).click();

    // 2. timing (bottoni) — la domanda arriva come messaggio dopo il typing.
    await expect(body.getByText("Entro quando ti servirebbe?")).toBeVisible();
    await body.getByRole("button", { name: /Il prima possibile/ }).click();

    // 3. existing_site (bottoni)
    await expect(body.getByText("Hai già un sito?")).toBeVisible();
    await body.getByRole("button", { name: /No, parto da zero/ }).click();

    // 4. budget (bottoni)
    await expect(body.getByText(/Budget indicativo/)).toBeVisible();
    await body.getByRole("button", { name: /1\.000 – 3\.000/ }).click();

    // 5. company (bottoni): azienda → attiva lo step company_name
    await expect(body.getByText(/professionista o un'?azienda\?/i)).toBeVisible();
    await body.getByRole("button", { name: /Azienda \/ ditta/ }).click();

    // 6. company_name (testo, con validazione)
    await expect(body.getByText("Qual è il nome della tua ditta?")).toBeVisible();
    const composer = page.getByLabel("La tua risposta");
    await composer.fill("Trattoria Da Vinci");
    await composer.press("Enter");

    // 7. name (testo)
    await expect(body.getByText(/Come ti chiami\?/)).toBeVisible();
    await composer.fill("Marco");
    await composer.press("Enter");

    // 8. phone (testo) — la domanda personalizza col nome ricevuto
    await expect(body.getByText(/su quale numero ti richiamiamo\?/i)).toBeVisible();
    await composer.fill("333 1234567");
    await composer.press("Enter");

    // 9. consent (checkbox + submit)
    await expect(body.getByText(/Spunta qui sotto/)).toBeVisible();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /Invia e fatti richiamare/ }).click();

    // Chiusura dello script: conferma personalizzata col nome.
    await expect(body.getByText(/Fatto, Marco!|Fatto! ✅/)).toBeVisible({ timeout: 15_000 });

    // ── Il dato vive nel DB (disposable locale, non produzione) ──
    const lead = await dbRow(
      "select name, phone, service, urgency, existing_site, budget, company, company_name, consent, initial_query, source_page from leads order by created_at desc limit 1",
    );
    expect(lead, "nessun lead salvato: il submit non ha attraversato /api/lead").toBeTruthy();
    expect(lead.name).toBe("Marco");
    expect(lead.phone.replace(/\D/g, "")).toBe("3331234567");
    expect(lead.service).toContain("sito web");
    expect(lead.urgency).toBe("entro 2 settimane");
    expect(lead.existing_site).toBe("no, da zero");
    expect(lead.budget).toBe("1.000–3.000 €");
    expect(lead.company).toBe("azienda");
    expect(lead.company_name).toBe("Trattoria Da Vinci");
    expect(lead.consent).toBe(true);
    expect(lead.initial_query).toBe(QUERY);
    expect(lead.source_page).toBe("/");

    // La conversazione è stata collegata e marcata lead_captured.
    const conv = await dbRow(
      `select c.status, c.initial_query,
              (select count(*) from messages m where m.conversation_id = c.id and m.sender = 'visitor')::int as visitor_messages
       from conversations c
       where c.lead_id = (select id from leads order by created_at desc limit 1)`,
    );
    expect(conv, "la conversazione non è stata collegata al lead").toBeTruthy();
    expect(conv.status).toBe("lead_captured");
    expect(conv.initial_query).toBe(QUERY);
    // Le 8 risposte dello script (5 bottoni + 3 testi) sono persistite via
    // /api/chat/message: la trascrizione che il team rilegge è completa.
    expect(conv.visitor_messages).toBe(8);
  });
});
