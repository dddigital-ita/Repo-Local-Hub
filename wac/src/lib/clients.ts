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
  clientTypePure,
  clientTypeLabelPure,
  dittaSuggeritaPure,
} from "./clients-shared";

import { likeContains } from "./tickets-shared";

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
  /** Tipo cliente (038): azienda | privato | ente_pubblico, null = da classificare. */
  client_type: string | null;
  /** Riepilogo canali distinti: «web · email» (da array_agg del sync). */
  channels: string[] | null;
  ticket_count: number;
  open_tickets: number;
  /** Budget dichiarati nei lead dei suoi ticket: array grezzo dal DB. */
  budgets: string[] | null;
  /** Somma euristica dei budget numerici trovati (€), null se nessuno. */
  budget_total: number | null;
  /** Ditta citata nei lead ma non in scheda: proposta, mai scrittura (038/039). */
  azienda_suggerita?: string | null;
  /** Quante citazioni distinte sostengono la proposta. */
  azienda_suggerita_citazioni?: number;
  /** Ditte citate nei lead (grezzo, per il calcolo del suggerimento). */
  ditte_citate?: { company_name: string; n: number }[] | null;
  /** Ditte rigettate dall'operatore (jsonb 039, array serializzato). */
  ditte_rigettate?: string | null;
}

export interface ClientTicketRow {
  id: string;
  number: number;
  initial_query: string | null;
  source_page: string | null;
  status: string;
  priority: string;
  channel: string | null;
  created_at: string;
  updated_at: string;
  first_response_at: string | null;
  /** Archiviazione soft (spam): il banner di ripristino è della inbox, qui
   *  la riga la porta solo per compatibilità con TicketRow. */
  archived_at: string | null;
  last_sender: string | null;
  /** Telefono WhatsApp DEL ticket (lead.wa_phone), se il canale lo porta:
   *  serve al link WhatsApp contestuale della scheda cliente. */
  wa_phone: string | null;
  /** Colonne allineate a TicketRow (lib/tickets.ts) per riusare
   *  TicketQueueRow: assegnatario, contatti, conteggio messaggi, SLA e
   *  preview dell'ultimo messaggio. */
  assigned_to: string | null;
  assigned_name: string | null;
  contact_email?: string | null;
  lead_name: string | null;
  lead_phone: string | null;
  lead_source: string | null;
  message_count: string;
  last_message_body?: string | null;
  sla_next_reply_due?: string | null;
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
    where cc4.client_id = cl.id and l3.budget is not null) as budgets,
  (select json_agg(row_to_json(d)) from (
    select l5.company_name, count(*)::int as n
    from client_conversations cc5
    join conversations c6 on c6.id = cc5.conversation_id
    join leads l5 on l5.id = c6.lead_id
    where cc5.client_id = cl.id and l5.company_name is not null and l5.company_name <> ''
    group by l5.company_name
  ) d) as ditte_citate,
  (select cm.value->>'ditte_rigettate' from client_meta cm where cm.client_id = cl.id) as ditte_rigettate`;

const CLIENTS_SELECT = `select cl.id, cl.name, cl.phone_e164, cl.email_norm, cl.contact_email,
        cl.company_name, cl.notes, cl.client_type, cl.first_seen_at, cl.last_seen_at, cl.synced_at, cl.notion_synced_at,
        ${TICKETS_AGG_SQL}
     from clients cl`;

/** Lista del portafoglio: ricerca su nome/email/telefono/ditta, filtro «con ticket aperti», tipo cliente, aziende senza ditta, ultimi visti prima — o budget decrescente con sort=budget. */
export async function listClients(
  q?: string,
  limit = 200,
  openOnly = false,
  sort?: string,
  tipo?: string,
  senzaDitta = false,
): Promise<ClientRow[]> {
  const pool = db();
  if (!pool) return [];
  try {
    const params: string[] = [];
    const wheres: string[] = [];
    const term = q?.trim();
    if (term) {
      // Stessa regola della inbox: wildcard dell'utente letteralizzati
      // (likeContains in tickets-shared, un solo costruttore di pattern).
      params.push(likeContains(term));
      wheres.push(`(cl.name ilike $${params.length} or cl.email_norm ilike $${params.length} or cl.phone_e164 ilike $${params.length} or cl.company_name ilike $${params.length})`);
    }
    if (openOnly) {
      wheres.push(
        `exists (select 1 from client_conversations cco
                 join conversations c5 on c5.id = cco.conversation_id
                 where cco.client_id = cl.id and c5.status not in ('closed','on_hold','bot'))`,
      );
    }
    // Segmento di qualità «aziende senza ditta»: classificate azienda ma
    // senza ragione sociale — le schede da completare. Quando attivo è LUI
    // il filtro (tipo implicito = azienda): le due condizioni viaggiano
    // insieme o non è il segmento che dice di essere.
    if (senzaDitta) {
      wheres.push("cl.client_type = 'azienda' and cl.company_name is null");
    } else {
    // Filtro tipo: SOLO valori del contratto condiviso (clientTypePure) —
    // un ?tipo= manomesso non diventa mai una clausola SQL. «nessuno» =
    // le schede ancora da classificare (client_type is null).
    const tipoFiltro = tipo?.trim();
    if (tipoFiltro === "nessuno") {
      wheres.push("cl.client_type is null");
    } else {
      const tipoValido = clientTypePure(tipoFiltro);
      if (tipoValido) {
        params.push(tipoValido);
        wheres.push(`cl.client_type = $${params.length}`);
      }
    }
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
    // Il suggerimento ditta vive anche in LISTA (completamento rapido senza
    // aprire la scheda): stessa regola pura del dettaglio, stesso confronto
    // con i rigetti 039. Le righe senza proposta restano intatte.
    for (const c of clients) {
      const s = dittaSuggeritaPure(
        c.ditte_citate ?? null,
        c.company_name,
        c.ditte_rigettate ? JSON.parse(c.ditte_rigettate) : null,
      );
      c.azienda_suggerita = s.ditta;
      c.azienda_suggerita_citazioni = s.citazioni;
    }
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

/** KPI della lista: schede totali, con telefono, con email, aziende, per tipo + aziende senza ditta. */
export async function countClients(): Promise<{
  total: number;
  withPhone: number;
  withEmail: number;
  companies: number;
  aziendeSenzaDitta: number;
  byType: Record<string, number>;
}> {
  const pool = db();
  const empty = { total: 0, withPhone: 0, withEmail: 0, companies: 0, aziendeSenzaDitta: 0, byType: {} as Record<string, number> };
  if (!pool) return empty;
  try {
    const { rows } = await pool.query<{
      total: number;
      with_phone: number;
      with_email: number;
      companies: number;
      aziende_senza_ditta: number;
    }>(
      `select count(*)::int as total,
              count(*) filter (where phone_e164 is not null)::int as with_phone,
              count(*) filter (where email_norm is not null)::int as with_email,
              count(*) filter (where company_name is not null)::int as companies,
              count(*) filter (where client_type = 'azienda' and company_name is null)::int as aziende_senza_ditta
       from clients`,
    );
    const perTipo = await pool.query<{ client_type: string | null; n: number }>(
      `select client_type, count(*)::int as n from clients group by client_type`,
    );
    const byType: Record<string, number> = {};
    for (const r of perTipo.rows) {
      // La UI parla la lingua del dizionario condiviso: le chiavi sconosciute
      // (tipo rimosso dal codice ma in DB) restano conteggiate col valore grezzo.
      byType[r.client_type ?? "nessuno"] = r.n;
    }
    const r = rows[0];
    return r
      ? {
          total: r.total,
          withPhone: r.with_phone,
          withEmail: r.with_email,
          companies: r.companies,
          aziendeSenzaDitta: r.aziende_senza_ditta,
          byType,
        }
      : { ...empty, byType };
  } catch {
    return empty;
  }
}

/** Etichetta tipo per la UI: dal dizionario condiviso, NULL → «Da classificare». */
export function clientTypeLabel(t: string | null | undefined): string {
  return clientTypeLabelPure(t);
}

/**
 * Rigetta una ditta proposta: il «no» dell'operatore resta in client_meta
 * (039) e il suggerimento non riparte per quella ditta. Diverso dal lasciare
 * il banner lì: rigettare è una decisione, e va ricordata.
 */
export async function rejectClientDitta(id: string, ditta: string, actor: string): Promise<boolean> {
  const pool = db();
  if (!pool) return false;
  const nome = ditta.trim().slice(0, 120);
  if (!nome) return false;
  await pool.query(
    // Nota SQL: to_jsonb(ARRAY[$2]::text[]) e NON to_jsonb($2::text[]) —
    // la seconda interpreta la stringa come letterale array e esplode con
    // «malformed array literal» (beccato in E2E, non amano le sorprese).
    `insert into client_meta (client_id, value) values ($1, jsonb_build_object('ditte_rigettate', to_jsonb(ARRAY[$2]::text[])))
     on conflict (client_id) do update set
       value = jsonb_set(
         client_meta.value,
         '{ditte_rigettate}',
         (
           select coalesce(jsonb_agg(distinct d), '[]'::jsonb)
           from jsonb_array_elements_text(
             coalesce(client_meta.value->'ditte_rigettate', '[]'::jsonb)
             || to_jsonb(ARRAY[$2]::text[])
           ) as d
         ),
         true
       ),
       updated_at = now()`,
    [id, nome],
  );
  await logAudit(actor, "client.ditta-rigettata", id, nome);
  return true;
}

/** Scrive il tipo in scheda (action dedicata): solo valori del contratto, null per svuotare. */
export async function setClientType(id: string, tipo: string | null, actor: string): Promise<boolean> {
  const pool = db();
  if (!pool) return false;
  const valido = clientTypePure(tipo);
  if (tipo && !valido) return false;
  const { rowCount } = await pool.query(
    "update clients set client_type = $2, updated_at = now() where id = $1",
    [id, valido],
  );
  await logAudit(actor, "client.tipo", id, valido ?? "da classificare");
  return (rowCount ?? 0) > 0;
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
    // Il suggerimento è una PROPOSTA calcolata al volo (confronto citazioni
    // ↔ ditta salvata ↔ rigetti 039): mai una colonna che "scatta" da sola.
    const suggerimento = dittaSuggeritaPure(client.ditte_citate ?? null, client.company_name, client.ditte_rigettate ? JSON.parse(client.ditte_rigettate) : null);
    client.azienda_suggerita = suggerimento.ditta;
    client.azienda_suggerita_citazioni = suggerimento.citazioni;
    // RIGHE TICKET ALLINEATE a TicketRow (lib/tickets.ts): la scheda cliente
    // riusa TicketQueueRow, quindi serve lo stesso set di colonne della inbox
    // (SLA, contatto, conteggio messaggi, assegnatario, preview). La colonna
    // in più rispetto a TicketRow resta wa_phone: la pagina costruisce il
    // link WhatsApp contestuale per ticket.
    const tickets = await pool.query<ClientTicketRow>(
      `select c.id, c.number, c.initial_query, c.source_page, c.status, c.priority, c.channel,
              c.created_at, c.updated_at, c.first_response_at, c.archived_at,
              c.assigned_to, o.first_name as assigned_name, c.contact_email,
              l.name as lead_name, l.phone as lead_phone, l.source as lead_source, l.wa_phone,
              c.sla_next_reply_due,
              (select count(*) from messages m where m.conversation_id = c.id) as message_count,
              (select m2.sender from messages m2 where m2.conversation_id = c.id order by m2.created_at desc limit 1) as last_sender,
              (select m3.body from messages m3 where m3.conversation_id = c.id order by m3.created_at desc limit 1) as last_message_body
       from client_conversations cc
       join conversations c on c.id = cc.conversation_id
       left join leads l on l.id = c.lead_id
       left join operators o on o.id = c.assigned_to
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
