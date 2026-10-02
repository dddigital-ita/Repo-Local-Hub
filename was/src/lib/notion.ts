import { db } from "./db";
import { encryptKey, decryptKey } from "./ai";

/**
 * Notion: lo strumento è pronto ma in "attesa chiavi". Quando l'agenzia
 * crea l'integrazione su notion.so (secret ntn_…) e un database, da qui
 * si testa la connessione e si sincronizzano i lead come pagine.
 * La chiave resta cifrata AES-256-GCM (stesso schema di Ambrosio).
 */

export interface NotionSettings {
  enabled: boolean;
  hasKey: boolean;
  databaseId: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
}

interface NotionRow {
  enabled: boolean;
  api_key_enc: string | null;
  database_id: string | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
}

export async function getNotionSettings(): Promise<NotionSettings | null> {
  const pool = db();
  if (!pool) return null;
  try {
    await ensureRow(pool);
    const { rows } = await pool.query<NotionRow>("select * from notion_settings where id = 1");
    const r = rows[0];
    if (!r) return null;
    return {
      enabled: r.enabled,
      hasKey: Boolean(r.api_key_enc),
      databaseId: r.database_id,
      lastTestAt: r.last_test_at,
      lastTestOk: r.last_test_ok,
    };
  } catch {
    return null;
  }
}

async function ensureRow(pool: NonNullable<ReturnType<typeof db>>) {
  await pool.query("insert into notion_settings (id) values (1) on conflict (id) do nothing");
}

/** Salva le impostazioni; chiave vuota = non cambiare quella esistente. */
export async function saveNotionSettings(input: {
  enabled: boolean;
  apiKey?: string;
  databaseId?: string | null;
}): Promise<void> {
  const pool = db();
  if (!pool) throw new Error("database non configurato");
  await ensureRow(pool);
  const enc = input.apiKey ? encryptKey(input.apiKey) : null;
  await pool.query(
    `update notion_settings
     set enabled = $1,
         api_key_enc = coalesce($2, api_key_enc),
         database_id = nullif($3, ''),
         updated_at = now()
     where id = 1`,
    [input.enabled, enc, input.databaseId ?? ""],
  );
}

async function getApiKey(): Promise<string | null> {
  const pool = db();
  if (!pool) return null;
  const { rows } = await pool.query<{ api_key_enc: string | null }>(
    "select api_key_enc from notion_settings where id = 1",
  );
  const enc = rows[0]?.api_key_enc;
  return enc ? decryptKey(enc) : null;
}

export interface NotionTestResult {
  ok: boolean;
  message: string;
}

/** Test di connessione: recupera il database configurato. */
export async function testNotionConnection(): Promise<NotionTestResult> {
  const pool = db();
  const key = await getApiKey();
  const settings = await getNotionSettings();
  if (!key) return { ok: false, message: "Chiave mancante: incolla il secret dell'integrazione (ntn_…)." };
  const dbId = settings?.databaseId;
  if (!dbId) return { ok: false, message: "Database ID mancante: incolla l'id del database Notion." };

  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId.replace(/-/g, "")}`, {
      headers: {
        Authorization: `Bearer ${key}`,
        "Notion-Version": "2022-06-28",
      },
      signal: AbortSignal.timeout(10000),
    });
    const ok = res.ok;
    let message = ok ? "Connessione riuscita: database trovato." : `Errore Notion ${res.status}`;
    if (!ok) {
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) message += `: ${body.message}`;
      } catch {}
      if (res.status === 401) message = "Chiave non valida (401): controlla il secret dell'integrazione.";
      if (res.status === 404)
        message =
          "Database non trovato (404): controlla l'id e ricorda di CONDIVIDERE il database con l'integrazione in Notion (••• → Connections).";
    }
    if (pool) {
      await pool.query("update notion_settings set last_test_at = now(), last_test_ok = $1 where id = 1", [ok]);
    }
    return { ok, message };
  } catch (e) {
    return { ok: false, message: `Rete non raggiungibile: ${e instanceof Error ? e.message : "errore"}` };
  }
}

/** Proprietà attese sul database Notion (creale con questi nomi esatti). */
export const NOTION_LEAD_PROPERTIES = {
  Nome: "title",
  Telefono: "rich_text",
  Servizio: "select",
  Urgenza: "select",
  Budget: "select",
  Stato: "select",
  Sorgente: "select",
  "Ricerca iniziale": "rich_text",
  "Pagina origine": "url",
  Note: "rich_text",
  Creato: "date",
} as const;

/** Push generico di proprietà già costruite dal motore di mapping (coda). */
export async function createNotionPage(properties: Record<string, unknown>): Promise<{
  ok: boolean;
  pageId?: string;
  message: string;
  status?: number;
  retryAfterS?: string | null;
}> {
  const key = await getApiKey();
  const settings = await getNotionSettings();
  if (!key || !settings?.databaseId) {
    return { ok: false, message: "Notion non configurato: attiva la chiave e il database prima di sincronizzare." };
  }
  try {
    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        parent: { database_id: settings.databaseId.replace(/-/g, "") },
        properties,
      }),
    });
    if (!res.ok) {
      let msg = `Errore Notion ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) msg += `: ${body.message}`;
      } catch {}
      if (res.status === 401) msg = "Chiave non valida (401): controlla il secret dell'integrazione.";
      if (res.status === 404)
        msg =
          "Database non trovato (404): condividi il database con l'integrazione in Notion (••• → Connections).";
      return { ok: false, message: msg, status: res.status, retryAfterS: res.headers.get("retry-after") };
    }
    const page = (await res.json()) as { id: string };
    return { ok: true, pageId: page.id, message: "Pagina creata su Notion." };
  } catch (e) {
    return { ok: false, message: `Rete non raggiungibile: ${e instanceof Error ? e.message : "errore"}` };
  }
}

/** Push di un lead come pagina del database. Ritorna l'id pagina Notion. */
export async function pushLeadToNotion(lead: {
  id: string;
  name: string;
  phone: string;
  service: string | null;
  urgency: string | null;
  budget: string | null;
  status: string;
  source: string | null;
  initial_query: string | null;
  source_page: string | null;
  notes: string | null;
  created_at: string;
}): Promise<{ ok: boolean; pageId?: string; message: string }> {
  const key = await getApiKey();
  const settings = await getNotionSettings();
  if (!key || !settings?.databaseId) {
    return { ok: false, message: "Notion non configurato: la sincronizzazione riprenderà quando attiverai la chiave." };
  }
  const text = (v: string | null) => ({ rich_text: v ? [{ text: { content: v.slice(0, 1900) } }] : [] });
  try {
    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        parent: { database_id: settings.databaseId.replace(/-/g, "") },
        properties: {
          Nome: { title: [{ text: { content: `${lead.name} · ${lead.phone}` } }] },
          Telefono: text(lead.phone),
          Servizio: { select: lead.service ? { name: lead.service } : undefined },
          Urgenza: { select: lead.urgency ? { name: lead.urgency } : undefined },
          Budget: { select: lead.budget ? { name: lead.budget } : undefined },
          Stato: { select: { name: lead.status } },
          Sorgente: { select: { name: lead.source === "ai" ? "Ambrosio AI" : "Script chat" } },
          "Ricerca iniziale": text(lead.initial_query),
          "Pagina origine": { url: lead.source_page?.startsWith("http") ? lead.source_page : null },
          Note: text(lead.notes),
          Creato: { date: { start: new Date(lead.created_at).toISOString() } },
        },
      }),
    });
    if (!res.ok) {
      let msg = `Errore Notion ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) msg += `: ${body.message}`;
      } catch {}
      return { ok: false, message: msg };
    }
    const page = (await res.json()) as { id: string };
    return { ok: true, pageId: page.id, message: "Lead sincronizzato su Notion." };
  } catch (e) {
    return { ok: false, message: `Rete non raggiungibile: ${e instanceof Error ? e.message : "errore"}` };
  }
}
