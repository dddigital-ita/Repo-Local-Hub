import { db } from "./db";
import { logAudit } from "./audit";
import { createNotionPage } from "./notion";
import { buildNotionPayload, getSyncConfig, type MappingField, type NotionSyncConfig } from "./notion-config";

/**
 * Coda persistente per la sincronizzazione Notion (FASE 2).
 *
 * Regole del prompt rispettate:
 * - NON bloccante: enqueue dopo il salvataggio del lead, errori loggati
 *   e assorbiti — chat, ticketing e lead non si accorgono di Notion.
 * - Idempotente: unique(entity, record_id) → mai doppioni in coda.
 * - Il payload è calcolato dal MOTORE DI MAPPING all'enqueue (non dal
 *   percorso legacy): la coda è la fonte, il drain non rilegge il record
 *   e rispetta la config anche se il lead cambia mentre è in coda.
 * - Retry esponenziale con rispetto del 429 (`Retry-After`).
 * - Nessun PII nei log: solo id, esiti e messaggi di errore Notion.
 */

type Entity = "lead" | "ticket" | "callback" | "client";

/** Rate limit Notion reale: 3 req/s → minimo 350ms tra chiamate. */
const MIN_INTERVAL_MS = 350;

/** Mapping minimale per ticket/callback/client (Fase 4: entità spente di default). */
function fallbackMapping(entity: Entity): MappingField[] {
  if (entity === "ticket") {
    return [
      { from: "title", to: "Titolo", type: "title" },
      { from: "status", to: "Stato", type: "select" },
      { from: "priority", to: "Priorità", type: "select" },
      { from: "updated_at", to: "Aggiornato", type: "date", transform: "iso8601" },
    ];
  }
  if (entity === "client") {
    // Target del database unificato «Web Agency — Lead & Clienti»: un
    // database Notion ha UNA sola proprietà title («Nome», condivisa con
    // i lead) e «Telefono» è rich_text come nel mapping lead.
    return [
      { from: "name", to: "Nome", type: "title" },
      { from: "phone_e164", to: "Telefono", type: "rich_text" },
      { from: "contact_email", to: "Email", type: "email" },
      { from: "company_name", to: "Azienda", type: "rich_text", maxLen: 190 },
      { from: "ticket_count", to: "Ticket", type: "number" },
      { from: "channels", to: "Canali", type: "rich_text", maxLen: 100 },
      { from: "last_seen_at", to: "Ultimo contatto", type: "date", transform: "iso8601" },
    ];
  }
  return [
    { from: "summary", to: "Riepilogo", type: "title" },
    { from: "slot", to: "Slot", type: "select" },
    { from: "outcome", to: "Esito", type: "select" },
    { from: "created_at", to: "Creato", type: "date", transform: "iso8601" },
  ];
}

/**
 * Enqueue di un record (non bloccante, mai eccezioni a monte).
 * Ritorna true se il record è stato accodato (o c'era già).
 */
export async function enqueueNotionSync(
  entity: Entity,
  record: Record<string, unknown>,
  config: NotionSyncConfig,
): Promise<boolean> {
  const pool = db();
  if (!pool) return false;
  try {
    const mapping = entity === "lead" ? config.leadMapping : fallbackMapping(entity);
    const { properties } = buildNotionPayload(config, mapping, record);
    const { rowCount } = await pool.query(
      `insert into notion_sync_queue (entity, record_id, payload)
       values ($1, $2, $3)
       on conflict (entity, record_id) do nothing`,
      [entity, String(record.id), JSON.stringify({ properties })],
    );
    return (rowCount ?? 0) > 0;
  } catch (e) {
    console.error("[notion-queue] enqueue fallito", entity, e instanceof Error ? e.message : e);
    return false;
  }
}

export interface DrainResult {
  processed: number;
  ok: number;
  retried: number;
  failed: number;
  messages: string[];
}

/** Svuota la coda: push di ogni record dovuto, con rate limit, retry e 429-awareness. */
export async function drainNotionQueue(opts: { actor: string }): Promise<DrainResult> {
  const pool = db();
  if (!pool) return { processed: 0, ok: 0, retried: 0, failed: 0, messages: ["database non configurato"] };
  const config = await getSyncConfig();
  const batch = Math.max(1, config.sync.batchMax);
  const maxAttempts = Math.max(1, config.sync.retryAttempts);
  const baseMs = Math.max(0, config.sync.retryBaseMs);

  const { rows: due } = await pool.query<{
    id: string;
    entity: Entity;
    record_id: string;
    payload: { properties: Record<string, unknown> };
    attempts: number;
  }>(
    `select id, entity, record_id, payload, attempts
     from notion_sync_queue
     where next_run_at <= now() and attempts < $1
     order by created_at
     limit $2`,
    [maxAttempts, batch],
  );

  let ok = 0;
  let retried = 0;
  let failed = 0;
  const messages: string[] = [];
  let lastCallAt = 0;

  for (const job of due) {
    // Rate limit: distanzia le chiamate (Notion: 3 req/s).
    const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();

    const res = await createNotionPage(job.payload.properties);
    if (res.ok) {
      await pool.query("delete from notion_sync_queue where id = $1", [job.id]);
      // Idempotenza: il lead consegnato viene marcato ORA (prima l'update
      // viveva nell'action ma puntava a una tabella inesistente e non
      // partiva mai) — senza marcatura il prossimo sync lo riaccodava e
      // rideliverava, creando doppioni nel workspace.
      if (job.entity === "lead") {
        await pool
          .query(
            "update leads set notion_synced_at = now() where id = $1 and notion_synced_at is null",
            [job.record_id],
          )
          .catch(() => {});
      }
      // Idempotenza dei client (027): stessa regola dei lead — il drain
      // crea pagine nuove, quindi dopo la consegna la scheda viene
      // marcata: il sync del portafoglio non la ri-accoda più e il
      // workspace Notion non si riempie di copie.
      if (job.entity === "client") {
        await pool
          .query(
            "update clients set notion_synced_at = now() where id = $1 and notion_synced_at is null",
            [job.record_id],
          )
          .catch(() => {});
      }
      ok++;
      continue;
    }

    const attempts = job.attempts + 1;
    const retryAfterS = res.retryAfterS ? Number(res.retryAfterS) : null;
    const backoffMs =
      retryAfterS != null && Number.isFinite(retryAfterS)
        ? retryAfterS * 1000
        : baseMs * Math.pow(2, attempts - 1);
    // Errori permanenti (payload rifiutato, database non condiviso): niente retry inutile.
    const permanent = res.status === 400 || res.status === 404;
    const giveUp = attempts >= maxAttempts || permanent;

    if (giveUp) {
      // Consegna definitiva fallita: resta visibile nel sync log (non si butta via nulla).
      await pool.query(
        `update notion_sync_queue
         set attempts = $2, last_error = $3, last_error_at = now(), next_run_at = 'infinity'::timestamptz
         where id = $1`,
        [job.id, attempts, res.message.slice(0, 500)],
      );
      failed++;
      messages.push(`${job.entity} ${job.record_id.slice(0, 8)}: ${res.message}`);
      await logAudit(
        opts.actor,
        "notion.sync-fallito",
        `${job.entity}:${job.record_id.slice(0, 8)}`,
        res.message.slice(0, 200),
      );
    } else {
      await pool.query(
        `update notion_sync_queue
         set attempts = $2, last_error = $3, last_error_at = now(),
             next_run_at = now() + ($4 || ' milliseconds')::interval
         where id = $1`,
        [job.id, attempts, res.message.slice(0, 500), String(Math.round(backoffMs))],
      );
      retried++;
      messages.push(
        `${job.entity} ${job.record_id.slice(0, 8)}: ritento tra ${Math.round(backoffMs / 1000)}s — ${res.message}`,
      );
    }
  }

  // Fonte per gli stati futuri (convenzione del progetto: l'audit è il
  // registro append-only da cui si leggono le statistiche): ogni drain con
  // almeno una consegna scrive «notion.sync» — è da qui che l'hub mostra
  // «Ultimo sync», perché la coda cancella le righe riuscite.
  if (ok > 0) {
    await logAudit(opts.actor, "notion.sync", null, `${ok} record consegnati`);
  }

  return { processed: due.length, ok, retried, failed, messages };
}
