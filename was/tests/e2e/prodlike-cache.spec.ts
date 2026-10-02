import { test, expect } from "@playwright/test";
import { scryptSync, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * PROVA DI PRODUZIONE del tool FREE CACHE (da lanciare contro un server BUILD
 * con `next start`, non il dev): stesso motore del deploy, stesso flusso di
 * sessione, chiavi di TEST. Copre il percorso completo che su produzione fa
 * un admin: login → Tools → Free cache → 4 target visibili → conferma a due
 * fasi → purga eseguita → audit registrato → età della cache azzerata.
 *
 * Cosa garantisce (la "fede di produzione" del tool):
 *  1. la scheda rende i QUATTRO target del catalogo con le pill del costo;
 *  2. la card età dice onestamente «Mai purgata dal registro» su DB pulito;
 *  3. la conferma a due fasi esegue la purga e torna alla scheda con l'esito;
 *  4. l'audit contiene cache.purga con attore, target e motivo;
 *  5. l'età della cache riletta l'audit: da «Mai purgata» a «oggi» SENZA
 *     polling né revalidate (la pagina è force-dynamic).
 *
 * RIPETIBILITÀ: i test sono in modo serial e il seed ripulisce davvero
 * l'audit (vedi la nota append-only nel seed), quindi la corsa si può
 * ripetere sullo stesso DB senza `e2e-db-reset`: il passo 2 del gate
 * pre-deploy resta consigliato, ma non è più un prerequisito di questa spec.
 */

const E2E_USER = process.env.E2E_PGUSER ?? (process.env.E2E_PGPASSWORD ? "postgres" : null);
const DSN =
  process.env.E2E_DATABASE_URL ??
  `postgresql://${E2E_USER ? `${E2E_USER}${process.env.E2E_PGPASSWORD ? `:${E2E_PGPASSWORD_SAFE()}` : ""}@` : ""}${
    process.env.E2E_PGHOST ?? "localhost"
  }:${process.env.E2E_PGPORT ?? "5432"}/${process.env.E2E_PGDATABASE ?? "was_e2e"}`;

function E2E_PGPASSWORD_SAFE(): string {
  return process.env.E2E_PGPASSWORD ?? "";
}

function hash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

async function dbExec(sql: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: DSN });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

/** Come dbExec ma su UNA connessione: serve a transactionare il seed
 *  (drop rule → delete → recreate rule), che su connessioni diverse sarebbe
 *  tre autocommit e lascerebbe il registro senza regola in caso di errore. */
async function dbTransaction<T>(fn: (client: pg.ClientBase) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: DSN });
  await client.connect();
  try {
    await client.query("begin");
    try {
      const out = await fn(client);
      await client.query("commit");
      return out;
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    }
  } finally {
    await client.end();
  }
}

const UTENTE = { email: "cacheprodlike@e2e.local", password: "CacheProdLike!2026" };
const MOTIVO = "verifica prodlike del tool Free cache";

test.describe.configure({ mode: "serial" });

/** Login reale per ogni test (pattern manutenzione.spec): sessioni fresche,
 *  niente dipendenze invisibili dall'ordine dei cookie nel worker. */
async function login(page: import("@playwright/test").Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(UTENTE.email);
  await page.getByLabel("Password").fill(UTENTE.password);
  await page.getByRole("button", { name: /entra/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
}

test.describe("Free cache su build di produzione-like", () => {
  test("seed: utente admin di test e audit senza cache.purga (storia pulita)", async () => {
    await dbExec("delete from admin_users where email = $1", [UTENTE.email]);
    await dbExec(`insert into admin_users (email, password_hash, role) values ($1,$2,'admin')`, [
      UTENTE.email,
      hash(UTENTE.password),
    ]);
    // Storia pulita: la scheda deve poter provare il ramo «mai purgata».
    // `audit_log` è APPEND-ONLY a livello DB (RULE no_delete, non trigger:
    // neon/migrations/010-audit-log.sql) — ogni DELETE è un no-op SILENZIOSO,
    // non un errore: il vecchio `delete from audit_log …` passava il seed ma
    // non puliva nulla, e alla seconda corsa la card leggeva la purga del run
    // precedente («Mai purgata dal registro» non trovato). Si toglie la regola
    // per la sola transazione e la si rimette subito: TRUNCATE azzererebbe
    // TUTTO l'audit (compreso ciò che serve agli altri spec).
    const pulite = await dbTransaction(async (c) => {
      await c.query("drop rule if exists audit_log_no_delete on audit_log");
      const del = await c.query("delete from audit_log where action like 'cache.purga%'");
      await c.query("create rule audit_log_no_delete as on delete to audit_log do instead nothing");
      return del.rowCount ?? 0;
    });
    // Se non pulisce nulla il seed è buggato: me accorgersene QUI che con
    // un falso fallimento 10 secondi dopo, nel test di percorso.
    expect(
      pulite,
      "seed: la pulizia di audit_log deve cancellare le righe cache.purga",
    ).toBeGreaterThan(0);
  });

  test("PERCORSO COMPLETO: login → scheda → 4 target → conferma → purga → audit → età «oggi»", async ({ page }) => {
    // ── Login reale su build (chiavi di TEST: il token lazy risolve da solo).
    await login(page);

    // ── La scheda: 4 target con il costo dichiarato, età onesta su storia vuota.
    await page.goto("/admin/tools/cache");
    await expect(page.getByRole("heading", { name: /Free cache/ })).toBeVisible();
    // I LABEL dei target (exact: il testo compare anche nella descrizione/pill).
    await expect(page.getByText("Tutto il sito", { exact: true })).toBeVisible();
    await expect(page.getByText("Solo la home", { exact: true })).toBeVisible();
    await expect(page.getByText("Solo le landing SEO", { exact: true })).toBeVisible();
    await expect(page.getByText("Solo l'admin", { exact: true })).toBeVisible();
    // Le pill del costo onesto sono nella scheda.
    await expect(page.getByText("pesante", { exact: true })).toBeVisible();
    await expect(page.getByText("trascurabile", { exact: true })).toBeVisible();
    // Su audit senza cache.purga l'età dice la verità.
    await expect(page.getByText(/Mai purgata dal registro/)).toBeVisible();

    // ── La conferma a due fasi: senza «Prepara», il bottone primario non purga.
    await page.getByLabel(/Motivo/).fill(MOTIVO);
    await page.getByRole("button", { name: "Svuota la cache", exact: true }).click();
    // Nessun target scelto: l'action esce senza gesto → nessun redirect di esito,
    // la scheda resta (il notice «Cache svuotata» NON appare).
    await expect(page.getByText(/Cache svuotata/)).toHaveCount(0);

    // ── Selezione del target «Solo l'admin» + prepara + conferma.
    await page.getByRole("checkbox", { name: /Solo l'admin/ }).check();
    await page.getByRole("button", { name: /Prepara la purga/i }).click();
    // Il box di conferma mostra ESATTAMENTE il target scelto (il bottone è la
    // variante visibile su desktop: la frase «Confermi la purga…» è la mobile).
    await expect(page.getByRole("button", { name: /Sì, svuota: Solo l'admin/ })).toBeVisible();
    await page.getByRole("button", { name: /Sì, svuota:/i }).click();

    // ── L'esito torna alla scheda con i target effettivi (redirect con query).
    await expect(page).toHaveURL(/\/admin\/tools\/cache\?.*purged=1/, { timeout: 20_000 });
    await expect(page.getByText(/Cache svuotata \(Solo l'admin\)/)).toBeVisible();

    // ── L'età della cache rilegge l'audit: da «Mai purgata» a «oggi» al volo.
    await expect(page.getByText(/Ultima purga: oggi/)).toBeVisible();
    await expect(page.getByText(/· Solo l'admin/)).toBeVisible();

    // ── L'audit contiene il gesto COMPLETO: attore, target, motivo.
    const { rows } = await dbExec(
      `select actor, action, target, detail from audit_log
       where action = 'cache.purga' order by created_at desc limit 1`,
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe(UTENTE.email);
    expect(rows[0].target).toBe("Solo l'admin");
    expect(rows[0].detail).toBe(MOTIVO);
  });

  test("MULTI-TARGET: home + admin insieme, conferma che li copre ENTRAMBI", async ({ page }) => {
    await login(page);
    await page.goto("/admin/tools/cache");
    await expect(page.getByRole("heading", { name: /Free cache/ })).toBeVisible();

    // La mutua esclusione: scegliere «Tutto il sito» disattiva i singoli.
    await page.getByRole("checkbox", { name: /Solo la home/ }).check();
    await page.getByRole("checkbox", { name: /Tutto il sito/ }).check();
    await expect(page.getByRole("checkbox", { name: /Solo la home/ })).not.toBeChecked();
    // E tornare ai singoli disattiva il layout.
    await page.getByRole("checkbox", { name: /Solo la home/ }).check();
    await expect(page.getByRole("checkbox", { name: /Tutto il sito/ })).not.toBeChecked();
    await page.getByRole("checkbox", { name: /Solo l'admin/ }).check();

    await page.getByRole("button", { name: /Prepara la purga/i }).click();
    // La conferma cita ENTRAMBI i target: coprirli tutti non è opzionale.
    await expect(page.getByText(/Sì, svuota: Solo la home, Solo l'admin/)).toBeVisible();
    await page.getByRole("button", { name: /Sì, svuota:/i }).click();

    await expect(page).toHaveURL(/purged=1/, { timeout: 20_000 });
    await expect(page.getByText(/Cache svuotata \(Solo la home, Solo l'admin\)/)).toBeVisible();
    // L'ultima riga di audit è la multi-target.
    const { rows } = await dbExec(
      `select target from audit_log where action = 'cache.purga' order by created_at desc limit 1`,
      [],
    );
    expect(rows[0].target).toBe("Solo la home, Solo l'admin");
  });

  test("il motore della purga funziona davvero: la home risponde dopo il revalidate", async ({ request }) => {
    // La purga del test precedente ha toccato "/" (multi-target): il sito
    // pubblico deve rispondere 200 come prima — revalidate non è un distruzione.
    const res = await request.get("/");
    expect(res.status()).toBe(200);
  });
});
