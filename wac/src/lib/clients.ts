/**
 * PORTAFOGLIO CLIENTI — la sezione «Clienti» è gestita da Ambrosio:
 * in automatico recupera i dati del cliente dai ticket e costruisce
 * l'elenco con le azioni collegate (telefono, WhatsApp, email, ticket).
 *
 * Come funziona:
 *  - il sync scandisce i ticket (canale web/email/whatsapp) NON ancora
 *    processati (roster client_conversations) e ricava l'identità dalla
 *    stessa fonte del ticketing: lead per chat/WhatsApp, contact_email
 *    per email, email citate nei messaggi come rete di sicurezza;
 *  - identità normalizzata = chiave di dedup: telefono E.164
 *    (messaging.toE164, la stessa normalizzazione web+WhatsApp) o email
 *    minuscola. Lo stesso numero/email su canali diversi è UN cliente
 *    con tutti i suoi ticket collegati;
 *  - senza migration (025) tutto degrada a zero righe: nessun errore.
 *
 * Regole del progetto rispettate: mai bloccante (il cron non fallisce),
 * audit su ogni sync (actor "ambrosio@ai" quando è Ambrosio a farla),
 * nessuna cancellazione (le schede restano anche se i ticket spariscono).
 */
import { db } from "./db";
import { logAudit } from "./audit";
import { AI_ACTOR } from "./ai-tools";
import {
  normEmailPure as normEmail,
  identityPhonePure,
  resolveClientNamePure,
  withBudgetTotal,
  byBudgetDesc,
} from "./clients-shared";

export const CLIENTS_SYNC_KEY = "clients_sync_enabled";

/** Dizionario dei canali per etichette e icone coerenti col resto dell'admin. */
export const CLIENT_CHANNEL_LABELS: Record<string, string> = {
  web: "Chat web",
  email: "Email",
  whatsapp: "WhatsApp",
};

export interface ClientRow {
  id: string;
  name: string;
  phone_e164: string | null;
  email_norm: string | null;
  company_name: string | null;
  contact_email: string | null;
  notes: string | null;
  first_seen_at: string;
  last_seen_at: string;
  synced_at: string | null;
  /** Marcatura anti-doppioni Notion (027, come leads.notion_synced_at). */
  notion_synced_at: string | null;
  /** Riepilogo canali distinti: «web · email» (da array_agg del sync). */
  channels: string[] | null;
  ticket_count: number;
  open_tickets: number;
  /** Budget dichiarati nei lead dei suoi ticket: array grezzo dal DB. */
  budgets: string[] | null;
  /** Somma euristica dei budget numerici trovati (€), null se nessuno. */
  budget_total: number | null;
}

export interface ClientTicketRow {
  id: string;
  number: number;
  status: string;
  priority: string;
  channel: string | null;
  initial_query: string | null;
  created_at: string;
  updated_at: string;
  last_sender: string | null;
  /** Telefono WhatsApp DEL ticket (lead.wa_phone), se il canale lo porta:
   *  serve al link WhatsApp contestuale della scheda cliente. */
  wa_phone: string | null;
}

export interface ClientDetail extends ClientRow {
  tickets: ClientTicketRow[];
  /** Ultimi messaggi (per capire il contesto senza aprire ogni ticket). */
  messages: { conversation_id: string; body: string; sender: string; created_at: string }[];
}

/* ── Sync automatica (Ambrosio) ──────────────────────────────────── */

interface TicketIdentity {
  conversationId: string;
  channel: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  companyName: string | null;
  lastAt: string | null;
}

/**
 * Identità del cliente di un ticket, DAI DATI GIÀ ESISTENTI:
 *  - lead (chat web/whatsapp): nome, telefono, ditta, email se citata;
 *  - contact_email (email): l'indirizzo del mittente; nome dall'header
 *    «Nome <mail@…>» salvato in email_ingest, altrimenti la parte locale;
 *  - email citate nei messaggi: rete di sicurezza per i ticket senza lead.
 * Il telefono normalizzato ha la priorità come chiave (identità più
 * stabile dell'email), poi l'email.
 */
async function ticketIdentity(
  pool: NonNullable<ReturnType<typeof db>>,
  conversationId: string,
): Promise<TicketIdentity | null> {
  const { rows } = await pool.query<{
    channel: string | null;
    contact_email: string | null;
    lead_name: string | null;
    lead_phone: string | null;
    lead_company: string | null;
    wa_phone: string | null;
    cited_email: string | null;
    last_at: string | null;
  }>(
    `select c.channel, c.contact_email,
            l.name as lead_name, l.phone as lead_phone, l.company_name as lead_company, l.wa_phone,
            (select m.body from messages m
              where m.conversation_id = c.id and m.body ilike '%@%' and m.body ilike '%.%'
              order by m.created_at desc limit 1) as cited_email,
            greatest(c.updated_at, coalesce((select max(m.created_at) from messages m where m.conversation_id = c.id), c.updated_at)) as last_at
     from conversations c
     left join leads l on l.id = c.lead_id
     where c.id = $1`,
    [conversationId],
  );
  const r = rows[0];
  if (!r) return null;

  // Email: contact_email (canale email e ticket manuali) > email citata
  // nel testo dei messaggi (prima occorrenza plausibile, validata).
  let email = normEmail(r.contact_email);
  if (!email && r.cited_email) {
    const m = r.cited_email.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    email = normEmail(m?.[0]);
  }
  // Nome: lead > header della prima email (email_ingest.from_name) > locale
  // dell'indirizzo — la priorità vive in clients-shared (testata).
  let name: string | null = null;
  if (email) {
    const hdr = await pool.query<{ from_name: string | null; from_address: string }>(
      `select from_name, from_address from email_ingest
       where lower(from_address) = $1 and from_name is not null
       order by received_at desc nulls last limit 1`,
      [email],
    );
    name = resolveClientNamePure(r.lead_name, hdr.rows[0]?.from_name, email);
  } else {
    name = resolveClientNamePure(r.lead_name, null, null);
  }

  const phone = identityPhonePure(r.wa_phone, r.lead_phone);
  return {
    conversationId,
    channel: r.channel,
    name,
    phone,
    email,
    companyName: r.lead_company?.trim().slice(0, 120) || null,
    lastAt: r.last_at,
  };
}

/**
 * Su un'identità: trova il cliente esistente (telefono > email) o ne crea
 * uno nuovo, aggiornando i campi mancanti (l'ultima informazione vista
 * completa la scheda: un canale sa il nome, l'altro l'email, ecc.).
 */
async function upsertClient(
  pool: NonNullable<ReturnType<typeof db>>,
  id: TicketIdentity,
): Promise<string | null> {
  const lastAt = id.lastAt ? new Date(id.lastAt) : new Date();
  let clientId: string | null = null;

  if (id.phone) {
    const hit = await pool.query<{ id: string }>("select id from clients where phone_e164 = $1", [id.phone]);
    clientId = hit.rows[0]?.id ?? null;
  }
  if (!clientId && id.email) {
    const hit = await pool.query<{ id: string }>("select id from clients where email_norm = $1", [id.email]);
    clientId = hit.rows[0]?.id ?? null;
  }

  if (clientId) {
    // Update «completa ma non distrugge»: un campo nuovo riempie un buco,
    // un campo assente in questo ticket non cancella ciò che si sapeva.
    await pool.query(
      `update clients set
         name = coalesce(clients.name, $2),
         email_norm = coalesce(clients.email_norm, $3),
         contact_email = coalesce(clients.contact_email, $4),
         company_name = coalesce(clients.company_name, $5),
         last_seen_at = greatest(clients.last_seen_at, $6),
         synced_at = now(),
         updated_at = now()
       where id = $1`,
      [clientId, id.name, id.email, id.email, id.companyName, lastAt],
    );
    return clientId;
  }

  // Nuovo cliente: serve almeno un'identità davvero riconoscibile.
  if (!id.phone && !id.email) return null;
  const ins = await pool.query<{ id: string }>(
    `insert into clients (name, phone_e164, email_norm, contact_email, company_name, last_seen_at, synced_at, notion_synced_at)
     values ($1, $2, $3, $4, $5, $6, now(), null) returning id`,
    [id.name ?? "(cliente senza nome)", id.phone, id.email, id.email, id.companyName, lastAt],
  );
  return ins.rows[0].id;
}

/**
 * Un turno di sync: processa i ticket mai visti dal roster, in batch.
 * Ritorna il conteggio. Idempotente: il claim (INSERT con ON CONFLICT
 * DO NOTHING) è il lock — due tick paralleli non processano lo stesso
 * ticket due volte. Un fallimento di identità marca comunque il ticket
 * come visto: non ritenta all'infinito (l'agente può ricorrere col sync
 * manuale dopo aver completato i dati del lead).
 */
export async function syncClients(actor: string = AI_ACTOR, limit = 200): Promise<number> {
  const pool = db();
  if (!pool) return 0;
  try {
    const { rows: pending } = await pool.query<{ id: string }>(
      `select c.id from conversations c
       left join client_conversations cc on cc.conversation_id = c.id
       where cc.conversation_id is null
         and c.archived_at is null
       order by c.updated_at desc
       limit $1`,
      [String(Math.max(1, Math.min(500, Math.round(limit))))],
    );
    let processed = 0;
    for (const t of pending) {
      // Claim prima del lavoro: anche se il processo morisse a metà, il
      // ticket non viene processato due volte (convenzione dedup del cron).
      const claim = await pool.query<{ conversation_id: string }>(
        `insert into client_conversations (conversation_id) values ($1)
         on conflict (conversation_id) do nothing returning conversation_id`,
        [t.id],
      );
      if (!claim.rows[0]) continue; // un altro tick l'ha preso

      const identity = await ticketIdentity(pool, t.id);
      if (identity && (identity.phone || identity.email || identity.name)) {
        const clientId = await upsertClient(pool, identity);
        if (clientId) {
          await pool
            .query(
              `update client_conversations set client_id = $2 where conversation_id = $1`,
              [t.id, clientId],
            )
            .catch(() => {});
          processed++;
        }
      }
    }
    if (processed > 0) {
      await logAudit(actor, "client.sync", null, `${processed} ticket riconciliati col portafoglio`);
    }
    return processed;
  } catch (e) {
    console.error("[clients] sync:", e instanceof Error ? e.message : e);
    return 0;
  }
}

/** Sync attiva? (content_settings, default ON — è la promessa «automatica»). */
export async function isClientsSyncEnabled(): Promise<boolean> {
  const pool = db();
  if (!pool) return true;
  try {
    const { rows } = await pool.query<{ value: { enabled?: unknown } | null }>(
      "select value from content_settings where key = $1",
      [CLIENTS_SYNC_KEY],
    );
    return rows[0]?.value ? rows[0].value.enabled !== false : true;
  } catch {
    return true;
  }
}

/* ── Letture per la UI ───────────────────────────────────────────── */

/** Conteggio canali distinti per il KPI della lista (una sola query). */
const TICKETS_AGG_SQL = `
  (select count(*)::int from client_conversations cc
    where cc.client_id = cl.id) as ticket_count,
  (select count(*)::int from client_conversations cc
    join conversations c2 on c2.id = cc.conversation_id
    where cc.client_id = cl.id and c2.status not in ('closed', 'on_hold', 'bot')) as open_tickets,
  (select array_agg(distinct c3.channel) from client_conversations cc3
    join conversations c3 on c3.id = cc3.conversation_id
    where cc3.client_id = cl.id) as channels,
  (select array_agg(distinct l3.budget) from client_conversations cc4
    join conversations c4 on c4.id = cc4.conversation_id
    join leads l3 on l3.id = c4.lead_id
    where cc4.client_id = cl.id and l3.budget is not null) as budgets`;

const CLIENTS_SELECT = `select cl.id, cl.name, cl.phone_e164, cl.email_norm, cl.contact_email,
        cl.company_name, cl.notes, cl.first_seen_at, cl.last_seen_at, cl.synced_at, cl.notion_synced_at,
        ${TICKETS_AGG_SQL}
     from clients cl`;

/** Lista del portafoglio: ricerca su nome/email/telefono/ditta, filtro «con ticket aperti», ultimi visti prima — o budget decrescente con sort=budget. */
export async function listClients(
  q?: string,
  limit = 200,
  openOnly = false,
  sort?: string,
): Promise<ClientRow[]> {
  const pool = db();
  if (!pool) return [];
  try {
    const params: string[] = [];
    const wheres: string[] = [];
    const term = q?.trim();
    if (term) {
      params.push(`%${term}%`);
      wheres.push(`(cl.name ilike $${params.length} or cl.email_norm ilike $${params.length} or cl.phone_e164 ilike $${params.length} or cl.company_name ilike $${params.length})`);
    }
    if (openOnly) {
      wheres.push(
        `exists (select 1 from client_conversations cco
                 join conversations c5 on c5.id = cco.conversation_id
                 where cco.client_id = cl.id and c5.status not in ('closed','on_hold','bot'))`,
      );
    }
    params.push(String(limit));
    const where = wheres.length ? ` where ${wheres.join(" and ")}` : "";
    const { rows } = await pool.query<ClientRow>(
      `${CLIENTS_SELECT}${where}
       order by cl.last_seen_at desc
       limit $${params.length}`,
      params,
    );
    const clients = rows.map(withBudgetTotal);
    // «Budget: più alto prima»: ordinamento lato dato sul valore derivato —
    // la regola vive nel layer condiviso testato, non nella pagina.
    return sort === "budget" ? clients.sort(byBudgetDesc) : clients;
  } catch (e) {
    // Tabella non ancora migrata: portafoglio vuoto, pagina viva.
    console.error("[clients] list:", e instanceof Error ? e.message : e);
    return [];
  }
}

// withBudgetTotal vive in clients-shared (puro, testato):
// importato in cima, esportato di nuovo qui per compatibilità con gli
// usi esistenti della pagina.
export { withBudgetTotal } from "./clients-shared";

/** KPI della lista: schede totali, con telefono, con email, aziende. */
export async function countClients(): Promise<{ total: number; withPhone: number; withEmail: number; companies: number }> {
  const pool = db();
  const empty = { total: 0, withPhone: 0, withEmail: 0, companies: 0 };
  if (!pool) return empty;
  try {
    const { rows } = await pool.query<{
      total: number;
      with_phone: number;
      with_email: number;
      companies: number;
    }>(
      `select count(*)::int as total,
              count(*) filter (where phone_e164 is not null)::int as with_phone,
              count(*) filter (where email_norm is not null)::int as with_email,
              count(*) filter (where company_name is not null)::int as companies
       from clients`,
    );
    const r = rows[0];
    return r
      ? { total: r.total, withPhone: r.with_phone, withEmail: r.with_email, companies: r.companies }
      : empty;
  } catch {
    return empty;
  }
}

/**
 * Valore commerciale del portafoglio: la somma dei budget dichiarati
 * («~N € dichiarati» di ogni scheda, stessa estrazione testata). La
 * congiunzione aggrega i budget testuali per cliente — l'estrazione e
 * la somma restano nel layer condiviso, qui solo il recupero.
 */
export async function sumPortfolioBudget(): Promise<number | null> {
  const pool = db();
  if (!pool) return null;
  try {
    const { rows } = await pool.query<{
      id: string;
      budgets: string[] | null;
    }>(
      `select cl.id,
              (select array_agg(distinct l3.budget) from client_conversations cc4
                join conversations c4 on c4.id = cc4.conversation_id
                join leads l3 on l3.id = c4.lead_id
                where cc4.client_id = cl.id and l3.budget is not null) as budgets
       from clients cl`,
    );
    const totals = rows.map((r) =>
      withBudgetTotal({ id: r.id, budgets: r.budgets, budget_total: null }).budget_total ?? 0,
    );
    return totals.reduce((a, b) => a + b, 0);
  } catch {
    return null;
  }
}

/** Dettaglio: scheda + ticket collegati (in tutti i canali) + ultimi messaggi. */
export async function getClient(id: string): Promise<ClientDetail | null> {
  const pool = db();
  if (!pool) return null;
  try {
    const { rows } = await pool.query<ClientRow>(`${CLIENTS_SELECT} where cl.id = $1`, [id]);
    const client = rows[0];
    if (!client) return null;
    const tickets = await pool.query<ClientTicketRow>(
      `select c.id, c.number, c.status, c.priority, c.channel, c.initial_query, c.created_at, c.updated_at,
              l.wa_phone,
              (select m2.sender from messages m2 where m2.conversation_id = c.id order by m2.created_at desc limit 1) as last_sender
       from client_conversations cc
       join conversations c on c.id = cc.conversation_id
       left join leads l on l.id = c.lead_id
       where cc.client_id = $1
       order by c.updated_at desc
       limit 50`,
      [id],
    );
    const messages = await pool.query<{
      conversation_id: string;
      body: string;
      sender: string;
      created_at: string;
    }>(
      `select m.conversation_id, m.body, m.sender, m.created_at
       from messages m
       join client_conversations cc on cc.conversation_id = m.conversation_id
       where cc.client_id = $1
       order by m.created_at desc
       limit 6`,
      [id],
    );
    return { ...withBudgetTotal(client), tickets: tickets.rows, messages: messages.rows };
  } catch (e) {
    console.error("[clients] detail:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Etichetta canale (fallback neutro per canali futuri). */
export function channelLabel(ch: string | null): string {
  return CLIENT_CHANNEL_LABELS[ch ?? "web"] ?? (ch ?? "web");
}
