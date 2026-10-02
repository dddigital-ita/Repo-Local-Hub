import { db } from "./db";
import { decryptKey, encryptKey } from "./ai";
import { googleServiceAccountToken, type DriveCredentials } from "./drive";
import { getSyncConfig } from "./notion-config";
import { enqueueNotionSync } from "./notion-queue";
import { slotToDate } from "./slots";
import { logAudit } from "./audit";
import {
  GCAL_SCOPE,
  gcalEventDescription,
  gcalEventTitle,
  gcalEventWindow,
} from "./gcal-shared";
import { toE164 } from "./messaging";

/**
 * PORTAFOGLIO CLIENTI nel calendario: se il contatto della callback è già
 * cliente noto (via ticket collegato, telefono E.164 o email), l'evento
 * Google lo dice — nome e numero di ticket aperti. Una sola query, che
 * degredisce a null (contatto ignoto, tabelle assenti, DB fermo): mai un
 * errore per il calendario.
 */
async function clientContextForSync(
  conversationId: string | null,
  phone: string | null,
): Promise<{ name: string; tickets: number } | null> {
  if (!conversationId && !phone) return null;
  const pool = db();
  if (!pool) return null;
  try {
    const e164 = phone ? toE164(phone) : null;
    const { rows } = await pool.query<{ name: string; tickets: string }>(
      `select cl.name, (select count(*) from client_conversations cc where cc.client_id = cl.id) as tickets
       from clients cl
       where cl.id = (
         select cc.client_id from client_conversations cc
         where cc.conversation_id = $1
         union all
         select cl2.id from clients cl2
         where ($2::text is not null and cl2.phone_e164 = $2)
            or ($3::text <> '' and cl2.email_norm = lower($3))
         limit 1
       )`,
      [conversationId, e164, phone ?? ""],
    );
    const r = rows[0];
    return r ? { name: r.name, tickets: Number(r.tickets) } : null;
  } catch {
    return null;
  }
}

/**
 * INTEGRAZIONE GOOGLE CALENDAR — gli appunti dell'agenzia sul calendario.
 *
 * Scopo: un calendario Google sincronizzato con lead e appuntamenti presi
 * da Daniele, dal team e anche da Ambrosio AI. Ogni callback (widget pubblico,
 * inserimento dal team, fissata dal bot) genera un evento nel calendario
 * configurato; se il mirror Notion è attivo, la stessa callback finisce
 * anche nel database Notion (queue esistente, stessa idempotenza).
 *
 * AUTENTICAZIONE: service account, STESSA scuola di Drive (JWT RS256 →
 * access token). Con account di servizio serve CONDIVIDERE il calendario
 * con l'email del service account (permesso «Apportare modifiche agli
 * eventi»): il test di connessione verifica proprio questo.
 *
 * CONFIG: vive nella riga `gcal_config` di content_settings (JSON):
 *   { credsEnc, calendarId, enabled, syncToNotion, lastTestAt, lastTestOk }
 * Cifratura AES-256-GCM come le altre chiavi; la UI non espone mai il segreto.
 *
 * REGOLE (convenzione del repo, come Notion):
 * - NON bloccante: un errore di calendario non tocca mai callback/chat/admin;
 * - idempotente: gcal_sync_log(action='create', callback_id) è il dedup —
 *   dopo il backfill o un retry l'evento non si crea due volte;
 * - niente PII nei log: solo id, esiti e messaggi di errore Google.
 */

export const GCAL_CONFIG_KEY = "gcal_config";
export { GCAL_SCOPE } from "./gcal-shared";

const GCAL_TEST_ACTION = "gcal.test";

export interface GCalConfig {
  /** true quando c'è un JSON service account salvato (cifrato). */
  hasCreds: boolean;
  /** Email del service account (unico campo del segreto mostrabile). */
  clientEmail: string | null;
  /** ID calendario: email del calendario agenzia, o «primary». */
  calendarId: string | null;
  /** Toggle principale: senza di lui nessuna sync parte. */
  enabled: boolean;
  /** Mirror sull'entità Notion correlata (callback), se Notion è collegato. */
  syncToNotion: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
}

export const GCAL_DEFAULTS: Pick<GCalConfig, "enabled" | "syncToNotion"> = {
  enabled: false,
  syncToNotion: false,
};

interface StoredGCal {
  credsEnc?: unknown;
  calendarId?: unknown;
  enabled?: unknown;
  syncToNotion?: unknown;
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseServiceAccount(raw: string): DriveCredentials | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { client_email?: unknown; private_key?: unknown };
    const clientEmail = clean(parsed.client_email, 200);
    const privateKey = clean(parsed.private_key, 4000);
    return clientEmail && privateKey ? { clientEmail, privateKey } : null;
  } catch {
    return null;
  }
}

/** Legge la riga gcal_config (dove vive anche l'esito dell'ultimo test). */
async function readGCalRow(): Promise<{
  stored: StoredGCal;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
}> {
  const pool = db();
  if (!pool) return { stored: {}, lastTestAt: null, lastTestOk: null };
  try {
    const { rows } = await pool.query<{ value: StoredGCal }>(
      "select value from content_settings where key = $1",
      [GCAL_CONFIG_KEY],
    );
    const lastTest = await pool.query<{ created_at: string; detail: string | null }>(
      "select created_at, detail from audit_log where action = $1 order by created_at desc limit 1",
      [GCAL_TEST_ACTION],
    );
    const last = lastTest.rows[0];
    return {
      stored: rows[0]?.value ?? {},
      lastTestAt: last?.created_at ?? null,
      lastTestOk: last ? Boolean(last.detail && last.detail.startsWith("OK")) : null,
    };
  } catch {
    return { stored: {}, lastTestAt: null, lastTestOk: null };
  }
}

/** Config per la UI: mai il segreto, solo presenza + email + esito test. */
export async function getGCalConfig(): Promise<GCalConfig> {
  const { stored, lastTestAt, lastTestOk } = await readGCalRow();
  const encrypted = clean(stored.credsEnc, 4000);
  const creds = encrypted ? parseServiceAccount(decryptKey(encrypted) ?? "") : null;
  return {
    hasCreds: Boolean(creds),
    clientEmail: creds?.clientEmail ?? null,
    calendarId: clean(stored.calendarId, 200) || null,
    enabled: stored.enabled === undefined ? GCAL_DEFAULTS.enabled : Boolean(stored.enabled),
    syncToNotion: stored.syncToNotion === undefined ? GCAL_DEFAULTS.syncToNotion : Boolean(stored.syncToNotion),
    lastTestAt,
    lastTestOk,
  };
}

/** Il toggle master: l'unico modo per gli hook di sapere se devono parlare con Google. */
export async function isGCalEnabled(): Promise<boolean> {
  const cfg = await getGCalConfig();
  return cfg.enabled && cfg.hasCreds && Boolean(cfg.calendarId);
}

function readCredsJson(stored: StoredGCal): string | null {
  const encrypted = clean(stored.credsEnc, 4000);
  return encrypted ? (decryptKey(encrypted) ?? null) : null;
}

/** Credenziali decifrate per chi deve CHIAMARE l'API (test, sync). */
export async function getGCalCredentials(): Promise<DriveCredentials | null> {
  const { stored } = await readGCalRow();
  const raw = readCredsJson(stored);
  return raw ? parseServiceAccount(raw) : null;
}

/**
 * Salva la configurazione. Il JSON service account è opzionale a ogni
 * salvataggio (vuoto = non cambiare, «-» = rimuovere): gli altri campi
 * (calendarId, toggle) si possono ritoccare senza rispeditare la chiave.
 * Read-modify-write della riga: Drive e growth kit non vengono toccati.
 */
export async function saveGCalConfig(
  input: {
    serviceAccountJson?: string;
    calendarId?: string | null;
    enabled?: boolean;
    syncToNotion?: boolean;
  } = {},
): Promise<{ ok: boolean; error?: string }> {
  const pool = db();
  if (!pool) return { ok: false, error: "database non configurato" };

  const { stored } = await readGCalRow();
  const raw = typeof input.serviceAccountJson === "string" ? input.serviceAccountJson.trim() : "";

  let credsEnc: string | undefined;
  if (raw === "-") {
    credsEnc = "";
  } else if (raw) {
    const creds = parseServiceAccount(raw);
    if (!creds) {
      return {
        ok: false,
        error: "JSON non valido: servono client_email e private_key (il file completo scaricato da Google Cloud va bene).",
      };
    }
    credsEnc = encryptKey(raw.slice(0, 4000));
  }

  const calendarId = input.calendarId === undefined
    ? clean(stored.calendarId, 200)
    : clean(input.calendarId, 200).replace(/^@/, "").slice(0, 200);

  const next: StoredGCal = {
    ...stored,
    ...(credsEnc !== undefined ? { credsEnc } : {}),
    calendarId,
    enabled: input.enabled ?? GCAL_DEFAULTS.enabled,
    syncToNotion: input.syncToNotion ?? GCAL_DEFAULTS.syncToNotion,
  };

  await pool.query(
    `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [GCAL_CONFIG_KEY, JSON.stringify(next)],
  );
  return { ok: true };
}

/* ── API Calendar (fetch diretto, zero dipendenze nuove) ────────── */

function gcalApiUrl(calendarId: string, path = ""): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}${path}`;
}

// Titolo, descrizione e finestra dell'evento vivono nel layer puro
// `gcal-shared.ts` (testato con import diretto): qui solo DB e chiamate API.

/**
 * Test di connessione REALE: token con scope calendar, poi un GET sul
 * calendario configurato. Fallisce se: JSON non valido, API Calendar
 * spenta nel progetto Google, calendario inesistente o NON condiviso con
 * il service account — cioè esattamente i guasti che il test deve
 * scovare prima della produzione.
 */
export async function testGCalConnection(): Promise<{ ok: boolean; message: string }> {
  const cfg = await getGCalConfig();
  const creds = await getGCalCredentials();
  if (!creds) return { ok: false, message: "Credenziali mancanti: salva prima il JSON del service account." };
  if (!cfg.calendarId) return { ok: false, message: "Calendar ID mancante: indica il calendario da sincronizzare (o usa primary)." };
  try {
    const token = await googleServiceAccountToken(creds, GCAL_SCOPE);
    const response = await fetch(gcalApiUrl(cfg.calendarId), {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 160);
      return {
        ok: false,
        message:
          response.status === 404
            ? "Calendario non trovato (404): controlla il Calendar ID e che sia CONDIVISO con il service account (permesso «Apportare modifiche agli eventi»)."
            : `Calendar API ha risposto ${response.status}: ${text || "controlla API abilitata e condivisione del calendario"}.`,
      };
    }
    return { ok: true, message: `Connesso come ${creds.clientEmail} al calendario ${cfg.calendarId}.` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "errore sconosciuto";
    return { ok: false, message: `Calendar non raggiungibile: ${msg}. Controlla connettività e private_key.` };
  }
}

/* ── Sync callback → evento (dedup, mirror Notion, mai bloccante) ── */

export interface GCalSyncInput {
  callbackId: string;
  /** Data/ora dell'impegno; se assente si prova a dedurla dallo slot. */
  scheduledAt: Date | null;
  slotLabel: string | null;
  /** Nome cliente / contatto / servizio per titolo e descrizione. */
  leadName: string | null;
  leadPhone: string | null;
  service: string | null;
  conversationId: string | null;
  /** true quando la callback è stata fissata da Ambrosio (audit actor ambrosio@ai): il titolo lo dice. */
  fromAi: boolean;
  /** Operatore che prende l'impegno (per il titolo), se noto. */
  operatorName: string | null;
  /** Motore: create = nuovo evento; delete = evento già esistente, lo rimuoviamo. */
  action: "create" | "delete";
}

/** Credenziali leggere (evita una seconda lettura della riga nel path sync). */
async function credsForSync(): Promise<{ creds: DriveCredentials; calendarId: string } | null> {
  const pool = db();
  if (!pool) return null;
  try {
    const { rows } = await pool.query<{ value: StoredGCal }>(
      "select value from content_settings where key = $1",
      [GCAL_CONFIG_KEY],
    );
    const stored = rows[0]?.value ?? {};
    const raw = readCredsJson(stored);
    const creds = raw ? parseServiceAccount(raw) : null;
    const calendarId = clean(stored.calendarId, 200);
    if (!creds || !calendarId) return null;
    return { creds, calendarId };
  } catch {
    return null;
  }
}

/** Dedup: l'evento di questa callback esiste già? (azione create nel log) */
async function alreadySynced(callbackId: string): Promise<boolean> {
  const pool = db();
  if (!pool) return true; // senza log non si può garantire il dedup: meglio non duplicare
  try {
    const { rows } = await pool.query<{ n: string }>(
      "select count(*) as n from gcal_sync_log where callback_id = $1 and action = 'create' and event_id is not null",
      [callbackId],
    );
    return Number(rows[0]?.n ?? 0) > 0;
  } catch {
    return true;
  }
}

async function logSync(callbackId: string, action: string, eventId: string | null, detail: string | null): Promise<void> {
  const pool = db();
  if (!pool) return;
  try {
    await pool.query(
      "insert into gcal_sync_log (callback_id, action, event_id, detail) values ($1, $2, $3, $4)",
      [callbackId, action, eventId, detail?.slice(0, 500) ?? null],
    );
  } catch {
    /* tabella non migrata: il log non deve fermare la sync */
  }
}

/**
 * Sincronizza UNA callback su Google Calendar (e, se configurato, su Notion).
 * NON bloccante per costruzione: ogni errore finisce nel log dedicato e
 * nell'audit, mai in una eccezione per il chiamante. Idempotente: la
 * callback già sincronizzata viene saltata (dedup su gcal_sync_log).
 */
export async function syncCallbackToGCal(input: GCalSyncInput): Promise<{ ok: boolean; skipped?: string; eventId?: string }> {
  try {
    if (!(await isGCalEnabled())) return { ok: false, skipped: "gcal_disabled" };
    if (input.action === "delete") {
      return await deleteCallbackEvent(input);
    }
    if (await alreadySynced(input.callbackId)) return { ok: true, skipped: "già sincronizzata" };

    const scheduledAt = input.scheduledAt ?? (input.slotLabel ? slotToDate(input.slotLabel) : null);
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
      await logSync(input.callbackId, "skip", null, `slot non interpretabile: ${input.slotLabel ?? "—"} (evento non creato)`);
      return { ok: false, skipped: "slot_non_valido" };
    }
    const pair = await credsForSync();
    if (!pair) {
      await logSync(input.callbackId, "error", null, "credenziali o calendar_id illeggibili al momento della sync");
      return { ok: false, skipped: "config_non_pronta" };
    }
    const token = await googleServiceAccountToken(pair.creds, GCAL_SCOPE);
    const win = gcalEventWindow(scheduledAt);
    // Portafoglio clienti: il contatto è già cliente noto? L'evento Google
    // lo dice (nome + ticket totali), su TUTTE le vie di sync: hook,
    // backfill e retry passano tutti da qui.
    const client = await clientContextForSync(input.conversationId, input.leadPhone);
    const body = {
      summary: gcalEventTitle(input.leadName, input.operatorName, input.fromAi),
      description: gcalEventDescription({
        phone: input.leadPhone,
        service: input.service,
        slot: input.slotLabel,
        conversationId: input.conversationId,
        clientName: client?.name ?? null,
        clientTickets: client?.tickets ?? null,
      }),
      start: { dateTime: win.start.toISOString(), timeZone: "Europe/Rome" },
      end: { dateTime: win.end.toISOString(), timeZone: "Europe/Rome" },
      reminders: { useDefault: true },
    };
    const response = await fetch(gcalApiUrl(pair.calendarId, "/events"), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 200);
      await logSync(input.callbackId, "error", null, `create ${response.status}: ${text}`);
      await logAudit("system", "gcal.sync-fallito", input.callbackId, `create ${response.status}: ${text.slice(0, 120)}`);
      return { ok: false, skipped: `errore_${response.status}` };
    }
    const created = (await response.json()) as { id?: string };
    await logSync(input.callbackId, "create", created.id ?? null, `evento creato (${scheduledAt.toISOString()})`);
    await logAudit("system", "gcal.sync", input.callbackId, `evento ${created.id ?? "?"} su ${pair.calendarId}`);

    // MIRROR NOTION (se il toggle nella scheda è attivo): la callback finisce
    // anche nel database Notion, via coda esistente (idempotente e con retry).
    // Il toggle si legge FRESCO qui: girare l'interruttore in scheda vale
    // dall'evento successivo, senza dipendere da cosa ha passato il chiamante.
    try {
      const cfgNow = await getGCalConfig();
      if (cfgNow.syncToNotion) {
        const ncfg = await getSyncConfig();
        if (ncfg.entities.callbacks.enabled) {
          await enqueueNotionSync(
            "callback",
            {
              id: input.callbackId,
              summary: gcalEventTitle(input.leadName, input.operatorName, input.fromAi),
              slot: input.slotLabel,
              outcome: "pending",
              created_at: new Date().toISOString(),
            },
            ncfg,
          );
        }
      }
    } catch {
      /* mirror facoltativo: mai un errore per il calendario */
    }
    return { ok: true, eventId: created.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "errore sconosciuto";
    await logSync(input.callbackId, "error", null, msg);
    await logAudit("system", "gcal.sync-fallito", input.callbackId, msg.slice(0, 200));
    return { ok: false, skipped: "errore" };
  }
}

/** Rimuove l'evento Google collegato (callback done/missed/cancellata). */
async function deleteCallbackEvent(input: GCalSyncInput): Promise<{ ok: boolean; skipped?: string }> {
  const pool = db();
  if (!pool) return { ok: false, skipped: "db_non_configurato" };
  try {
    const { rows } = await pool.query<{ event_id: string | null }>(
      "select event_id from gcal_sync_log where callback_id = $1 and action = 'create' and event_id is not null order by created_at desc limit 1",
      [input.callbackId],
    );
    const eventId = rows[0]?.event_id;
    if (!eventId) return { ok: true, skipped: "nessun evento collegato" };
    const pair = await credsForSync();
    if (!pair) return { ok: false, skipped: "config_non_pronta" };
    const token = await googleServiceAccountToken(pair.creds, GCAL_SCOPE);
    const response = await fetch(gcalApiUrl(pair.calendarId, `/events/${encodeURIComponent(eventId)}`), {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok && response.status !== 410 && response.status !== 404) {
      const text = (await response.text()).slice(0, 160);
      await logSync(input.callbackId, "error", eventId, `delete ${response.status}: ${text}`);
      return { ok: false, skipped: `errore_${response.status}` };
    }
    await logSync(input.callbackId, "delete", eventId, "evento rimosso dal calendario (callback conclusa)");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "errore sconosciuto";
    await logSync(input.callbackId, "error", null, msg);
    return { ok: false, skipped: "errore" };
  }
}

/* ── Backfill: callback senza evento (le vecchie e quelle saltate) ─ */

export interface GCalBackfillResult {
  processed: number;
  created: number;
  skipped: number;
  errors: number;
  messages: string[];
}

/**
 * Ripercorre le callback pending senza evento e le sincronizza. Serve dopo
 * l'attivazione (le callback storiche non hanno evento) e dopo ogni fix di
 * configurazione. Limitato per richiesta (never hammer the API): 20 per giro,
 * si può rilanciare finché created=0.
 */
export async function backfillGCalEvents(limit = 20): Promise<GCalBackfillResult> {
  const pool = db();
  const empty: GCalBackfillResult = { processed: 0, created: 0, skipped: 0, errors: 0, messages: [] };
  if (!pool) return empty;
  try {
    const { rows } = await pool.query<{
      id: string;
      scheduled_at: string;
      slot_label: string | null;
      conversation_id: string | null;
      lead_name: string | null;
      lead_phone: string | null;
      service: string | null;
      operator_id: string | null;
      from_ai: boolean;
    }>(
      `select cb.id, cb.scheduled_at, cb.slot_label, cb.conversation_id,
              l.name as lead_name, l.phone as lead_phone, l.service,
              cb.operator_id,
              exists (select 1 from audit_log a where a.action = 'ambrosio.fissa_callback' and a.target = cb.id) as from_ai
       from callbacks cb
       left join leads l on l.id = cb.lead_id
       where cb.status = 'pending'
         and not exists (select 1 from gcal_sync_log g where g.callback_id = cb.id and g.action = 'create' and g.event_id is not null)
       order by cb.scheduled_at desc
       limit $1`,
      [String(Math.max(1, Math.min(50, Math.round(limit))))],
    );
    const result: GCalBackfillResult = { processed: rows.length, created: 0, skipped: 0, errors: 0, messages: [] };
    for (const r of rows) {
      const res = await syncCallbackToGCal({
        callbackId: r.id,
        scheduledAt: new Date(r.scheduled_at),
        slotLabel: r.slot_label,
        leadName: r.lead_name,
        leadPhone: r.lead_phone,
        service: r.service,
        conversationId: r.conversation_id,
        fromAi: Boolean(r.from_ai),
        operatorName: r.operator_id,
        action: "create",
      });
      if (res.ok && !res.skipped) result.created++;
      else if (res.ok) result.skipped++;
      else result.errors++;
      if (res.skipped && res.skipped !== "già sincronizzata" && result.messages.length < 5) {
        result.messages.push(`callback ${r.id.slice(0, 8)}: ${res.skipped}`);
      }
    }
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "errore sconosciuto";
    return { ...empty, errors: 1, messages: [msg] };
  }
}

/* ── Punto di aggancio unico per tutti i percorsi callback ─────── */

interface CallbackContextRow {
  id: string;
  scheduled_at: string;
  slot_label: string | null;
  conversation_id: string | null;
  lead_name: string | null;
  lead_phone: string | null;
  service: string | null;
  operator_id: string | null;
  from_ai: boolean;
}

const CALLBACK_CONTEXT_SQL = `
  select cb.id, cb.scheduled_at, cb.slot_label, cb.conversation_id,
         l.name as lead_name, l.phone as lead_phone, l.service,
         cb.operator_id,
         exists (select 1 from audit_log a where a.action = 'ambrosio.fissa_callback' and a.target = cb.id) as from_ai
  from callbacks cb
  left join leads l on l.id = cb.lead_id
  where cb.id = $1`;

function contextToInput(r: CallbackContextRow, action: "create" | "delete"): GCalSyncInput {
  return {
    callbackId: r.id,
    scheduledAt: new Date(r.scheduled_at),
    slotLabel: r.slot_label,
    leadName: r.lead_name,
    leadPhone: r.lead_phone,
    service: r.service,
    conversationId: r.conversation_id,
    fromAi: Boolean(r.from_ai),
    operatorName: r.operator_id,
    action,
  };
}

/**
 * AGGANCIO per TUTTI i percorsi che toccano una callback (widget API, tool
 * di Ambrosio, schede admin): legge il contesto, chiama la sync e NON lancia
 * mai eccezioni — callback/chat/admin non devono accorgersi del calendario.
 * action "create" = evento nuovo (dedup interno); "delete" = evento esistente
 * da rimuovere (callback conclusa o cancellata).
 */
export async function queueGCalSyncForCallback(
  pool: NonNullable<ReturnType<typeof db>>,
  callbackId: string,
  action: "create" | "delete" = "create",
): Promise<void> {
  try {
    if (action === "delete") {
      await syncCallbackToGCal({ callbackId, scheduledAt: null, slotLabel: null, leadName: null, leadPhone: null, service: null, conversationId: null, fromAi: false, operatorName: null, action: "delete" });
      return;
    }
    const { rows } = await pool.query<CallbackContextRow>(CALLBACK_CONTEXT_SQL, [callbackId]);
    const r = rows[0];
    if (!r) return;
    await syncCallbackToGCal(contextToInput(r, "create"));
  } catch (e) {
    console.error("[gcal] hook callback:", e instanceof Error ? e.message : e);
  }
}

/**
 * Riprogramma l'evento di una callback (es. «Richiama ora»): PATCH delle
 * sole date sull'evento esistente; senza evento lo crea (stessa dedup).
 * Come sempre: non bloccante, errori nel log dedicato.
 */
export async function rescheduleGCalEvent(
  pool: NonNullable<ReturnType<typeof db>>,
  callbackId: string,
  newStart: Date,
): Promise<void> {
  try {
    const { rows } = await pool.query<CallbackContextRow>(CALLBACK_CONTEXT_SQL, [callbackId]);
    const r = rows[0];
    if (!r) return;
    const pair = await credsForSync();
    const cfg = await getGCalConfig();
    if (!pair || !cfg.enabled) return;
    const found = await pool.query<{ event_id: string | null }>(
      "select event_id from gcal_sync_log where callback_id = $1 and action = 'create' and event_id is not null order by created_at desc limit 1",
      [callbackId],
    );
    const eventId = found.rows[0]?.event_id;
    if (!eventId) {
      await syncCallbackToGCal(contextToInput(r, "create"));
      return;
    }
    const token = await googleServiceAccountToken(pair.creds, GCAL_SCOPE);
    const win = gcalEventWindow(newStart);
    const body = {
      start: { dateTime: win.start.toISOString(), timeZone: "Europe/Rome" },
      end: { dateTime: win.end.toISOString(), timeZone: "Europe/Rome" },
    };
    const response = await fetch(gcalApiUrl(pair.calendarId, `/events/${encodeURIComponent(eventId)}`), {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 160);
      await logSync(callbackId, "error", eventId, `reschedule ${response.status}: ${text}`);
      return;
    }
    await logSync(callbackId, "update", eventId, `evento riprogrammato (${newStart.toISOString()})`);
  } catch (e) {
    console.error("[gcal] reschedule:", e instanceof Error ? e.message : e);
  }
}

/* ── Diagnostica: eventi creati, errori, retry ─────────────────── */

export interface GCalDiagnosticRow {
  callbackId: string | null;
  detail: string | null;
  createdAt: string;
  leadName: string | null;
  slotLabel: string | null;
}

export interface GCalDiagnostics {
  /** Eventi creati con successo nelle ultime 24 ore. */
  created24h: number;
  /** Righe di errore delle ultime 24 ore. */
  errors24h: number;
  /** Callback distinte con errore MAI sincronizzate con successo (ritentabili). */
  pendingRetry: number;
  /** Gli ultimi errori, con contesto della callback (max 8). */
  recentErrors: GCalDiagnosticRow[];
  /** Quando è stato creato l'ultimo evento. */
  lastCreatedAt: string | null;
}

const EMPTY_DIAGNOSTICS: GCalDiagnostics = {
  created24h: 0,
  errors24h: 0,
  pendingRetry: 0,
  recentErrors: [],
  lastCreatedAt: null,
};

/**
 * Riepilogo di salute della sync per la scheda: quanti eventi sono partiti,
 * quanti errori e quali callback sono rimaste indietro (mai consegnate).
 * Ogni query degredisce da sola: tabella assente = diagnostica vuota, mai 500.
 */
export async function getGCalDiagnostics(): Promise<GCalDiagnostics> {
  const pool = db();
  if (!pool) return EMPTY_DIAGNOSTICS;
  try {
    const counts = await pool.query<{ created: string; errors: string; last_created: string | null }>(
      `select count(*) filter (where action = 'create' and created_at > now() - interval '24 hours') as created,
              count(*) filter (where action = 'error' and created_at > now() - interval '24 hours') as errors,
              max(created_at) filter (where action = 'create') as last_created
       from gcal_sync_log`,
    );
    const c = counts.rows[0];
    const pending = await pool.query<{ n: string }>(
      `select count(distinct g.callback_id) as n
       from gcal_sync_log g
       where g.action = 'error' and g.callback_id is not null
         and not exists (
           select 1 from gcal_sync_log g2
           where g2.callback_id = g.callback_id and g2.action = 'create' and g2.event_id is not null
         )`,
    );
    const errors = await pool.query<{
      callback_id: string | null;
      detail: string | null;
      created_at: string;
      lead_name: string | null;
      slot_label: string | null;
    }>(
      `select g.callback_id, g.detail, g.created_at, l.name as lead_name, cb.slot_label
       from gcal_sync_log g
       left join callbacks cb on cb.id = g.callback_id
       left join leads l on l.id = cb.lead_id
       where g.action = 'error'
       order by g.created_at desc
       limit 8`,
    );
    return {
      created24h: Number(c?.created ?? 0),
      errors24h: Number(c?.errors ?? 0),
      pendingRetry: Number(pending.rows[0]?.n ?? 0),
      lastCreatedAt: c?.last_created ?? null,
      recentErrors: errors.rows.map((r) => ({
        callbackId: r.callback_id,
        detail: r.detail,
        createdAt: r.created_at,
        leadName: r.lead_name,
        slotLabel: r.slot_label,
      })),
    };
  } catch {
    return EMPTY_DIAGNOSTICS;
  }
}

export interface GCalRetryResult {
  retried: number;
  ok: number;
  errors: number;
}

/**
 * RIPROVA le callback fallite: prende le callback con errore MAI consegnate
 * (il dedup esclude quelle già andate) e rilancia la sync per ognuna, con
 * lo stesso percorso e gli stessi log di una callback nuova. Il verificare
 * DOPO il tentativo (riga 'create' con evento) rende l'esito onesto anche
 * se la sync è skip (config non pronta: resta da riprovare, non è un errore
 * nuovo). Limite per richiesta: si rilancia finché retried è 0.
 */
export async function retryFailedGCalSync(limit = 10): Promise<GCalRetryResult> {
  const pool = db();
  if (!pool) return { retried: 0, ok: 0, errors: 0 };
  try {
    const { rows } = await pool.query<{ id: string }>(
      `select g.callback_id as id
       from gcal_sync_log g
       where g.action = 'error' and g.callback_id is not null
         and not exists (
           select 1 from gcal_sync_log g2
           where g2.callback_id = g.callback_id and g2.action = 'create' and g2.event_id is not null
         )
       group by g.callback_id
       order by max(g.created_at) desc
       limit $1`,
      [String(Math.max(1, Math.min(50, Math.round(limit))))],
    );
    let ok = 0;
    let errors = 0;
    for (const r of rows) {
      await queueGCalSyncForCallback(pool, r.id, "create");
      const chk = await pool.query<{ n: string }>(
        "select count(*) as n from gcal_sync_log where callback_id = $1 and action = 'create' and event_id is not null",
        [r.id],
      );
      if (Number(chk.rows[0]?.n ?? 0) > 0) ok++;
      else errors++;
    }
    return { retried: rows.length, ok, errors };
  } catch (e) {
    console.error("[gcal] retry:", e instanceof Error ? e.message : e);
    return { retried: 0, ok: 0, errors: 0 };
  }
}
