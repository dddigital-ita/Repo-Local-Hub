import { db } from "@/lib/db";
import {
  docsPromptBlock,
  levelPromptBlock,
  sanitizeDoc,
  takeoverEnabled,
  takeoverPromptBlock,
  movesCapValidated,
  type AmbrosioLevel,
  type DocLang,
  type SanitizedDoc,
} from "@/lib/ambrosio-autonomy";

/**
 * SERVER LAYER DELL'AUTONOMIA AMBROSIO — letture e scritture DB (migration
 * 028) che il cuore puro `ambrosio-autonomy.ts` non tocca. Ogni lettura
 * degredisce da sola: DB assente o tabelle non migrate → default sicuri
 * (L1, tetto 4, take-over attivo), mai un 500 della chat.
 */

export interface AmbrosioAutonomyConfig {
  level: AmbrosioLevel;
  movesCap: number;
  takeoverSla: boolean;
  takeoverDocs: string | null;
}

const DEFAULTS: AmbrosioAutonomyConfig = { level: 1, movesCap: 4, takeoverSla: true, takeoverDocs: null };

export async function getAutonomyConfig(): Promise<AmbrosioAutonomyConfig> {
  const pool = db();
  if (!pool) return DEFAULTS;
  try {
    const { rows } = await pool.query<{
      autonomy_level: number;
      autonomy_moves_cap: number;
      autonomy_takeover_sl: boolean;
      autonomy_takeover_docs: string | null;
    }>("select autonomy_level, autonomy_moves_cap, autonomy_takeover_sl, autonomy_takeover_docs from ai_settings where id = 1");
    const r = rows[0];
    if (!r) return DEFAULTS;
    const level = ([1, 2, 3] as AmbrosioLevel[]).includes(r.autonomy_level as AmbrosioLevel)
      ? (r.autonomy_level as AmbrosioLevel)
      : 1;
    return {
      level,
      movesCap: movesCapValidated(r.autonomy_moves_cap),
      takeoverSla: Boolean(r.autonomy_takeover_sl),
      takeoverDocs: r.autonomy_takeover_docs,
    };
  } catch {
    return DEFAULTS; // colonne non ancora migrate: L1 come prima della feature
  }
}

export async function saveAutonomyConfig(input: {
  level: AmbrosioLevel;
  movesCap: unknown;
  takeoverSla: boolean;
  takeoverDocs?: string | null;
}): Promise<void> {
  const pool = db();
  if (!pool) throw new Error("db_non_configurato");
  await pool.query(
    `update ai_settings set
       autonomy_level = $1, autonomy_moves_cap = $2,
       autonomy_takeover_sl = $3, autonomy_takeover_docs = nullif($4, ''),
       updated_at = now()
     where id = 1`,
    [input.level, movesCapValidated(input.movesCap), input.takeoverSla, input.takeoverDocs?.trim() || ""],
  );
}

/* ── Mosse L2: quante risposte ha già dato Ambrosio in questa chat ── */

export async function botAnswerCount(conversationId: string): Promise<number> {
  const pool = db();
  if (!pool) return 0;
  try {
    const { rows } = await pool.query<{ n: string }>(
      "select count(*) as n from messages where conversation_id = $1 and sender = 'bot'",
      [conversationId],
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

/* ── Blocchi prompt del livello (usati da ambrosioReply) ──────────── */

export async function autonomyPromptParts(): Promise<{ levelBlock: string; takeoverBlock: string; config: AmbrosioAutonomyConfig }> {
  const config = await getAutonomyConfig();
  const levelBlock = levelPromptBlock(config.level, config.movesCap);
  const takeoverBlock = takeoverEnabled(config.level, config.takeoverSla) ? takeoverPromptBlock() : "";
  return { levelBlock, takeoverBlock, config };
}

/* ── Documenti (istruzione di Ambrosio) ───────────────────────────── */

export interface AiDocumentRow extends SanitizedDoc {
  id: string;
  created_at: string;
  updated_at: string;
}

export async function listDocuments(onlyActive = false): Promise<AiDocumentRow[]> {
  const pool = db();
  if (!pool) return [];
  try {
    const { rows } = await pool.query<AiDocumentRow>(
      `select id, title, body, category, lang, priority, active, created_at, updated_at
       from ai_documents ${onlyActive ? "where active" : ""}
       order by priority asc, created_at desc`,
    );
    return rows;
  } catch {
    return []; // tabella non ancora migrata: la chat funziona senza documenti
  }
}

/** Blocco documenti per il prompt: solo attivi, tetto 10, nella lingua del cliente (fallback it). */
export async function documentsPromptBlock(level: AmbrosioLevel, lang: string): Promise<string> {
  const all = await listDocuments(true);
  const scoped = all.filter((d) => d.lang === lang || d.lang === "it").slice(0, 10);
  return docsPromptBlock(
    scoped.map((d) => ({ title: d.title, body: d.body, lang: d.lang as DocLang, category: d.category })),
    level,
  );
}

export async function saveDocument(input: {
  id?: string;
  title: unknown;
  body: unknown;
  category: unknown;
  lang: unknown;
  priority: unknown;
  active: unknown;
}): Promise<void> {
  const pool = db();
  if (!pool) throw new Error("db_non_configurato");
  const s = sanitizeDoc(input);
  if (!s) throw new Error("campi_vuoti");
  if (input.id) {
    await pool.query(
      `update ai_documents set title = $1, body = $2, category = $3, lang = $4, priority = $5, active = $6, updated_at = now()
       where id = $7`,
      [s.title, s.body, s.category, s.lang, s.priority, s.active, input.id],
    );
  } else {
    await pool.query(
      `insert into ai_documents (title, body, category, lang, priority, active) values ($1, $2, $3, $4, $5, $6)`,
      [s.title, s.body, s.category, s.lang, s.priority, s.active],
    );
  }
}

export async function deleteDocument(id: string): Promise<void> {
  const pool = db();
  if (!pool) throw new Error("db_non_configurato");
  await pool.query("delete from ai_documents where id = $1", [id]);
}

/* ── Proposte/preventivi (L3) ─────────────────────────────────────── */

export interface AiProposalRow {
  id: string;
  conversation_id: string | null;
  title: string;
  body: string;
  items: { label: string; price: string }[];
  status: string;
  extras: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  /** Contesto per la lista (già unito lato SQL). */
  ticket_number: number | null;
  lead_name: string | null;
}

export async function listProposals(limit = 50): Promise<AiProposalRow[]> {
  const pool = db();
  if (!pool) return [];
  try {
    const { rows } = await pool.query<AiProposalRow & { items: unknown; extras: unknown }>(
      `select p.id, p.conversation_id, p.title, p.body, p.items, p.status, p.extras,
              p.created_at, p.updated_at,
              c.number as ticket_number,
              (select l.name from leads l where l.id = c.lead_id) as lead_name
       from ai_proposals p
       left join conversations c on c.id = p.conversation_id
       order by p.created_at desc
       limit $1`,
      [String(Math.max(1, Math.min(200, Math.round(limit))))],
    );
    return rows.map((r) => ({
      ...r,
      items: Array.isArray(r.items) ? (r.items as { label: string; price: string }[]) : [],
      extras: r.extras && typeof r.extras === "object" ? (r.extras as Record<string, unknown>) : {},
    }));
  } catch {
    return [];
  }
}

/** True se esiste già una bozza per questa conversazione (dedup rete di sicurezza). */
export async function hasProposalForConversation(conversationId: string): Promise<boolean> {
  const pool = db();
  if (!pool) return false;
  try {
    const { rows } = await pool.query<{ n: string }>(
      "select count(*) as n from ai_proposals where conversation_id = $1",
      [conversationId],
    );
    return Number(rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function insertProposal(input: {
  conversationId: string | null;
  title: string;
  body: string;
  items: { label: string; price: string }[];
  extras?: Record<string, unknown>;
}): Promise<string | null> {
  const pool = db();
  if (!pool) return null;
  try {
    const { rows } = await pool.query<{ id: string }>(
      `insert into ai_proposals (conversation_id, title, body, items, extras)
       values ($1, $2, $3, $4::jsonb, $5::jsonb) returning id`,
      [
        input.conversationId,
        input.title,
        input.body,
        JSON.stringify(input.items ?? []),
        JSON.stringify(input.extras ?? {}),
      ],
    );
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

export async function setProposalStatus(id: string, status: string): Promise<void> {
  const pool = db();
  if (!pool) throw new Error("db_non_configurato");
  const allowed = ["draft", "approved", "sent", "won", "lost"];
  if (!allowed.includes(status)) throw new Error("stato_non_ammesso");
  await pool.query("update ai_proposals set status = $1, updated_at = now() where id = $2", [status, id]);
}
