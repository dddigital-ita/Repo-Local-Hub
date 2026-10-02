import { cache } from "react";
import { db } from "./db";
import { TAKEOVER_MANUALE_SQL } from "./takeover-shared";
import {
  likeContains,
  mergeChannelCounts,
  sanitizeTags,
  TICKET_TAG_VOCAB_MAX,
} from "./tickets-shared";

/**
 * Ticketing: le conversazioni qualificate diventano ticket con numero,
 * priorità, assegnatario e SLA di prima risposta. Due agenti (Daniele "A",
 * Michele "B"): ognuno può lavorare i propri ticket E quelli del collega
 * (collaborazione piena, tracciata in audit).
 */

export type TicketStatus =
  | "bot"
  | "lead_captured"
  | "operator"
  | "waiting_customer"
  | "on_hold"
  | "callback_scheduled"
  | "closed";
export type TicketPriority = "bassa" | "normale" | "alta" | "urgente";

export const TICKET_PRIORITIES: TicketPriority[] = ["bassa", "normale", "alta", "urgente"];

/** Canali noti della inbox (il GROUP BY del DB può portarne altri: restano generici). */
export const KNOWN_TICKET_CHANNELS = ["web", "email", "whatsapp"] as const;

/** Etichette italiane dei canali: la dashboard non può mostrare chiavi SQL crude. */
export const CHANNEL_LABEL_IT: Record<string, string> = {
  web: "Chat web",
  email: "Email",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  instagram: "Instagram",
  messenger: "Messenger",
  facebook: "Facebook",
  linkedin: "LinkedIn",
};

export const TICKET_STATUSES: TicketStatus[] = [
  "bot",
  "lead_captured",
  "operator",
  "waiting_customer",
  "on_hold",
  "callback_scheduled",
  "closed",
];

export const STATUS_LABEL: Record<string, string> = {
  bot: "Bot",
  lead_captured: "Nuovo lead",
  operator: "In conversazione",
  waiting_customer: "In attesa cliente",
  on_hold: "In sospeso",
  callback_scheduled: "Callback fissata",
  closed: "Chiuso",
};

/** Pillcole stato: vetro colorato, stile iOS. Il «tutto ok» resta NEUTRO:
   il colore è riservato a ciò che richiede azione (Zendesk: verde solo per
   successi espliciti, non per la normalità). */
export const STATUS_TONE: Record<string, string> = {
  bot: "bg-slate-100/80 text-slate-600 ring-1 ring-slate-200/70",
  lead_captured: "bg-emerald-50/90 text-emerald-700 ring-1 ring-emerald-200/70",
  operator: "bg-brand-50/90 text-brand-700 ring-1 ring-brand-200/70",
  waiting_customer: "bg-sky-50/90 text-sky-700 ring-1 ring-sky-200/70",
  on_hold: "bg-zinc-100/90 text-zinc-600 ring-1 ring-zinc-200/70",
  callback_scheduled: "bg-violet-50/90 text-violet-700 ring-1 ring-violet-200/70",
  closed: "bg-slate-100/60 text-slate-400 ring-1 ring-slate-200/50",
};

export const PRIORITY_LABEL: Record<string, string> = {
  bassa: "Bassa",
  normale: "Normale",
  alta: "Alta",
  urgente: "Urgente",
};

export const PRIORITY_TONE: Record<string, string> = {
  bassa: "bg-slate-100/70 text-slate-500 ring-1 ring-slate-200/60",
  normale: "bg-sky-50/90 text-sky-700 ring-1 ring-sky-200/70",
  alta: "bg-amber-50/90 text-amber-700 ring-1 ring-amber-200/70",
  urgente: "bg-red-50/90 text-red-700 ring-1 ring-red-200/70",
};

/**
 * Tonalità di escalation e chip dei tag (migration 046):
 * definite in tickets-shared.ts perché consumate da componenti
 * CLIENT (pannello escalation, tag editor) — tickets.ts importa
 * il DB e non può entrare nel bundle browser. Re-esportate qui
 * per i consumatori server, come il resto delle regole pure.
 */
export { ESCALATION_TONE, TAG_TONE } from "./tickets-shared";

export const FILTERS = [
  { key: "aperti", label: "Aperti" },
  { key: "da_rispondere", label: "Da rispondere" },
  { key: "miei", label: "Miei" },
  { key: "collega", label: "Di colleghi" },
  { key: "tutti", label: "Tutti" },
] as const;

/** Azioni di stato disponibili nel dettaglio (la select: nessuno stato è un vicolo cieco). */
export const STATUS_ACTIONS: { value: TicketStatus; label: string }[] = [
  { value: "bot", label: "Riapri col bot" },
  { value: "lead_captured", label: "Nuovo lead" },
  { value: "operator", label: "In conversazione" },
  { value: "waiting_customer", label: "In attesa cliente" },
  { value: "on_hold", label: "In sospeso" },
  { value: "callback_scheduled", label: "Callback fissata" },
  { value: "closed", label: "Chiuso" },
];

/**
 * Stati «in gioco»: il ticket richiede attenzione (muove le code, il filtro
 * «Da rispondere» e i contatori). Esclusi: chiuso, in sospeso (pausa voluta)
 * e bot (prima che il visitatore scriva davvero).
 */
export function isActiveStatus(status: string): boolean {
  return status !== "closed" && status !== "on_hold" && status !== "bot";
}

export type TicketFilter = (typeof FILTERS)[number]["key"];

/** Query spam: sotto 2 caratteri non c'è ricerca vera ("t", "x", "a"…). */
export function isSpamQuery(initialQuery: string | null): boolean {
  return (initialQuery ?? "").trim().length < 2;
}

/** Subquery «sender dell'ultimo messaggio»: riusata da filtri, conteggi e ordinamento. */
export const LAST_SENDER_SQL =
  "(select m2.sender from messages m2 where m2.conversation_id = c.id order by m2.created_at desc limit 1)";

/** Condizione per il filtro «Da rispondere»: aperto e l'ultima parola è del cliente. */
const AWAITING_SQL = `c.archived_at is null and c.status <> 'closed' and c.status <> 'on_hold' and ${LAST_SENDER_SQL} = 'visitor'`;

/**
 * Condizione SQL per il filtro della inbox.
 * - aperti: non chiusi
 * - da_rispondere: l'ultima parola è del cliente (il caso «devi agire»)
 * - miei: assegnati a me (se non ho identità operatore: non assegnati, da prendere)
 * - collega: assegnati all'altro agente (collaborazione: li vedo e posso rispondere)
 */
export function ticketFilterSql(filter: string, operatorId: string | null): { sql: string; params: string[] } {
  // Tutti i filtri della inbox nascondono gli archiviati: il ripristino è
  // sull'apposito banner, non misto alla lista.
  const notArchived = "c.archived_at is null";
  switch (filter) {
    case "da_rispondere":
      return { sql: AWAITING_SQL, params: [] };
    case "miei":
      return operatorId
        ? { sql: `${notArchived} and c.assigned_to = $1`, params: [operatorId] }
        : { sql: `${notArchived} and c.assigned_to is null`, params: [] };
    case "collega":
      return operatorId
        ? { sql: `${notArchived} and c.assigned_to is not null and c.assigned_to <> $1`, params: [operatorId] }
        : { sql: `${notArchived} and c.assigned_to is not null`, params: [] };
    case "tutti":
      return { sql: notArchived, params: [] };
    case "aperti":
    default:
      return { sql: `${notArchived} and c.status <> 'closed'`, params: [] };
  }
}

/**
 * True quando il ticket è già stato preso in mano da un essere umano (risposta,
 * attesa cliente, sospeso, callback fissata o chiuso): il bot non deve più
 * intervenire. Il gate concreto resta in api/chat/ai (vedi commento lì).
 */
export function isHumanHandled(status: string): boolean {
  return status !== "bot" && status !== "lead_captured";
}

/** SLA prima risposta (ticket senza risposta umana): 2h di target, 4h di ritardo. */
export const SLA_TARGET_H = 2;
export const SLA_LATE_H = 4;

/** Soglie di warning sul clock attivo (75%/90% della finestra). */
export const SLA_WARN_PCT = 0.75;
export const SLA_LATE_PCT = 0.9;

/**
 * Policy SLA per priorità: [prossima risposta, risoluzione] in ore.
 * Il primo valore si applica a partire dalla PRIMA risposta umana
 * (il clock «prima risposta» resta il 2h/4h storico per il primo contatto).
 */
export const SLA_POLICY_DEFAULT: Record<TicketPriority, { nextReplyH: number; resolveH: number }> = {
  urgente: { nextReplyH: 1, resolveH: 4 },
  alta: { nextReplyH: 2, resolveH: 8 },
  normale: { nextReplyH: 4, resolveH: 24 },
  bassa: { nextReplyH: 8, resolveH: 48 },
};

export const SLA_POLICY_KEY = "ticket_sla_policy";

/** Policy corrente dal DB (content_settings), con fallback ai default. */
export async function getSlaPolicy(): Promise<Record<TicketPriority, { nextReplyH: number; resolveH: number }>> {
  const raw = (await snapshotPerRichiesta())[SLA_POLICY_KEY];
  if (!raw || typeof raw !== "object") return SLA_POLICY_DEFAULT;
  const merged = { ...SLA_POLICY_DEFAULT } as Record<TicketPriority, { nextReplyH: number; resolveH: number }>;
  for (const p of TICKET_PRIORITIES) {
    const v = raw as Record<string, { nextReplyH?: unknown; resolveH?: unknown }>;
    const nr = Number(v[p]?.nextReplyH);
    const rs = Number(v[p]?.resolveH);
    if (Number.isFinite(nr) && nr > 0 && nr <= 336) merged[p].nextReplyH = nr;
    if (Number.isFinite(rs) && rs > 0 && rs <= 336) merged[p].resolveH = rs;
  }
  return merged;
}

/**
 * Scadenze a tre orologi per priorità, a partire da un riferimento temporale:
 * - nextReply: quanto ha l'AGENTE per rispondere — si arma quando scrive il
 *   cliente (il «Devi rispondere entro…» che muove la coda);
 * - resolve: entro quando il ticket va risolto, dalla creazione.
 */
export function slaDueFor(
  priority: string,
  from: Date,
): { nextReplyDue: Date | null; resolveDue: Date | null } {
  const pol = SLA_POLICY_DEFAULT[priority as TicketPriority] ?? SLA_POLICY_DEFAULT.normale;
  return {
    nextReplyDue: new Date(from.getTime() + pol.nextReplyH * 3_600_000),
    resolveDue: new Date(from.getTime() + pol.resolveH * 3_600_000),
  };
}

export interface SlaTier {
  label: string;
  tone: string;
  hours: number;
}

/**
 * Tier SLA del ticket, sull'orologio che conta in quel momento:
 * - ticket ancora AL BOT (nessun umano coinvolto): «in attesa operatore»,
 *   NEUTRO e fuori dal calcolo SLA — «Bot in ritardo» non ha referente nel
 *   mondo reale (nessun operatore ha promesso nulla) e gonfiava la coda di
 *   falsa urgenza, svalutando il segnale dei ticket veri;
 * - palla al cliente (ultimo messaggio è nostro): verde, non dobbiamo niente;
 * - mai risposto dall'umano: tier storico sull'età (primo contatto 2h/4h);
 * - palla all'agente con clock armato: entro SLA / scade presto (<25% della
 *   finesta di policy) / scaduto.
 */
export function slaTier(t: {
  created_at: string;
  first_response_at: string | null;
  status: string;
  priority: string;
  last_sender?: string | null;
  sla_next_reply_due?: string | null;
}): SlaTier {
  const ageH = (Date.now() - new Date(t.created_at).getTime()) / 3_600_000;
  if (t.status === "on_hold") {
    return { label: "in sospeso", tone: "bg-zinc-100/90 text-zinc-600 ring-1 ring-zinc-200/70", hours: ageH };
  }
  // Bot senza coinvolgimento umano: il clock SLA non è armato (nessuno ha
  // promesso una risposta). Appena un operatore prende in carico il ticket
  // cambia stato e rientra nei tier normali.
  if (t.status === "bot") {
    return { label: "in attesa operatore", tone: "bg-slate-100/80 text-slate-600 ring-1 ring-slate-200/70", hours: ageH };
  }
  const ballWithUs = t.last_sender === "visitor";
  if (!ballWithUs && (t.status === "closed" || t.first_response_at)) {
    return { label: "palla dal cliente", tone: "bg-slate-100/80 text-slate-600 ring-1 ring-slate-200/70", hours: ageH };
  }
  if (!t.first_response_at) {
    if (ageH >= SLA_LATE_H) return { label: "in ritardo", tone: "bg-red-50/90 text-red-700 ring-1 ring-red-200/70", hours: ageH };
    if (ageH >= SLA_TARGET_H) return { label: "scade presto", tone: "bg-amber-50/90 text-amber-700 ring-1 ring-amber-200/70", hours: ageH };
    return { label: "entro SLA", tone: "bg-slate-100/80 text-slate-600 ring-1 ring-slate-200/70", hours: ageH };
  }
  const due = t.sla_next_reply_due ? new Date(t.sla_next_reply_due).getTime() : null;
  if (!due) return { label: "attivo", tone: "bg-slate-100/80 text-slate-600 ring-1 ring-slate-200/70", hours: ageH };
  const msLeft = due - Date.now();
  if (msLeft <= 0) return { label: "scaduto", tone: "bg-red-50/90 text-red-700 ring-1 ring-red-200/70", hours: ageH };
  const windowMs = (SLA_POLICY_DEFAULT[t.priority as TicketPriority] ?? SLA_POLICY_DEFAULT.normale).nextReplyH * 3_600_000;
  if (msLeft < SLA_LATE_PCT * windowMs) return { label: "scade presto", tone: "bg-amber-50/90 text-amber-700 ring-1 ring-amber-200/70", hours: ageH };
  return { label: "entro SLA", tone: "bg-slate-100/80 text-slate-600 ring-1 ring-slate-200/70", hours: ageH };
}

/** True se l'agente loggato può operare sul ticket (collaborazione piena). */
export function canWorkOn(operatorId: string | null): boolean {
  // Con due agenti la collaborazione è totale: chiunque può rispondere
  // ovunque; l'assegnatario resta la "proprietà" per filtri e notifiche.
  void operatorId;
  return true;
}

export interface TicketRow {
  id: string;
  number: number;
  initial_query: string | null;
  source_page: string | null;
  status: string;
  priority: string;
  assigned_to: string | null;
  assigned_name: string | null;
  created_at: string;
  updated_at: string;
  first_response_at: string | null;
  lead_name: string | null;
  lead_phone: string | null;
  lead_source: string | null;
  message_count: string;
  /** Chiusura effettiva (KPI «risolti oggi», cron auto-close). */
  closed_at?: string | null;
  /** Impronte Ambrosio sulla conversazione (chip nella card inbox). */
  ambrosio_takeover?: boolean;
  ambrosio_followup?: boolean;
  /** L'ultimo evento audit autopilota_* è un ON manuale (chip «a mano»). */
  ambrosio_manuale?: boolean;
  /** Follow-up automatico escluso su questo ticket (badge in inbox). */
  followup_disabled?: boolean;
  /** Identità CRM dalla rete del sync portafoglio (link contestuale). */
  client_id?: string | null;
  client_name?: string | null;
  /** Mittente dell'ultimo messaggio: per il badge «attende risposta». */
  last_sender: string | null;
  /** Anteprima dell'ultimo messaggio, utile per riconoscere il ticket a colpo d'occhio. */
  last_message_body?: string | null;
  /** Archiviazione soft (spam/vuoti): visibile solo nel banner di ripristino. */
  archived_at: string | null;
  /** Clock SLA: prossima risposta attesa dall'agente (null = fermo). */
  sla_next_reply_due?: string | null;
  /** Clock SLA: entro quando va risolto. */
  sla_resolve_due?: string | null;
  /** Canale di provenienza (web, email, whatsapp…): le inbox per canale nascono da qui. */
  channel?: string | null;
  /** Email del richiedente: il canale email la usa per inviare le risposte. */
  contact_email?: string | null;
  /** WhatsApp normalizzato DEL lead (021): la fonte del bottone contestuale
   *  per ticket (pill nella scheda cliente, icona nella inbox — variante C). */
  wa_phone?: string | null;
  /** Tag applicati (migration 046): categorizzazione libera con
   *  vocabolario suggerito in impostazioni. Ordine alfabetico (array_agg). */
  tags?: string[] | null;
  /** Livello di escalation: 0 = base («Livello 1»), 1..3 = salito. */
  escalation_level?: number;
  /** Quando è salita l'ultima escalation. */
  escalation_at?: string | null;
  /** Ticket che ha assorbito questo (merge duplicati): il fuso resta
   *  leggibile per sempre, ma esce da ogni lista (merged_into is null). */
  merged_into?: string | null;
  merged_at?: string | null;
  /** Numero del ticket che ha assorbito questo: il banner «fuso»
   *  linka alla destinazione senza una seconda query. */
  merged_into_number?: number | null;
}

/**
 * True quando l'ultimo messaggio del ticket è del visitatore e il ticket è
 * aperto: è il caso «l'agente deve rispondere», il dato più cercato in inbox.
 */
export function awaitsReply(t: { status: string; last_sender: string | null }): boolean {
  return (
    t.status !== "closed" &&
    t.status !== "on_hold" &&
    t.status !== "bot" &&
    t.last_sender === "visitor"
  );
}

export interface TicketCounts {
  aperti: number;
  da_rispondere: number;
  miei: number;
  collega: number;
  tutti: number;
  /** Ticket archiviati come spam/vuoti (ripristinabili dal banner). */
  archived: number;
  /** Ticket aperti con l'ultimo messaggio del visitatore: «da rispondere». */
  awaitingReply: number;
  /** Aperti con clock SLA che scade entro 25 minuti (cron li avverte). */
  slaSoon: number;
  /** Aperti con SLA già rotto (in ritardo o scaduto). */
  slaLate: number;
  /** Chiusi dal mezzanotte (KPI «risolti oggi»). */
  risoltiOggi: number;
  /** Aperti con impronta Ambrosio (takeover o followup attivo). */
  ambrosio: number;
  /** Aperti con take-over attivato A MANO (ultimo audit = autopilota_on). */
  ambrosioManuale: number;
}

/**
 * Conta i ticket per ogni filtro: i numeri sulla segmented control danno
 * subito la scala della coda (heuristica "visibilità dello stato di sistema").
 */
export async function countTickets(operatorId: string | null): Promise<TicketCounts> {
  const pool = db();
  if (!pool)
    return { aperti: 0, da_rispondere: 0, miei: 0, collega: 0, tutti: 0, archived: 0, awaitingReply: 0, slaSoon: 0, slaLate: 0, risoltiOggi: 0, ambrosio: 0, ambrosioManuale: 0 };
  // I ticket FUSI (merge duplicati) non esistono più per il desk: ogni
  // conteggio li esclude (restano leggibili nel loro permalink).
  const base = "select count(*)::int as n from conversations c where c.merged_into is null and ";
  const keys = ["aperti", "da_rispondere", "miei", "collega", "tutti"] as const;
  const [a, dr, m, c, t, arch, soon, late, risolti, amb, ambMan] = await Promise.all([
    // I filtri «miei» e «collega» con operatore identificato aggiungono $1:
    // params va preso da ticketFilterSql (prima era sempre [] e la pagina
    // moriva con «there is no parameter $1» per qualunque utente con
    // operatorId impostato).
    ...keys.map((k) => {
      const { sql, params } = ticketFilterSql(k, operatorId);
      return pool.query<{ n: number }>(base + sql, params);
    }),
    pool.query<{ n: number }>("select count(*)::int as n from conversations c where c.archived_at is not null and c.merged_into is null", []),
    // KPI della inbox (brief §1): scadenza SLA vicina (≤25 min, la stessa
    // finestra che il cron avverte), SLA rotto, risolti da mezzanotte,
    // impronta Ambrosio (takeover o followup attivo su ticket APERTO).
    pool.query<{ n: number }>(
      `select count(*)::int as n from conversations c
       where c.archived_at is null and c.status not in ('closed','bot')
         and c.merged_into is null
         and c.sla_next_reply_due is not null
         and c.sla_next_reply_due > now()
         and c.sla_next_reply_due - now() < interval '25 minutes'`,
      [],
    ),
    pool.query<{ n: number }>(
      `select count(*)::int as n from conversations c
       where c.archived_at is null and c.status not in ('closed','bot')
         and c.merged_into is null
         and (
           (c.sla_next_reply_due is not null and c.sla_next_reply_due <= now())
           or (c.sla_next_reply_due is null and c.first_response_at is null and c.created_at < now() - interval '4 hours')
         )`,
      [],
    ),
    pool.query<{ n: number }>("select count(*)::int as n from conversations c where c.status = 'closed' and c.merged_into is null and c.closed_at >= date_trunc('day', now())", []),
    pool.query<{ n: number }>(
      `select count(*)::int as n from conversations c
       where c.archived_at is null and c.status <> 'closed'
         and c.merged_into is null
         and (c.ai_takeover_at is not null or c.followup_sent_at is not null)`,
      [],
    ),
    // Take-over attivato A MANO: aperti con takeover attivo E l'ultimo
    // evento audit autopilota_* = ON (la regola di takeover-shared; serve
    // l'indice (target, action, created_at desc) della migration 041).
    pool.query<{ n: number }>(
      `select count(*)::int as n from conversations c
       where c.archived_at is null and c.status <> 'closed'
         and c.merged_into is null
         and c.ai_takeover_at is not null
         and ${TAKEOVER_MANUALE_SQL}`,
      [],
    ),
  ]);
  const [aperti, daRisp, miei, collega, tutti] = [a, dr, m, c, t].map((r) => r.rows[0].n);
  return {
    aperti,
    da_rispondere: daRisp,
    miei,
    collega,
    tutti,
    archived: arch.rows[0].n,
    awaitingReply: daRisp,
    slaSoon: soon.rows[0].n,
    slaLate: late.rows[0].n,
    risoltiOggi: risolti.rows[0].n,
    ambrosio: amb.rows[0].n,
    ambrosioManuale: ambMan.rows[0].n,
  };
}

/**
 * Età relativa compatta della riga («2h», «3gg», «2sett»): regola pura in
 * tickets-shared.ts (zero import, testabile direttamente) re-esportata qui —
 * la vista la consuma dal dominio, come slaTier e awaitsReply.
 */
export { relativeAge, waTicketHref, likeContains } from "./tickets-shared";

/**
 * I canali che la UI offre SEMPRE come tab, anche a 0 conversazioni:
 * «nessun WhatsApp» è uno stato, non un canale inesistente. Vivono nel
 * dominio (e non nella pagina) perché la validazione del ?channel, le tab
 * permanenti e il conteggio per canale devono restare coerenti tra loro:
 * una sola lista, mai tre copie che divergono. Un canale nuovo della
 * migration resta data-driven (compare da solo via GROUP BY).
 *
 * Definizione e merge puro: tickets-shared.ts (regole senza DB, testate
 * direttamente); qui la re-esportazione per i consumatori del dominio e
 * la funzione che legge il DB e usa il merge.
 */
export { KNOWN_CHANNELS, mergeChannelCounts } from "./tickets-shared";

/**
 * Regole pure dell'upgrade (migration 046): tag, escalation, merge.
 * Definizione in tickets-shared.ts (zero import, testate direttamente
 * in tests/ticketing-upgrade.test.mjs); qui la re-esportazione per i
 * consumatori del dominio, come slaTier e awaitsReply.
 */
export {
  sanitizeTags,
  nextEscalationLevel,
  escalationLabel,
  canMerge,
  ESCALATION_MAX,
  TICKET_TAGS_MAX,
  TICKET_TAG_MAX_LEN,
  TICKET_TAG_VOCAB_MAX,
} from "./tickets-shared";

/**
 * Conteggio ticket per canale: le tab della inbox mostrano la scala di ogni
 * coda. Data-driven: un canale futuro (migration nuova) compare da solo,
 * senza toccare questa funzione; i canali PERMANENTI compaiono sempre,
 * anche a 0 — senza questa garanzia un ?channel=whatsapp su canale vuoto
 * collassava in «tutti» mostrando le ALTRE chat sotto l'URL del canale
 * (bug del 30/09/2026, scoperto pulendo lo scenario demo). Ordinamento:
 * i permanenti in banda fissa (web, email, whatsapp), i non-noti dopo,
 * per volume.
 */
export async function countTicketsByChannel(): Promise<Record<string, number>> {
  const pool = db();
  if (!pool) return mergeChannelCounts([]);
  const { rows } = await pool.query<{ channel: string | null; n: number }>(
    "select c.channel, count(*)::int as n from conversations c where c.archived_at is null and c.merged_into is null group by c.channel order by n desc",
  );
  return mergeChannelCounts(rows);
}

/**
 * Tag in uso nella coda (pillole del filtro ?tag= in inbox):
 * conteggi sulle conversazioni VIVE (non archiviate, non fuse),
 * per volume poi alfabetici. Data-driven: un tag nuovo compare
 * da solo, senza toccare la pagina.
 */
export async function getTicketTagCounts(): Promise<{ tag: string; n: number }[]> {
  const pool = db();
  if (!pool) return [];
  const { rows } = await pool.query<{ tag: string; n: number }>(
    `select tt.tag, count(*)::int as n
     from ticket_tags tt
     join conversations c on c.id = tt.conversation_id
     where c.archived_at is null and c.merged_into is null
     group by tt.tag
     order by n desc, tt.tag`,
  );
  return rows;
}

/** Colonne condivise dalla lista, dal dettaglio e dall'archivio. */
const TICKET_SELECT = `select c.id, c.number, c.initial_query, c.source_page, c.status, c.priority,
            c.assigned_to, o.first_name as assigned_name, c.created_at, c.updated_at,
            c.first_response_at, l.name as lead_name, l.phone as lead_phone, l.source as lead_source,
            l.wa_phone,
            (select count(*) from messages m where m.conversation_id = c.id) as message_count,
            ${LAST_SENDER_SQL} as last_sender,
            (select m3.body from messages m3 where m3.conversation_id = c.id order by m3.created_at desc limit 1) as last_message_body,
            c.sla_next_reply_due, c.sla_resolve_due, c.archived_at, c.channel, c.contact_email,
            c.closed_at,
            c.ai_takeover_at is not null as ambrosio_takeover,
            c.followup_sent_at is not null as ambrosio_followup,
            ${TAKEOVER_MANUALE_SQL} as ambrosio_manuale,
            c.followup_disabled_at is not null as followup_disabled,
            (select cc.client_id from client_conversations cc where cc.conversation_id = c.id limit 1) as client_id,
            (select cl.name from client_conversations cc
              join clients cl on cl.id = cc.client_id where cc.conversation_id = c.id limit 1) as client_name,
            c.escalation_level, c.escalation_at, c.merged_into, c.merged_at,
            (select array_agg(tt.tag order by tt.tag) from ticket_tags tt where tt.conversation_id = c.id) as tags,
            (select c2.number from conversations c2 where c2.id = c.merged_into) as merged_into_number
     from conversations c
     left join operators o on o.id = c.assigned_to
     left join leads l on l.id = c.lead_id`;

/** Dettaglio completo di un ticket (visto da qualsiasi filtro). */
export async function getTicket(id: string): Promise<TicketRow | null> {
  const pool = db();
  if (!pool) return null;
  const { rows } = await pool.query<TicketRow>(`${TICKET_SELECT} where c.id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * Ticket dal suo NUMERO (il merge lavora per numero: è ciò che
 * l'agente vede in inbox e condivide a voce). La destinazione di
 * un merge deve essere VIVA: un ticket già fuso non può assorbirne
 * altri (canMerge, regola pura in tickets-shared.ts).
 */
export async function getTicketByNumber(number: number): Promise<TicketRow | null> {
  const pool = db();
  if (!pool) return null;
  const { rows } = await pool.query<TicketRow>(
    `${TICKET_SELECT} where c.number = $1 and c.merged_into is null`,
    [String(number)],
  );
  return rows[0] ?? null;
}

/** Default delle risposte rapide se il DB non è configurato o la chiave manca. */
export const QUICK_REPLIES_DEFAULT = [
  "Perfetto, ti richiamo entro un'ora.",
  "Le preparo un preventivo su misura: le servono dettagli sul progetto?",
  "Grazie del tempo, le scritturo l'email con tutti i dettagli.",
] as const;

/** Default delle emoji della chat pubblica: le 20 attuali, se il DB non è configurato o la chiave manca. */
export const CHAT_EMOJIS_DEFAULT = [
  "😀", "😄", "😉", "😍", "🤩", "😎", "🤝", "👍", "👏", "🙏",
  "🔥", "✨", "💡", "🚀", "🎯", "💶", "📞", "💬", "✅", "❤️",
] as const;

export const CHAT_EMOJIS_KEY = "chat_emoji_picker";
export const CHAT_EMOJIS_MAX = 24;

export const QUICK_REPLIES_KEY = "ticket_quick_replies";
export const QUICK_REPLIES_MAX = 8;

/** Vocabolario dei tag (migration 046): i tag suggeriti
 *  dalla datalist dell'editor, editabili da
 *  /admin/settings/tag-vocabolario. Array JSON di stringhe;
 *  vuoto = nessun suggerimento (i tag liberi funzionano
 *  sempre — il vocabolario suggerisce, non vincola). */
export const TAG_VOCABULARY_KEY = "ticket_tag_vocabulary";

/* ==========================================================================
   CONTENT_SETTINGS UNA VOLTA PER RICHIESTA (ADR-005 esteso: ticket_sla_policy,
   chat_emoji_picker e ticket_quick_replies condividevano lo stesso destino
   dell'auth — più letture identiche nella stessa navigazione, ognuna con il
   suo round-trip). Lo snapshot è UNA query `key = any(...)` memoizzata con
   cache() di React; la chiave della memoizzazione è la VERSIONE del processo:
   le action che scrivono queste chiavi la incrementano
   (bumpContentSettingsVersion), così il render della STESSA richiesta dopo il
   salvataggio rilegge fresco invece di rispettare lo snapshot — e le
   richieste nuove (versione corrente) restano una query sola.
   ========================================================================== */

/** Le chiavi note dello snapshot: un canale nuovo entra aggiungendole qui. */
const CONTENT_SETTINGS_KEYS = [SLA_POLICY_KEY, CHAT_EMOJIS_KEY, QUICK_REPLIES_KEY, TAG_VOCABULARY_KEY];

/** Versione del processo: la usano le action di scrittura (vedi bump). */
let contentSettingsVersion = 0;

/** Invalida lo snapshot per-request dopo una scrittura su content_settings. */
export function bumpContentSettingsVersion(): void {
  contentSettingsVersion += 1;
}

const memoizedSnapshot = cache(
  async (version: number): Promise<Record<string, unknown>> => {
    void version; // la versione entra nella chiave del cache(): stessa versione = stessa Promise
    const pool = db();
    if (!pool) return {};
    const { rows } = await pool.query<{ key: string; value: unknown }>(
      "select key, value from content_settings where key = any($1)",
      [CONTENT_SETTINGS_KEYS],
    );
    const out: Record<string, unknown> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  },
);

function snapshotPerRichiesta(): Promise<Record<string, unknown>> {
  return memoizedSnapshot(contentSettingsVersion);
}

/**
 * Emoji del picker della chat pubblica: salvate in content_settings,
 * editabili da /admin/settings/emoji-chat. Con il DB assente si torna il
 * set predefinito (il sito funziona degradato, come da convenzione).
 * Validazione: solo stringhe di massimo 8 «unità visive» (una emoji con
 * modificatore o ZWJ può contare fino a 3-4 code point) — i bottoni del
 * picker sono cerchi da 44px, non testi.
 */
export async function getChatEmojis(): Promise<string[]> {
  const raw = (await snapshotPerRichiesta())[CHAT_EMOJIS_KEY];
  if (!Array.isArray(raw)) return [...CHAT_EMOJIS_DEFAULT];
  const list = raw
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter((x) => x.length > 0 && [...x].length <= 8)
    .slice(0, CHAT_EMOJIS_MAX);
  return list.length ? list : [...CHAT_EMOJIS_DEFAULT];
}
/**
 * Risposte rapide correnti: salvate in content_settings, editabili da
 * /admin/settings. Con il DB assente si tornano i default (il sito funziona
 * degradato, come da convenzione del progetto).
 */
export async function getQuickReplies(): Promise<string[]> {
  const raw = (await snapshotPerRichiesta())[QUICK_REPLIES_KEY];
  if (!Array.isArray(raw)) return [...QUICK_REPLIES_DEFAULT];
  const list = raw
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, QUICK_REPLIES_MAX);
  return list.length ? list : [...QUICK_REPLIES_DEFAULT];
}

/**
 * Vocabolario canonico dei tag (impostazioni → tag): è ciò che
 * la datalist suggerisce nell'editor dei tag del ticket. Vuoto =
 * nessun suggerimento (l'agente scrive liberamente: i tag non
 * hanno default, a differenza delle risposte rapide).
 */
export async function getTicketTagVocabulary(): Promise<string[]> {
  const raw = (await snapshotPerRichiesta())[TAG_VOCABULARY_KEY];
  if (!Array.isArray(raw)) return [];
  return sanitizeTags(
    raw.filter((x): x is string => typeof x === "string"),
    TICKET_TAG_VOCAB_MAX,
  );
}

/** Timestamp dell'ultimo messaggio sul ticket: per il polling live del dettaglio. */
export async function lastMessageAt(id: string): Promise<string | null> {
  const pool = db();
  if (!pool) return null;
  const { rows } = await pool.query<{ last_at: string | null }>(
    "select max(created_at) as last_at from messages where conversation_id = $1",
    [id],
  );
  return rows[0]?.last_at ?? null;
}

/**
 * Ticket archiviati (spam/vuoti), i più recenti prima: per il banner di
 * ripristino sopra la lista.
 */
export async function listArchivedTickets(limit = 10): Promise<TicketRow[]> {
  const pool = db();
  if (!pool) return [];
  const { rows } = await pool.query<TicketRow>(
    `${TICKET_SELECT}
     where c.archived_at is not null and c.merged_into is null
     order by c.archived_at desc
     limit $1`,
    [String(limit)],
  );
  return rows;
}

/**
 * Query lista ticket condivisa da dashboard e inbox. Paginazione a offset
 * (page ≥ 1): il chiamante chiede limit+1 e sa così se esiste una pagina
 * successiva senza una seconda query di conteggio (che dovrebbe ripetere
 * filtro, canale e ricerca per essere veritiera).
 */
export async function listTickets(
  filter: TicketFilter,
  operatorId: string | null,
  limit = 60,
  q?: string,
  channel?: string | null,
  page = 1,
  /** Dimensione reale della pagina per l'offset: il chiamante gonfia
   *  `limit` di +1 come sonda «esiste la pagina successiva», ma le finestre
   *  devono restare allineate al PAGE_SIZE — con l'offset su `limit` la
   *  pagina 2 partiva dalla riga 62 e la 61 saltava per sempre. */
  pageSize?: number,
  /** Filtro per tag (migration 046): la inbox mostra i ticket
   *  che portano questo tag. Parametrizzato (non interpolato):
   *  il tag arriva dall'URL e cerca una chiave esatta. */
  tag?: string | null,
): Promise<TicketRow[]> {
  const pool = db();
  if (!pool) return [];
  const f = ticketFilterSql(filter, operatorId);
  const params: string[] = [...f.params];
  // Ticket fusi (merge duplicati): fuori da ogni lista. Restano
  // leggibili dal loro permalink con il banner «fuso in #N».
  const notMerged = " and c.merged_into is null";
  // Inbox per canale (chat web vs WhatsApp): il valore arriva dalla tab dei
  // canali; «tutti» non aggiunge condizioni. Validato a livello app perché
  // è un parametro interpolato nella stringa (lista di valori nota).
  let channelSql = "";
  if (channel && channel !== "all") {
    channelSql = ` and c.channel = '${channel.replace(/'/g, "''")}'`;
  }
  // Filtro tag: EXISTS sull'indice ticket_tags_tag_idx — la
  // ricerca per tag è un lookup, non una scansione.
  let tagSql = "";
  if (tag?.trim()) {
    params.push(tag.trim());
    const tagParam = `$${params.length}`;
    tagSql = ` and exists (select 1 from ticket_tags tt where tt.conversation_id = c.id and tt.tag = ${tagParam})`;
  }
  let searchSql = "";
  const term = q?.trim();
  if (term) {
    // Wildcard dell'utente letteralizzati (likeContains, regola pura in
    // tickets-shared): «100%» cerca «100%», non «100» + qualunque cosa.
    params.push(likeContains(term));
    const like = `$${params.length}`;
    params.push(term);
    const exact = `$${params.length}`;
    searchSql = ` and (c.initial_query ilike ${like} or l.name ilike ${like} or l.phone ilike ${like} or c.number::text = ${exact})`;
  }
  params.push(String(limit));
  const limitParam = `$${params.length}`;
  params.push(String((Math.max(1, page) - 1) * (pageSize ?? limit)));
  const offsetParam = `$${params.length}`;
  const { rows } = await pool.query<TicketRow>(
    `${TICKET_SELECT}
     where ${f.sql}${notMerged}${channelSql}${tagSql}${searchSql}
     order by
       -- I ticket che aspettano una risposta umana vengono prima: non devono
       -- affondare sotto ticket movimentati ma già gestiti.
       (case when c.status <> 'closed'
             and c.status <> 'on_hold'
             and ${LAST_SENDER_SQL} = 'visitor'
            then 0 else 1 end),
       c.updated_at desc,
       -- Ordinamento TOTALE (serve alla paginazione): senza tiebreaker due
       -- ticket con updated_at identico potevano scambiarsi di posto tra
       -- una pagina e l'altra, duplicando o perdendo righe.
       c.id desc
     limit ${limitParam} offset ${offsetParam}`,
    params,
  );
  return rows;
}

/* ==========================================================================
   DASHBOARD TICKET (/admin/tickets/dashboard)
   Le aggregazioni della brief (docs/dashboard-ticket-brief.md): 5 KPI con
   confronti 7gg, volume/giorno per canale, distribuzione tempi di prima
   risposta a bucket SLA, carico per operatore, aging del backlog, mix
   canale/priorità. Zero chart library: la pagina disegna barre in CSS.
   Caveat da brief: nessun contatore di riaperture (colonna inesistente, la
   metrica non è specificabile); i breach storici usano la soglia 2h default
   (se la policy SLA è cambiata nel tempo il retrospettivo è approssimato).
   ========================================================================== */

export interface TicketDashboard {
  kpi: {
    aperti: { n: number; prev: number };
    daRispondere: { n: number; oldestH: number | null };
    primaRisposta: { minuti: number | null; n: number };
    risolti7: { n: number; prev: number };
    violazioni: { n: number; prev: number };
  };
  /** Volume per giorno (chiave ISO) × canale: la pagina somma le serie. */
  volume: { giorno: string; canale: string; n: number }[];
  giorni: string[];
  rispostaBuckets: { key: string; label: string; n: number }[];
  carico: { key: string; label: string; aperti: number; daRispondere: number }[];
  aging: { key: string; label: string; n: number }[];
  mixCanali: { canale: string; label: string; totale: number; daRispondere: number }[];
  mixPriorita: { priorita: string; label: string; n: number }[];
  /** Confronto col periodo precedente (stesse definizioni, finestra shiftata
   *  indietro di `days`): totali per canale del volume, bucket tempi di 1ª
   *  risposta, e aging/carico valutati AL CONFINE della finestra (chi era
   *  aperto allora: ricostruzione onesta da archived_at/closed_at — chi
   *  aspettava risposta in quel momento non è derivabile, quindi per il
   *  carico si confronta solo il totale degli aperti). La pagina li disegna
   *  sotto ogni grafico. */
  volumePrev: { canale: string; n: number }[];
  rispostaBucketsPrev: { key: string; n: number }[];
  caricoApertiPrev: number;
  agingPrev: { key: string; n: number }[];
  /** Tendenza per operatore: attività del team attribuita a chi l'ha fatta
   *  (autore del messaggio operatore / chi ha chiuso il ticket). Le risposte
   *  contano i messaggi scritti nella finestra; mediaRisposta = media della
   *  PRIMA risposta di ciascuno sulle conversazioni nate nella finestra. */
  operatoriTrend: {
    label: string;
    risposte: number;
    prevRisposte: number;
    chiusi: number;
    prevChiusi: number;
    mediaRisposta: number | null;
  }[];
}

export async function getTicketDashboard(days: number): Promise<TicketDashboard> {
  const pool = db();
  const vuota: TicketDashboard = {
    kpi: {
      aperti: { n: 0, prev: 0 },
      daRispondere: { n: 0, oldestH: null },
      primaRisposta: { minuti: null, n: 0 },
      risolti7: { n: 0, prev: 0 },
      violazioni: { n: 0, prev: 0 },
    },
    volume: [],
    giorni: [],
    rispostaBuckets: [],
    carico: [],
    aging: [],
    mixCanali: [],
    mixPriorita: [],
    volumePrev: [],
    rispostaBucketsPrev: [],
    caricoApertiPrev: 0,
    agingPrev: [],
    operatoriTrend: [],
  };
  if (!pool) return vuota;

  const daysInt = Math.max(7, Math.min(90, Math.round(days) || 30));
  // «Ultimi N giorni» = finestra [now - Ngg, now): coerente tra KPI e grafici.
  const winSql = `c.created_at >= now() - interval '${daysInt} days'`;
  const prevWinSql = `c.created_at >= now() - interval '${daysInt * 2} days' and c.created_at < now() - interval '${daysInt} days'`;
  // daysInt intero e clampato: l'interpolazione è sicura (come channelSql).
  // Varianti dei predicati per gli alias del trend per operatore
  // (m = messages, mc = la conversazione nella subquery della media).
  const winM = `m.created_at >= now() - interval '${daysInt} days'`;
  const prevWinM = `m.created_at >= now() - interval '${daysInt * 2} days' and m.created_at < now() - interval '${daysInt} days'`;
  const winMc = `mc.created_at >= now() - interval '${daysInt} days'`;

  // L'ultimo sender, usato sia per «da rispondere» sia per escludere i bot:
  // senza l'esclusione la sub «il più vecchio aspetta da Xh» conterebbe anche
  // le conversazioni mai gestite (ultima parola del visitatore ma nessuno
  // ha mai preso il ticket) — esattamente il numero che deve fare alzare.
  const awaitingSql = `c.archived_at is null and c.status not in ('closed', 'on_hold', 'bot')
    and ${LAST_SENDER_SQL} = 'visitor'`;

  // Prima risposta: come la definisce la brief — esclusi i bot (mai armati)
  // e le callback (interazione umana non testuale, non una risposta scritta).
  const respMinSql = `extract(epoch from (c.first_response_at - c.created_at)) / 60.0`;
  const answeredSql = `c.first_response_at is not null and c.status not in ('bot', 'callback_scheduled')`;
  // Breach: risposto oltre target OPPURE mai risposto da più di 2h (solo
  // ticket con un umano coinvolto: senza, ogni ticket bot-growing sarebbe
  // una violazione che nessuno può mai chiudere).
  const breachSql = `c.status not in ('bot', 'callback_scheduled') and (
    (c.first_response_at is not null and extract(epoch from (c.first_response_at - c.created_at)) > ${SLA_TARGET_H * 3600})
    or (c.first_response_at is null and c.created_at < now() - interval '${SLA_TARGET_H} hours'))`;

  const kpiSql = `
    select
      (select count(*) from conversations c
        where c.archived_at is null and c.status not in ('closed', 'on_hold'))::int as aperti,
      (select count(*) from conversations c
        where c.archived_at is null and c.status not in ('closed', 'on_hold')
          and c.created_at < now() - interval '${daysInt} days')::int as aperti_prev,
      (select count(*) from conversations c where ${awaitingSql})::int as da_rispondere,
      (select max(extract(epoch from (now() - c.created_at))) / 3600.0 from conversations c where ${awaitingSql})::float as oldest_h,
      (select avg(${respMinSql}) from conversations c where ${answeredSql} and ${winSql})::float as resp_avg,
      (select count(*) from conversations c where ${answeredSql} and ${winSql})::int as resp_n,
      (select count(*) from conversations c where c.status = 'closed' and c.closed_at >= now() - interval '7 days')::int as risolti7,
      (select count(*) from conversations c where c.status = 'closed' and c.closed_at >= now() - interval '14 days'
        and c.closed_at < now() - interval '7 days')::int as risolti7_prev,
      (select count(*) from conversations c where ${breachSql} and ${winSql})::int as violazioni,
      (select count(*) from conversations c where ${breachSql} and ${prevWinSql})::int as violazioni_prev`;

  // Volume per giorno × canale (solo canali noti: un canale nuovo compare
  // appena la migration lo introduce, ma il grafico resta a 3 serie leggibili).
  const channelsList = KNOWN_TICKET_CHANNELS.map((c) => `'${c}'`).join(",");
  const volumeSql = `
    select to_char(date_trunc('day', c.created_at), 'YYYY-MM-DD') as giorno, c.channel as canale,
           count(*)::int as n
    from conversations c
    where ${winSql} and c.channel = any(array[${channelsList}])
    group by 1, 2 order by 1`;

  // Distribuzione tempi di prima risposta a bucket SLA (finestra days):
  // le soglie parlano la lingua del servizio (≤1h ok, 1–2h appena, 2–4h zona
  // di pericolo, >4h persi, «mai» = l'insulto che nessuna media mostra).
  const bucketsSql = `
    select
      count(*) filter (where ${respMinSql} <= 60)::int as b1,
      count(*) filter (where ${respMinSql} > 60 and ${respMinSql} <= 120)::int as b2,
      count(*) filter (where ${respMinSql} > 120 and ${respMinSql} <= 240)::int as b3,
      count(*) filter (where ${respMinSql} > 240)::int as b4,
      count(*) filter (where c.first_response_at is null and c.status not in ('bot', 'callback_scheduled') and ${winSql})::int as mai
    from conversations c
    where ${answeredSql} and ${winSql}`;

  // Carico per operatore: aperti (non chiusi, non archiviati) e da rispondere.
  // I «non assegnati» sono la riga più importante: è il bacino da prendere.
  const caricoSql = `
    select coalesce(o.first_name, 'Non assegnati') as label,
           coalesce(c.assigned_to, 'none') as key,
           count(*) filter (where c.archived_at is null and c.status not in ('closed', 'on_hold'))::int as aperti,
           count(*) filter (where c.archived_at is null and c.status not in ('closed', 'on_hold', 'bot')
             and ${LAST_SENDER_SQL} = 'visitor')::int as da_rispondere
    from conversations c
    left join operators o on o.id = c.assigned_to
    group by 1, 2
    having count(*) filter (where c.archived_at is null and c.status not in ('closed', 'on_hold')) > 0
    order by aperti desc`;

  // Aging del backlog APERTO: le fasce d'età per decidere chi toccare prima.
  const agingSql = `
    select
      count(*) filter (where c.created_at >= now() - interval '1 day')::int as a1,
      count(*) filter (where c.created_at < now() - interval '1 day' and c.created_at >= now() - interval '3 days')::int as a2,
      count(*) filter (where c.created_at < now() - interval '3 days' and c.created_at >= now() - interval '7 days')::int as a3,
      count(*) filter (where c.created_at < now() - interval '7 days')::int as a4
    from conversations c
    where c.archived_at is null and c.status not in ('closed', 'on_hold')`;

  // Mix canale (finestra) + priorità del backlog aperto: due GROUP BY piccoli.
  const mixSql = `
    select
      (select json_agg(row_to_json(t)) from (
         select c.channel, count(*)::int as n,
                count(*) filter (where c.status not in ('closed', 'on_hold', 'bot') and ${LAST_SENDER_SQL} = 'visitor')::int as awaiting
         from conversations c
         where ${winSql} and c.channel is not null
         group by 1 order by 2 desc
       ) t) as canali,
      (select json_agg(row_to_json(t)) from (
         select c.priority, count(*)::int as n
         from conversations c
         where c.archived_at is null and c.status not in ('closed', 'on_hold') and c.priority is not null
         group by 1
       ) t) as priorita`;

  // ─── CONFRONTO COL PERIODO PRECEDENTE (stesse definizioni, finestra shiftata):
  // ogni grafico della pagina guadagna una riga «vs periodo prec.» sotto di sé.
  // Volume e bucket: le stesse query con prevWinSql al posto di winSql.
  const volumePrevSql = volumeSql.replace(winSql, prevWinSql);
  const bucketsPrevSql = bucketsSql.replace(winSql, prevWinSql);
  // Carico valutato AL CONFINE della finestra: chi era aperto allora = non
  // chiuso prima della fine della finestra e non archiviato prima (chi è
  // stato chiuso dopo conta come aperto: la ricostruzione retroattiva non
  // può saperlo — dichiarato in pagina, non nascosto).
  const caricoPrevSql = `
    select count(*)::int as n
    from conversations c
    where c.created_at < now() - interval '${daysInt} days'
      and (c.closed_at is null or c.closed_at >= now() - interval '${daysInt} days')
      and (c.archived_at is null or c.archived_at >= now() - interval '${daysInt} days')`;
  // Aging al confine: stesse fasce, valutate sulla coda com'era allora.
  const agingPrevSql = `
    select
      count(*) filter (where c.created_at >= now() - interval '${daysInt * 2} days' and c.created_at < now() - interval '${daysInt} days')::int as a1,
      count(*) filter (where c.created_at >= now() - interval '${daysInt} days' - interval '2 days' and c.created_at < now() - interval '${daysInt} days')::int as a2,
      count(*) filter (where c.created_at >= now() - interval '${daysInt} days' - interval '7 days' and c.created_at < now() - interval '${daysInt} days' - interval '2 days')::int as a3,
      count(*) filter (where c.created_at < now() - interval '${daysInt} days' - interval '7 days')::int as a4
    from conversations c
    where c.created_at < now() - interval '${daysInt} days'
      and (c.closed_at is null or c.closed_at >= now() - interval '${daysInt} days')
      and (c.archived_at is null or c.archived_at >= now() - interval '${daysInt} days')`;

  // Tendenza per operatore: risposte e chiusure attribuite a CHI le ha fatte.
  // Le risposte usano messages.author (= displayName, unica chiave scritta
  // dagli insert reali); i CHIUSI contano su closed_at (quando l'azione è
  // avvenuta), non su created_at. mediaRisposta = media della PRIMA risposta
  // di ciascuno sulle conversazioni nate nella finestra: una conversazione
  // è attribuita a un autore solo se il SUO primo messaggio operatore è
  // davvero first_response_at (altrimenti è la risposta di un altro).
  const trendSql = `
    select
      coalesce(r.author, k.closed_by) as author,
      coalesce(r.n, 0)::int as risposte,
      coalesce(r.prev_n, 0)::int as prev_risposte,
      coalesce(k.n, 0)::int as chiusi,
      coalesce(k.prev_n, 0)::int as prev_chiusi,
      r.media_minuti
    from
      (select m.author,
              count(*) filter (where ${winM})::int as n,
              count(*) filter (where ${prevWinM})::int as prev_n,
              (select round(avg(r.minuti))::float
                 from (select extract(epoch from (mc.first_response_at - mc.created_at)) / 60.0 as minuti
                         from conversations mc
                        where mc.first_response_at = (select min(mr.created_at) from messages mr
                                                       where mr.conversation_id = mc.id and mr.sender = 'operator'
                                                         and mr.author = m.author)
                          and ${winMc}) r
              ) as media_minuti
         from messages m
        where m.sender = 'operator' and m.author is not null
        group by m.author) r
    full outer join
      (select o.first_name as closed_by,
              count(*) filter (where c.closed_at >= now() - interval '${daysInt} days')::int as n,
              count(*) filter (where c.closed_at >= now() - interval '${daysInt * 2} days' and c.closed_at < now() - interval '${daysInt} days')::int as prev_n
         from conversations c
         join operators o on o.id = c.closed_by
        where c.closed_by is not null
        group by 1) k
      on k.closed_by = r.author`;

  const [kpi, volume, buckets, carico, aging, mix, volumePrev, bucketsPrev, caricoPrev, agingPrev, trend] = await Promise.all([
    pool.query(kpiSql),
    pool.query(volumeSql),
    pool.query(bucketsSql),
    pool.query(caricoSql),
    pool.query(agingSql),
    pool.query(mixSql),
    pool.query(volumePrevSql),
    pool.query(bucketsPrevSql),
    pool.query(caricoPrevSql),
    pool.query(agingPrevSql),
    pool.query(trendSql),
  ]);

  const k = kpi.rows[0] as Record<string, number | null>;
  const b = buckets.rows[0] as Record<string, number>;
  const a = aging.rows[0] as Record<string, number>;
  const mixRows = mix.rows[0] as { canali: { channel: string; n: number; awaiting: number }[] | null; priorita: { priority: string; n: number }[] | null };
  const pb = bucketsPrev.rows[0] as Record<string, number>;
  const cp = caricoPrev.rows[0] as { n: number };
  const pa = agingPrev.rows[0] as Record<string, number>;

  // Griglia giorni continua (anche i giorni a 0): il vuoto nel tempo È un dato —
  // un buco di 4 giorni senza ticket non deve sembrare un bug del grafico.
  const giorni: string[] = [];
  const today = new Date();
  for (let i = daysInt - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    giorni.push(d.toISOString().slice(0, 10));
  }

  return {
    kpi: {
      aperti: { n: k.aperti ?? 0, prev: k.aperti_prev ?? 0 },
      daRispondere: { n: k.da_rispondere ?? 0, oldestH: k.oldest_h != null ? Math.floor(k.oldest_h) : null },
      primaRisposta: { minuti: k.resp_avg != null ? Math.round(k.resp_avg) : null, n: k.resp_n ?? 0 },
      risolti7: { n: k.risolti7 ?? 0, prev: k.risolti7_prev ?? 0 },
      violazioni: { n: k.violazioni ?? 0, prev: k.violazioni_prev ?? 0 },
    },
    volume: volume.rows as { giorno: string; canale: string; n: number }[],
    giorni,
    rispostaBuckets: [
      { key: "le1h", label: "≤ 1 ora", n: b.b1 ?? 0 },
      { key: "1-2h", label: "1–2 ore", n: b.b2 ?? 0 },
      { key: "2-4h", label: "2–4 ore", n: b.b3 ?? 0 },
      { key: "oltre4h", label: "> 4 ore", n: b.b4 ?? 0 },
      { key: "mai", label: "Mai risposto", n: b.mai ?? 0 },
    ],
    carico: (carico.rows as { label: string; key: string; aperti: number; da_rispondere: number }[]).map((r) => ({
      key: r.key,
      label: r.label,
      aperti: r.aperti,
      daRispondere: r.da_rispondere,
    })),
    aging: [
      { key: "lt1g", label: "Meno di 24h", n: a.a1 ?? 0 },
      { key: "1-3g", label: "1–3 giorni", n: a.a2 ?? 0 },
      { key: "3-7g", label: "3–7 giorni", n: a.a3 ?? 0 },
      { key: "oltre7g", label: "Oltre 7 giorni", n: a.a4 ?? 0 },
    ],
    mixCanali: (mixRows.canali ?? []).map((r) => ({
      canale: r.channel,
      label: CHANNEL_LABEL_IT[r.channel] ?? r.channel,
      totale: r.n,
      daRispondere: r.awaiting,
    })),
    mixPriorita: (mixRows.priorita ?? []).map((r) => ({
      priorita: r.priority,
      label: PRIORITY_LABEL[r.priority] ?? r.priority,
      n: r.n,
    })),
    volumePrev: (volumePrev.rows as { canale: string; n: number }[]).map((r) => ({
      canale: r.canale,
      n: r.n,
    })),
    rispostaBucketsPrev: [
      { key: "le1h", n: pb.b1 ?? 0 },
      { key: "1-2h", n: pb.b2 ?? 0 },
      { key: "2-4h", n: pb.b3 ?? 0 },
      { key: "oltre4h", n: pb.b4 ?? 0 },
      { key: "mai", n: pb.mai ?? 0 },
    ],
    caricoApertiPrev: cp.n ?? 0,
    agingPrev: [
      { key: "lt1g", n: pa.a1 ?? 0 },
      { key: "1-3g", n: pa.a2 ?? 0 },
      { key: "3-7g", n: pa.a3 ?? 0 },
      { key: "oltre7g", n: pa.a4 ?? 0 },
    ],
    operatoriTrend: (trend.rows as { author: string; risposte: number; prev_risposte: number; chiusi: number; prev_chiusi: number; media_minuti: number | null }[])
      .map((t) => ({
        label: t.author,
        risposte: t.risposte,
        prevRisposte: t.prev_risposte,
        chiusi: t.chiusi,
        prevChiusi: t.prev_chiusi,
        mediaRisposta: t.media_minuti != null ? Math.round(t.media_minuti) : null,
      }))
      .sort((x, y) => y.risposte + y.chiusi - (x.risposte + x.chiusi)),
  };
}
