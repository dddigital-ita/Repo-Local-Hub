/**
 * FASE 1 Ambrosio — tool use con parser JSON (PROMPT-AMBROSIO-AI.md).
 *
 * Ambrosio può chiamare SOLO le funzioni di questa whitelist, con input
 * validati e controlli lato server. Il protocollo è testuale e provider-
 * agnostico: nel prompt di sistema le funzioni sono descritte come blocco
 * <tools>; il modello può emettere UN blocco <tool>{"fn":..., "args":{...}}
 * </tool> nella risposta, che qui viene validato ed eseguito, e rimosso
 * dal testo che vede il cliente. Funziona con qualunque provider (non
 * serve tool-use nativo) e resta fallibile in silenzio: un errore di
 * esecuzione NON blocca mai la risposta testuale già emessa.
 *
 * Regole invalicabili:
 * - nessuna azione distruttiva (niente chiusure, cancellazioni, edit di lead);
 * - callback SOLO con consenso esplicito e slot realistici (turni reali);
 * - priorità SOLO alzata, mai abbassata;
 * - ogni chiamata eseguita finisce nell'audit log con actor "ambrosio".
 */
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { notifyHandoff } from "@/lib/notify";
import { canSendFollowup, adapterFor, isChannel, toE164 } from "@/lib/messaging";
import { slotToDate } from "@/lib/slots";
import { slaDueFor, TICKET_PRIORITIES, type TicketPriority } from "@/lib/tickets";
import { extractPhone } from "@/lib/lead-extract";
import { getSyncConfig } from "@/lib/notion-config";
import { enqueueNotionSync } from "@/lib/notion-queue";
import { accessAllowed, PROPOSAL_TITLE_MAX, PROPOSAL_BODY_MAX, sanitizeProposalBody, type AmbrosioLevel } from "./ambrosio-autonomy";
import { insertProposal } from "./ambrosio-server";
import { queueGCalSyncForCallback } from "./google-calendar";
import { getFreeSlots, createCalendarItem } from "@/lib/calendar-hub";
import { FOLLOWUP_NOW_AUDIT } from "@/lib/desk-autopilota-shared";

/** Firma di Ambrosio nell'audit log. */
export const AI_ACTOR = "ambrosio@ai";

export interface ToolContext {
  conversationId: string | null;
}

export interface ToolResult {
  fn: string;
  ok: boolean;
  /** Frase breve per il log/diagnostica, mai mostrata al cliente. */
  detail: string;
}

export interface ParsedTool {
  fn: string;
  args: Record<string, unknown>;
}

/** Livello di autonomia corrente (per il gate dei tool): default L1 = nessun tool. */
let activeLevel: AmbrosioLevel = 1;

/** Imposta il livello per la risposta in corso (chiamato dalla route prima dell'esecuzione). */
export function setToolLevel(level: AmbrosioLevel): void {
  activeLevel = level;
}

/** Il gate del tool in base al livello (usa il cuore puro). */
export function toolAllowedForLevel(fn: string, level: AmbrosioLevel = activeLevel): boolean {
  return accessAllowed(level, fn);
}

/** Istruzioni per il prompt di sistema (appese al resto, in italiano). */
export const TOOLS_PROMPT_BLOCK = `

<tools>
Hai a disposizione MASSIMO UN'azione per risposta. Se decidi di agire, aggiungi IN FONDO alla risposta un blocco esattamente in questo formato (riga unica, JSON valido):

<tool>{"fn":"NOME","args":{...}}</tool>

Funzioni disponibili (nessun'altra esiste):
- {"fn":"salva_lead","args":{"nome":"...","telefono":"...","consenso":true,"servizio":"...","urgenza":"...","budget":"...","lingua":"it"}}
- {"fn":"fissa_callback","args":{"slot":"Domani alle 09:00"}} — slot validi: Oggi/Domani alle 09:00-13:00 o 15:00-19:00 (turni reali del team). SOLO dopo un consenso esplicito del cliente alla richiamata.
- {"fn":"aggiorna_ticket","args":{"priorita":"alta"}} — ammessi: alta, urgente. Solo se l'urgenza dichiarata dal cliente è reale.
- {"fn":"nota_interna","args":{"testo":"riepilogo per il team: chi, cosa vuole, urgenza, budget, dati raccolti"}}
- {"fn":"handoff","args":{"motivo":"perché serve un umano"}}
- {"fn":"cerca_cliente","args":{"telefono":"..."}} oppure {"fn":"cerca_cliente","args":{"email":"..."}} oppure {"fn":"cerca_cliente","args":{"nome":"..."}} — cerca il cliente nel portafoglio: se esiste già, usalo nella nota interna e nell'handoff («è un cliente noto: 3 ticket, ultimo a settembre»). Solo lettura, non modifica nulla.
- {"fn":"cerca_slot","args":{"giorni":5,"minuti":30,"operatore":"A"}} — slot liberi REALI dell'agenda (Calendar Hub, turni e impegni compresi). Cons1 PRIMA di proporre qualsiasi orario al cliente: mai inventare disponibilità. Senza "operatore" restituisce il primo slot per ogni persona disponibile.
- {"fn":"prenota_appuntamento","args":{"slot":"2026-10-01T09:30:00Z","titolo":"Call conoscitiva — Rossi","operatore":"A","minuti":30}} — prenota in agenda SOLO uno slot ricevuto da cerca_slot (mai un orario inventato), con consenso del cliente già esplicito. Il cliente riceve la conferma dell'orario ESATTO proposto.
- {"fn":"prepara_proposta","args":{"titolo":"...","testo":"proposta completa...","item":"Voce|800 €"}} (item ripetibile fino a 8) — prepara una BOZZA di proposta con preventivo per il team. Solo con servizio e contatti già raccolti; mai promettere al cliente che sia un prezzo definitivo.

Regole:
- salva_lead: usa SOLO dati dichiarati dal cliente; consenso DEVE essere true perché il contatto sia salvato (il "sì" esplicito alla registrazione). Se manca il consenso, non chiamare la funzione.
- fissa_callback richiede consenso esplicito al richiamo, mai promettere orari diversi dagli slot.
- Per gli APPUNTAMENTI: prima cerca_slot, poi prenota_appuntamento SOLO su uno slot restituito; cita al cliente giorno, ora e persona. Se cerca_slot non restituisce nulla, di' che il team confermerà l'orario — non inventare orari.
- Non usare il blocco <tool> se non serve agire: la risposta normale è senza.
- Dopo il blocco <tool> non scrivere altro.
</tools>`;

const TOOL_FNS = ["salva_lead", "fissa_callback", "aggiorna_ticket", "nota_interna", "handoff", "cerca_cliente", "cerca_slot", "prenota_appuntamento", "prepara_proposta"] as const;

/**
 * Estrae gli oggetti JSON bilanciando le graffe (sul vivo: due chiamate
 * `{"fn":…}` concatenate nello stesso blocco, senza tag di chiusura).
 */
function extractJsonObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          out.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return out;
}

/**
 * Estrae il blocco <tool>…</tool> e lo rimuove dal testo di risposta.
 * Tollerante: i modelli piccoli a volte scrivono «};» finale, fences o testo
 * attorno al JSON — l'azione va recuperata lo stesso (scoperto sul vivo con
 * qwen2.5: il blocco grezzo finiva AL CLIENTE e l'azione si perdeva).
 */
export function parseToolCall(reply: string): {
  clean: string;
  call: ParsedTool | null;
  calls: ParsedTool[];
} {
  // Blocco singolo «<tool>…</tool>» OPPURE più blocchi concatenati (sul vivo:
  // modello che emette salva_lead + prepara_proposta nello stesso messaggio).
  // Estraggo TUTTI i blocchi validi; il «primario» è la proposta se c'è,
  // altrimenti il primo.
  const spans: string[] = [];
  const re = /<tool>([\s\S]*?)<\/tool>/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(reply)) !== null) spans.push(mm[1]);
  // Modello che apre <tool> ma non chiude: stesso trattamento, il blocco
  // grezzo non arriva MAI al cliente.
  const open = spans.length === 0 ? reply.match(/<tool>([\s\S]*)$/) : null;
  if (open) spans.push(open[1]);
  if (spans.length === 0) return { clean: reply.trim(), call: null, calls: [] };

  // Il blocco NON arriva mai al cliente, anche quando il JSON dentro è rotto.
  let clean = reply.replace(/<tool>[\s\S]*?<\/tool>/g, "").replace(/<tool>[\s\S]*$/, "");
  clean = clean.replace(/<\/?>tool>/g, "").replace(/\n{3,}/g, "\n\n").trim();

  // Recupero del JSON da ogni blocco: ogni oggetto bilanciato è una chiamata.
  const calls: ParsedTool[] = [];
  const build = (raw: { fn?: unknown; args?: unknown }): ParsedTool | null => {
    const fn = typeof raw.fn === "string" ? raw.fn : "";
    if (!TOOL_FNS.includes(fn as (typeof TOOL_FNS)[number])) return null;
    const args = raw.args && typeof raw.args === "object" && !Array.isArray(raw.args) ? (raw.args as Record<string, unknown>) : {};
    return { fn, args };
  };
  for (const span of spans) {
    const candidate = span.replace(/[`]/g, "").trim();
    const objects = extractJsonObjects(candidate);
    let found = false;
    for (const obj of objects) {
      const cleaned = obj.replace(/;+\s*$/, "").trim();
      try {
        const c = build(JSON.parse(cleaned) as { fn?: unknown; args?: unknown });
        if (c) {
          calls.push(c);
          found = true;
        }
      } catch {
        // Oggetto rotto: si tenta il recupero campo per campo.
        const fnM = cleaned.match(/"fn"\s*:\s*"([a-z_]+)"/);
        const argsM = cleaned.match(/"args"\s*:\s*(\{[\s\S]*\})/);
        if (fnM) {
          let args: Record<string, unknown> = {};
          if (argsM) {
            try {
              args = JSON.parse(argsM[1]) as Record<string, unknown>;
            } catch {
              args = {};
            }
          }
          const c = build({ fn: fnM[1], args });
          if (c) {
            calls.push(c);
            found = true;
          }
        }
      }
    }
    if (!found && objects.length === 0) {
      // Nessuna graffa bilanciata: tentativo «fn»/«args» sciolto sull'intero blocco.
      const fnM = candidate.match(/"fn"\s*:\s*"([a-z_]+)"/);
      if (fnM) {
        const c = build({ fn: fnM[1], args: {} });
        if (c) calls.push(c);
      }
    }
  }
  const call = calls.find((c) => c.fn === "prepara_proposta") ?? calls[0] ?? null;
  return { clean, call, calls };
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

const PRIORITA_RAISE: Record<string, TicketPriority> = { alta: "alta", urgente: "urgente" };
const RANK: Record<string, number> = { bassa: 0, normale: 1, alta: 2, urgente: 3 };

/**
 * Esegue la chiamata validata. Tutti i fallimenti restituiscono
 * { ok:false } e vengono loggati: mai eccezioni verso il chiamante.
 */
export async function executeToolCall(call: ParsedTool, ctx: ToolContext): Promise<ToolResult> {
  try {
    switch (call.fn) {
      case "salva_lead":
        return await toolSalvaLead(call.args, ctx);
      case "fissa_callback":
        return await toolFissaCallback(call.args, ctx);
      case "aggiorna_ticket":
        return await toolAggiornaTicket(call.args, ctx);
      case "nota_interna":
        return await toolNotaInterna(call.args, ctx);
      case "handoff":
        return await toolHandoff(call.args, ctx);
      case "cerca_cliente":
        return await toolCercaCliente(call.args, ctx);
      case "cerca_slot":
        return await toolCercaSlot(call.args, ctx);
      case "prenota_appuntamento":
        return await toolPrenotaAppuntamento(call.args, ctx);
      case "prepara_proposta":
        return await toolPreparaProposta(call.args, ctx);
      default:
        return { fn: call.fn, ok: false, detail: "funzione non in whitelist" };
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`[ai-tools] ${call.fn}:`, detail);
    return { fn: call.fn, ok: false, detail };
  }
}

/* ── salva_lead ─────────────────────────────────────────────────── */

async function toolSalvaLead(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const pool = db();
  if (!pool || !ctx.conversationId) return { fn: "salva_lead", ok: false, detail: "nessuna conversazione" };

  const consent = args.consenso === true || args.consenso === "true";
  if (!consent) return { fn: "salva_lead", ok: false, detail: "consenso mancante: contatto NON salvato" };

  // Il telefono lo valida SEMPRE il server (E.164/nazionale), non il modello.
  const rawPhone = str(args.telefono, 40);
  const phone = rawPhone ? extractPhone(rawPhone) : null;
  const name = str(args.nome, 80);
  if (!name || !phone) return { fn: "salva_lead", ok: false, detail: "nome o telefono non validi" };

  const already = await pool.query("select lead_id from conversations where id = $1 and lead_id is not null", [ctx.conversationId]);
  if (already.rows.length > 0) return { fn: "salva_lead", ok: true, detail: "lead già presente, nessun duplicato" };

  const service = str(args.servizio, 120);
  const urgency = str(args.urgenza, 80);
  const budget = str(args.budget, 80);
  const lingua = str(args.lingua, 8) ?? "it";

  const ins = await pool.query<{ id: string }>(
    `insert into leads (conversation_id, name, phone, service, urgency, budget, consent, status, source)
     values ($1, $2, $3, $4, $5, $6, true, 'nuovo', 'ai') returning id`,
    [ctx.conversationId, name, phone, service, urgency, budget],
  );
  await pool.query("update conversations set lead_id = $2, status = 'lead_captured' where id = $1", [ctx.conversationId, ins.rows[0].id]);
  await logAudit(AI_ACTOR, "ambrosio.salva_lead", ins.rows[0].id, `${name} · ${phone} · lingua ${lingua}${service ? ` · ${service}` : ""}`);
  // Notion on_create: se attivo in config, accoda il lead appena nato (non bloccante).
  try {
    const cfg = await getSyncConfig();
    if (cfg.entities.leads.enabled && cfg.sync.onCreate) {
      const { rows: fresh } = await pool.query("select * from leads where id = $1", [ins.rows[0].id]);
      if (fresh[0]) await enqueueNotionSync("lead", fresh[0] as Record<string, unknown>, cfg);
    }
  } catch {}
  return { fn: "salva_lead", ok: true, detail: `lead ${ins.rows[0].id} salvato (${name}, ${phone})` };
}

/* ── fissa_callback ─────────────────────────────────────────────── */

async function toolFissaCallback(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const pool = db();
  if (!pool || !ctx.conversationId) return { fn: "fissa_callback", ok: false, detail: "nessuna conversazione" };

  const slot = str(args.slot, 40);
  const when = slot ? slotToDate(slot) : null;
  if (!when) return { fn: "fissa_callback", ok: false, detail: `slot non valido: ${slot ?? "vuoto"}` };

  // Solo su conversazioni con lead salvato (consenso già tracciato lì).
  const lead = await pool.query<{ id: string }>("select lead_id as id from conversations where id = $1 and lead_id is not null", [ctx.conversationId]);
  if (!lead.rows[0]?.id) return { fn: "fissa_callback", ok: false, detail: "nessun lead con consenso: callback negata" };

  const ins = await pool.query<{ id: string }>(
    `insert into callbacks (conversation_id, lead_id, scheduled_at, slot_label, notes)
     values ($1, $2, $3, $4, 'fissata da Ambrosio') returning id`,
    [ctx.conversationId, lead.rows[0].id, when, slot],
  );
  await pool.query("update conversations set status = 'callback_scheduled', callback_slot = $2 where id = $1", [ctx.conversationId, slot]);
  await pool.query("update leads set status = 'callback_scheduled', callback_slot = $2 where id = $1", [lead.rows[0].id, slot]);
  await logAudit(AI_ACTOR, "ambrosio.fissa_callback", ins.rows[0].id, `${slot} (lead ${lead.rows[0].id})`);
  // GOOGLE CALENDAR (se attivo): l'appuntamento fissato da Ambrosio finisce
  // nel calendario dell'agenzia. Non bloccante: l'errore non tocca la chat.
  await queueGCalSyncForCallback(pool, ins.rows[0].id, "create");
  return { fn: "fissa_callback", ok: true, detail: `callback ${slot} fissata` };
}

/* ── cerca_slot / prenota_appuntamento (CALENDAR HUB, migration 037) ── */

/** Consulta gli slot liberi REALI: turni + impegni esistenti. Sola lettura. */
async function toolCercaSlot(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  void ctx;
  const days = Math.min(Math.max(Number(args.giorni ?? 5), 1), 10);
  const minuti = Math.min(Math.max(Number(args.minuti ?? 30), 15), 120);
  const operatorId = str(args.operatore, 8) || null;  const slots: { starts_at: string; ends_at: string; operator_id: string | null; operator_name: string; assigned_ai: boolean }[] = await getFreeSlots({ days, durationMin: minuti, operatorId, limit: 6 });
  if (!slots.length) {
    return { fn: "cerca_slot", ok: true, detail: "nessuno slot libero nei prossimi giorni: proporre conferma manuale del team" };
  }
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("it-IT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
  const list = slots.map((s) => `${fmt(s.starts_at)} con ${s.operator_name}`).join(" · ");
  return { fn: "cerca_slot", ok: true, detail: `slot liberi: ${list}` };
}

/** Prenota SOLO su uno slot verificato (mai orari inventati): crea l'item + segue il lead. */
async function toolPrenotaAppuntamento(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const pool = db();
  if (!pool || !ctx.conversationId) return { fn: "prenota_appuntamento", ok: false, detail: "nessuna conversazione" };

  const when = str(args.slot, 40);
  const start = when ? new Date(when) : null;
  if (!start || Number.isNaN(start.getTime()) || start.getTime() < Date.now()) {
    return { fn: "prenota_appuntamento", ok: false, detail: "slot mancante o nel passato" };
  }
  const title = str(args.titolo, 120) ?? "Appuntamento (fissato da Ambrosio)";
  const minutes = Math.min(Math.max(Number(args.minuti ?? 30), 15), 120);
  const operatorId = str(args.operatore, 8) || null;

  // ANTI-DOUBLEBOOK: lo slot proposto deve essere ancora libero ORA (qualcuno
  // può averlo preso tra la consultazione e la conferma del cliente).
  const slots: { starts_at: string }[] = await getFreeSlots({ days: 14, durationMin: minutes, operatorId, limit: 50 });
  const stillFree = slots.some((s) => Math.abs(new Date(s.starts_at).getTime() - start.getTime()) < 60_000);
  if (!stillFree) {
    return { fn: "prenota_appuntamento", ok: false, detail: "slot non più libero: richiamare cerca_slot" };
  }

  const end = new Date(start.getTime() + minutes * 60_000);
  // Il lead della conversazione segue l'appuntamento (se esiste).
  const lead = await pool.query<{ lead_id: string | null }>("select lead_id from conversations where id = $1", [ctx.conversationId]);
  const r = await createCalendarItem(
    {
      kind: "appointment",
      title,
      starts_at: start,
      ends_at: end,
      operatorId,
      conversationId: ctx.conversationId,
      leadId: lead.rows[0]?.lead_id ?? null,
      notes: "prenotato da Ambrosio su slot verificato",
    },
    AI_ACTOR,
  );
  if (!r.ok) return { fn: "prenota_appuntamento", ok: false, detail: r.error ?? "errore" };
  return { fn: "prenota_appuntamento", ok: true, detail: `appuntamento ${title} prenotato ${start.toISOString()}` };
}

/* ── aggiorna_ticket ────────────────────────────────────────────── */

async function toolAggiornaTicket(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const pool = db();
  if (!pool || !ctx.conversationId) return { fn: "aggiorna_ticket", ok: false, detail: "nessuna conversazione" };

  const want = str(args.priorita, 20)?.toLowerCase() ?? null;
  const target = want ? PRIORITA_RAISE[want] : null;
  if (!target) return { fn: "aggiorna_ticket", ok: false, detail: `priorità non ammessa: ${want ?? "vuoto"} (solo alta/urgente)` };

  const cur = await pool.query<{ priority: string }>("select priority from conversations where id = $1", [ctx.conversationId]);
  const current = cur.rows[0]?.priority ?? "normale";
  if ((RANK[target] ?? 0) <= (RANK[current] ?? 1)) {
    return { fn: "aggiorna_ticket", ok: true, detail: `priorità ${current} già adeguata, non abbassata` };
  }

  // Stessa semantica dell'azione umana: la risoluzione si ricalcola;
  // il clock «prossima risposta» si riarma solo se la palla è al cliente.
  const last = await pool.query<{ last_sender: string | null }>(
    "select (select sender from messages where conversation_id = $1 order by created_at desc limit 1) as last_sender",
    [ctx.conversationId],
  );
  const due = slaDueFor(target, new Date());
  const armNext = last.rows[0]?.last_sender === "visitor";
  await pool.query(
    `update conversations set priority = $2, sla_resolve_due = $3
     ${armNext ? ", sla_next_reply_due = $4" : ", sla_next_reply_due = null"} where id = $1`,
    armNext ? [ctx.conversationId, target, due.resolveDue, due.nextReplyDue] : [ctx.conversationId, target, due.resolveDue],
  );
  await logAudit(AI_ACTOR, "ambrosio.aggiorna_ticket", ctx.conversationId, `priorità ${current} → ${target}`);
  return { fn: "aggiorna_ticket", ok: true, detail: `priorità ${current} → ${target}` };
}

/* ── nota_interna ───────────────────────────────────────────────── */

async function toolNotaInterna(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const pool = db();
  if (!pool || !ctx.conversationId) return { fn: "nota_interna", ok: false, detail: "nessuna conversazione" };

  const body = str(args.testo, 2000);
  if (!body) return { fn: "nota_interna", ok: false, detail: "nota vuota" };

  await pool.query("insert into ticket_notes (conversation_id, author_email, body) values ($1, $2, $3)", [
    ctx.conversationId,
    AI_ACTOR,
    body,
  ]);
  await logAudit(AI_ACTOR, "ambrosio.nota_interna", ctx.conversationId, body.slice(0, 120));
  return { fn: "nota_interna", ok: true, detail: "nota interna salvata per il team" };
}

/* ── handoff ────────────────────────────────────────────────────── */

async function toolHandoff(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const pool = db();
  if (!pool || !ctx.conversationId) return { fn: "handoff", ok: false, detail: "nessuna conversazione" };

  const reason = str(args.motivo, 300) ?? "richiesta del cliente";
  // Contesto portafoglio: se il lead della conversazione è un cliente noto,
  // l'agente che prende in carico apre il ticket sapendo GIÀ chi ha davanti
  // (quanti ticket, ultimi contatti) — senza cercare a mano tra le schede.
  let context = "";
  try {
    const known = await pool.query<{ summary: string | null }>(
      `select (
         select cl.name || coalesce(' (' || cl.company_name || ')', '')
             || ' — ' || (select count(*)::int from client_conversations cc where cc.client_id = cl.id)
             || ' ticket totali, ' || (select count(*)::int from client_conversations cc
                  join conversations c2 on c2.id = cc.conversation_id
                  where cc.client_id = cl.id and c2.status not in ('closed','on_hold','bot'))
             || ' aperti, ultimo contatto ' || to_char(cl.last_seen_at, 'DD month YYYY')
         from conversations c
         join leads l on l.id = c.lead_id
         join clients cl on cl.phone_e164 = l.wa_phone
         where c.id = $1 and l.wa_phone is not null
         limit 1
       ) as summary`,
      [ctx.conversationId],
    );
    if (known.rows[0]?.summary) context = ` — cliente noto: ${known.rows[0].summary}`;
  } catch {
    // Portafoglio assente: handoff normale, senza contesto (mai bloccante).
  }
  // Status operator = da prendere in carico al primo turno utile. Il motivo
  // finisce in ticket_notes (stesso posto delle note del team, visibile nel
  // dettaglio ticket): nessun campo extra sullo schema.
  // Update condizionale: la notifica al team parte SOLO sulla transizione
  // vera verso «operator» (se è già operator, un altro percorso ha già
  // suonato il campanello: nessun doppione nemmeno su ritenti concorrenti —
  // rowCount è la guardia, stesso pattern del claim del follow-up).
  const upd = await pool.query<{ number: number; channel: string; lead_name: string | null }>(
    `update conversations set status = 'operator' where id = $1 and status <> 'operator'
     returning number, channel, (select l.name from leads l where l.id = conversations.lead_id) as lead_name`,
    [ctx.conversationId],
  );
  await pool.query("insert into ticket_notes (conversation_id, author_email, body) values ($1, $2, $3)", [
    ctx.conversationId,
    AI_ACTOR,
    `[handoff Ambrosio] ${reason}${context}`,
  ]);
  await logAudit(AI_ACTOR, "ambrosio.handoff", ctx.conversationId, reason + context);
  // Campanello al team (email + Telegram): la AI non ce l'ha fatta, il caso
  // passa a uno umano. Fire-and-forget: non ritarda la risposta al cliente e
  // un fallimento non tocca l'handoff già avvenuto.
  if (upd.rows[0]) {
    void notifyHandoff({
      ticketId: ctx.conversationId,
      number: upd.rows[0].number,
      customerName: upd.rows[0].lead_name,
      reason: reason + context,
      channel: upd.rows[0].channel ?? "web",
      baseUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "",
    }).catch(() => {});
  }
  return { fn: "handoff", ok: true, detail: `handoff al team: ${reason}${context}` };
}

/* ── cerca_cliente (sola lettura, portafoglio clienti) ─────────── */

/**
 * Ambrosio riconosce un cliente già noto PRIMA di promettere o chiedere
 * da capo: match per telefono (normalizzato E.164), email o nome. Mai
 * bloccante, nessuna scrittura: il risultato finisce nella nota interna
 * / nell'handoff come contesto per l'agente umano.
 */
async function toolCercaCliente(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const pool = db();
  if (!pool) return { fn: "cerca_cliente", ok: false, detail: "db non configurato" };

  const rawPhone = str(args.telefono, 40);
  const rawEmail = str(args.email, 200);
  const rawName = str(args.nome, 100);
  if (!rawPhone && !rawEmail && !rawName) {
    return { fn: "cerca_cliente", ok: false, detail: "nessun criterio: serve telefono, email o nome" };
  }

  try {
    let hit: {
      id: string;
      name: string;
      company_name: string | null;
      ticket_count: number;
      open_tickets: number;
      last_seen_at: string;
    } | null = null;
    let how = "";

    // 1) Telefono (chiave più stabile): normalizzazione E.164 condivisa.
    if (rawPhone) {
      const e164 = toE164(rawPhone);
      if (e164) {
        const r = await pool.query<{
          id: string;
          name: string;
          company_name: string | null;
          ticket_count: number;
          open_tickets: number;
          last_seen_at: string;
        }>(
          `select cl.id, cl.name, cl.company_name,
                  (select count(*)::int from client_conversations cc where cc.client_id = cl.id) as ticket_count,
                  (select count(*)::int from client_conversations cc
                    join conversations c2 on c2.id = cc.conversation_id
                    where cc.client_id = cl.id and c2.status not in ('closed','on_hold','bot')) as open_tickets,
                  cl.last_seen_at
           from clients cl where cl.phone_e164 = $1`,
          [e164],
        );
        hit = r.rows[0] ?? null;
        how = `telefono ${e164}`;
      }
    }

    // 2) Email (chiave del canale email).
    if (!hit && rawEmail) {
      const norm = rawEmail.trim().toLowerCase();
      const r = await pool.query<{
        id: string;
        name: string;
        company_name: string | null;
        ticket_count: number;
        open_tickets: number;
        last_seen_at: string;
      }>(
        `select cl.id, cl.name, cl.company_name,
                (select count(*)::int from client_conversations cc where cc.client_id = cl.id) as ticket_count,
                (select count(*)::int from client_conversations cc
                  join conversations c2 on c2.id = cc.conversation_id
                  where cc.client_id = cl.id and c2.status not in ('closed','on_hold','bot')) as open_tickets,
                cl.last_seen_at
         from clients cl where cl.email_norm = $1`,
        [norm],
      );
      hit = r.rows[0] ?? null;
      how = `email ${norm}`;
    }

    // 3) Nome: match esatto case-insensitive (niente fuzzy: meglio un
    //    «non trovato» che un falso positivo pronunciato al cliente).
    if (!hit && rawName) {
      const r = await pool.query<{
        id: string;
        name: string;
        company_name: string | null;
        ticket_count: number;
        open_tickets: number;
        last_seen_at: string;
      }>(
        `select cl.id, cl.name, cl.company_name,
                (select count(*)::int from client_conversations cc where cc.client_id = cl.id) as ticket_count,
                (select count(*)::int from client_conversations cc
                  join conversations c2 on c2.id = cc.conversation_id
                  where cc.client_id = cl.id and c2.status not in ('closed','on_hold','bot')) as open_tickets,
                cl.last_seen_at
         from clients cl where lower(cl.name) = lower($1)`,
        [rawName.trim()],
      );
      hit = r.rows[0] ?? null;
      how = `nome «${rawName.trim()}»`;
    }

    if (!hit) {
      await logAudit(AI_ACTOR, "ambrosio.cerca_cliente", ctx.conversationId, `nessun match (${how})`);
      return { fn: "cerca_cliente", ok: true, detail: `nessun cliente nel portafoglio per ${how}` };
    }

    const seen = new Date(hit.last_seen_at).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
    const summary =
      `Cliente noto: ${hit.name}` +
      (hit.company_name ? ` (${hit.company_name})` : "") +
      ` — ${hit.ticket_count} ticket totali, ${hit.open_tickets} aperti, ultimo contatto ${seen}`;
    await logAudit(AI_ACTOR, "ambrosio.cerca_cliente", ctx.conversationId, summary);
    return { fn: "cerca_cliente", ok: true, detail: summary };
  } catch (e) {
    // Portafoglio non ancora migrato o DB in manutenzione: mai bloccante.
    return { fn: "cerca_cliente", ok: false, detail: e instanceof Error ? e.message : "errore ricerca" };
  }
}

/* ── prepara_proposta (L3): bozza di proposta/preventivo ────────── */

async function toolPreparaProposta(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const pool = db();
  if (!pool || !ctx.conversationId) return { fn: "prepara_proposta", ok: false, detail: "nessuna conversazione" };

  const title = str(args.titolo, PROPOSAL_TITLE_MAX);
  const body = str(args.testo, PROPOSAL_BODY_MAX);
  if (!title || !body) return { fn: "prepara_proposta", ok: false, detail: "titolo o testo mancante" };

  // Item dal formato «Voce|prezzo»: ripetibile, max 8 righe.
  const items: { label: string; price: string }[] = [];
  const rawItems = Array.isArray(args.item) ? args.item : args.item ? [args.item] : [];
  for (const it of rawItems.slice(0, 8)) {
    if (typeof it !== "string") continue;
    const [label, ...rest] = it.split("|");
    const price = rest.join("|").trim();
    if (label?.trim() && price) items.push({ label: label.trim().slice(0, 80), price: price.slice(0, 40) });
  }

  const id = await insertProposal({
    conversationId: ctx.conversationId,
    title: sanitizeProposalBody(title),
    body: sanitizeProposalBody(body),
    items,
    extras: { source: "ambrosio-tool", channel: "chat" },
  });
  if (!id) return { fn: "prepara_proposta", ok: false, detail: "insert proposta fallito" };
  await logAudit(AI_ACTOR, "ambrosio.prepara_proposta", id, `${title} (${items.length} voci) — bozza per revisione team`);
  return { fn: "prepara_proposta", ok: true, detail: `proposta in bozza salvata (${items.length} voci): il team la revisiona prima dell'invio` };
}

/* ── Fase 2: follow-up unico ai lead spariti ───────────────────── */

export interface FollowupContext {
  /** etichetta dell'operatore che prenderà il turno (per personalizzare il messaggio) */
  operatorName: string | null;
  /** lingua della conversazione (Fase 3): il follow-up parla la lingua del cliente */
  lang?: "it" | "en" | "de" | "fr" | "es";
}

/** Messaggio di follow-up, stesso tono di Ambrosio, niente pressione, nella lingua del cliente. */
export function followupText(ctx: FollowupContext): string {
  const who = ctx.operatorName ? `${ctx.operatorName} del team` : "Daniele o il team";
  switch (ctx.lang) {
    case "en": {
      const w = ctx.operatorName ? `${ctx.operatorName} from our team` : "Daniele or the team";
      return `Hi, Ambrosio here again 😊 Just checking in: have you had a chance to think about the project you told me about? If you like, ${w} can call you for a free, no-obligation chat — or just reply here whenever you prefer.`;
    }
    case "de": {
      const w = ctx.operatorName ? `${ctx.operatorName} aus unserem Team` : "Daniele oder das Team";
      return `Hallo, hier ist wieder Ambrosio 😊 Ich wollte nur nachfragen: Haben Sie sich schon Gedanken über Ihr Projekt gemacht? Wenn Sie möchten, ruft ${w} Sie gerne für ein unverbindliches Gespräch zurück — oder schreiben Sie mir einfach hier.`;
    }
    case "fr": {
      const w = ctx.operatorName ? `${ctx.operatorName} de notre équipe` : "Daniele ou l'équipe";
      return `Bonjour, c'est encore Ambrosio 😊 Je fais juste un petit rappel : avez-vous eu le temps de réfléchir à votre projet ? Si vous voulez, ${w} peut vous appeler pour un conseil sans engagement — ou répondez-moi ici quand vous préférez.`;
    }
    case "es": {
      const w = ctx.operatorName ? `${ctx.operatorName} del equipo` : "Daniele o el equipo";
      return `Hola, soy Ambrosio de nuevo 😊 Solo quería preguntar: ha tenido tiempo de pensar en su proyecto? Si quiere, ${w} puede llamarle para un consejo sin compromiso — o escríbame aquí cuando prefiera.`;
    }
    default:
      return (
        `Ciao, sono di nuovo Ambrosio 😊 Volevo solo chiudere il cerchio: ` +
        `hai avuto modo di pensare al progetto di cui mi avevi parlato? ` +
        `Se vuoi, ${who} può richiamarti per un consiglio senza impegno — ` +
        `oppure scrivimi pure qui quando preferisci.`
      );
  }
}

/**
 * Follow-up UNICO ai lead spariti: marca `followup_sent_at` e inserisce il
 * messaggio bot nel thread (il visitatore lo ritrova riaprendo la chat).
 * Prima il claim (UPDATE con `followup_sent_at is null` in WHERE: se due
 * tick corrono in parallelo uno solo vince), poi il messaggio. Se l'insert
 * fallisce, il claim viene rilasciato: il peggior caso è un follow-up non
 * partito, mai due messaggi (prima lo spam che il silenzio).
 *
 * Raggio anche il «follow-up ora» MANUALE del pannello (opts.manuale):
 * quell'invio scavalca SOLO il flag followup_disabled_at (l'esclusione
 * ferma l'automatismo, non la mano dell'operatore) ma MAI la dedup —
 * UN follow-up per ticket, da chiunque parta — e firma l'audit con
 * l'operatore invece di "system".
 */
export async function sendLeadFollowup(
  conversationId: string,
  ctx: FollowupContext,
  opts: { manuale?: boolean; actor?: string } = {},
): Promise<{ ok: boolean; detail: string }> {
  const pool = db();
  if (!pool) return { ok: false, detail: "db non configurato" };
  try {
    // Ri-controllo a ridosso dell'invio: tra la selezione del cron e questo
    // punto il visitatore potrebbe essere tornato a scrivere (o l'ultimo
    // messaggio potrebbe essere diventato nostro): non interrompere mai.
    const last = await pool.query<{ sender: string }>(
      "select sender from messages where conversation_id = $1 order by created_at desc limit 1",
      [conversationId],
    );
    if (last.rows[0]?.sender !== "visitor") {
      return { ok: false, detail: "l'ultima parola non è più del visitatore: follow-up annullato" };
    }
    // L'esclusione manuale (followup_disabled_at) ferma solo il CRON: un
    // invio esplicito dell'operatore la scavalca. La dedup followup_sent_at
    // invece vale SEMPRE: UN follow-up per ticket, da chiunque parta.
    const soloCron = opts.manuale ? "" : " and followup_disabled_at is null";
    const upd = await pool.query<{ number: number }>(
      `update conversations set followup_sent_at = now()
       where id = $1 and followup_sent_at is null${soloCron}
       returning number`,
      [conversationId],
    );
    if (upd.rows.length === 0) {
      return {
        ok: false,
        detail: opts.manuale
          ? "follow-up già inviato su questo ticket: UNO solo (dedup)"
          : "follow-up già inviato, escluso dall'operatore o thread non più idoneo (dedup)",
      };
    }
    try {
      // Fase 4: l'invio passa dal layer messaging (pattern a canali). Oggi la
      // conversazione è sempre 'web'; quando esisterà WhatsApp, il follow-up
      // business-initiated sarà bloccato lì dalla policy del canale.
      const conv = await pool.query<{ channel: string }>("select channel from conversations where id = $1", [conversationId]);
      const channel = isChannel(conv.rows[0]?.channel) ? conv.rows[0].channel : "web";
      if (!canSendFollowup(channel)) {
        return { ok: false, detail: `follow-up non lecito sul canale ${channel} (policy)` };
      }
      await adapterFor(channel).reply({ to: conversationId, body: followupText(ctx) });
    } catch (e) {
      // Insert fallito: rilascio il claim, il lead potrà essere seguito dopo.
      await pool.query("update conversations set followup_sent_at = null where id = $1", [conversationId]);
      throw e;
    }
    await logAudit(
      opts.manuale ? (opts.actor ?? "system") : "system",
      opts.manuale ? FOLLOWUP_NOW_AUDIT : "cron.lead-followup",
      String(upd.rows[0].number),
      opts.manuale ? "follow-up inviato a mano dall'operatore (pannello Ambrosio)" : "follow-up unico al lead sparito",
    );
    return { ok: true, detail: `follow-up inviato sul ticket #${upd.rows[0].number}` };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[ai-tools] followup:", detail);
    return { ok: false, detail };
  }
}

/** Esegue e restituisce i risultati (per la route: logging centralizzato). */
export async function runToolCall(call: ParsedTool, ctx: ToolContext): Promise<ToolResult> {
  // GATE PER LIVELLO: un tool fuori dalla lista del livello attivo non viene
  // eseguito MAI (nemmeno se il modello lo chiama): l'accesso è una proprietà
  // della configurazione, non della buona volontà del modello.
  if (!toolAllowedForLevel(call.fn)) {
    const res = { fn: call.fn, ok: false, detail: `funzione non ammessa al livello di autonomia attivo` };
    console.log(`[ambrosio:tool] ${res.fn} → BLOCCATO: ${res.detail}`);
    return res;
  }
  const res = await executeToolCall(call, ctx);
  console.log(`[ambrosio:tool] ${res.fn} → ${res.ok ? "OK" : "KO"}: ${res.detail}`);
  return res;
}

/** Verifica rapida per i test: la priorità è nella whitelist di raise? */
export function isRaiseOnly(p: string): boolean {
  return TICKET_PRIORITIES.includes(p as TicketPriority) && (RANK[p] ?? 0) >= RANK.alta;
}

/* ── Take-over SLA (step 11 del cron): Ambrosio subentra, L3 ─────── */

export interface TakeoverCandidate {
  id: string;
  number: number;
  language: string | null;
  lead_name: string | null;
  initial_query: string | null;
  service: string | null;
  budget: string | null;
  urgency: string | null;
}

/**
 * Prende i ticket con SLA «prossima risposta» SCADUTA, mai presi in carico
 * da Ambrosio (dedup: ai_takeover_at), dove l'ultimo messaggio è ancora del
 * visitatore. Il claim (UPDATE condizionato) è il lock anti-doppioni con
 * tick paralleli — convenzione del progetto (followup, callback, sync).
 */
export async function claimSlaTakeoverCandidates(limit = 3): Promise<TakeoverCandidate[]> {
  const pool = db();
  if (!pool) return [];
  try {
    const { rows } = await pool.query<TakeoverCandidate>(
      `update conversations c set ai_takeover_at = now()
       where c.id in (
         select c2.id from conversations c2
         where c2.sla_next_reply_due is not null
           and c2.sla_next_reply_due <= now()
           and c2.ai_takeover_at is null
           and c2.archived_at is null
           and c2.status not in ('closed', 'on_hold', 'bot')
           and (
             select m2.sender from messages m2
             where m2.conversation_id = c2.id
             order by m2.created_at desc limit 1
           ) = 'visitor'
         order by c2.sla_next_reply_due asc
         limit $1
       )
       returning c.id, c.number, c.language,
         (select l.name from leads l where l.id = c.lead_id) as lead_name,
         c.initial_query,
         (select l.service from leads l where l.id = c.lead_id) as service,
         (select l.budget from leads l where l.id = c.lead_id) as budget,
         (select l.urgency from leads l where l.id = c.lead_id) as urgency`,
      [String(Math.max(1, Math.min(10, Math.round(limit))))],
    );
    return rows;
  } catch (e) {
    // Colonna ai_takeover_at non ancora migrata: niente take-over, nessun errore.
    console.warn("[ai-tools] takeover candidates skip:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Marca il take-over come avvenuto (se l'annuncio non è partito, rilascia). */
export async function releaseTakeoverClaim(id: string): Promise<void> {
  const pool = db();
  if (!pool) return;
  try {
    await pool.query("update conversations set ai_takeover_at = null where id = $1", [id]);
  } catch {
    /* mai bloccante */
  }
}

/* ── Fase 5: statistiche dei tool per lingua e canale ───────────── */

export interface ToolUsageStats {
  days: number;
  /** Totale per funzione (lead salvati, callback fissate…) su tutte le lingue/canali. */
  totals: { fn: string; n: number }[];
  /** Ripartizione per lingua e funzione (solo lingue con almeno un'azione). */
  byLanguage: { lang: string; fn: string; n: number }[];
  /** Ripartizione per canale e funzione (web è oggi l'unico con dati). */
  byChannel: { channel: string; fn: string; n: number }[];
}

const TOOL_ACTIONS: Record<string, string> = {
  "ambrosio.salva_lead": "salva_lead",
  "ambrosio.fissa_callback": "fissa_callback",
  "ambrosio.aggiorna_ticket": "aggiorna_ticket",
  "ambrosio.nota_interna": "nota_interna",
  "ambrosio.handoff": "handoff",
  "ambrosio.cerca_cliente": "cerca_cliente",
  "ambrosio.prepara_proposta": "prepara_proposta",
};

/**
 * Statistiche d'uso dei tool di Ambrosio (Fase 5). Fonte: audit log
 * (append-only, già scritto da ogni azione eseguita) incrociato con
 * conversations per lingua e canale — nessuna nuova tabella da tenere
 * allineata. La lingua/canale è quella della conversazione al momento
 * della consultazione: per i propositi di questa dashboard è corretto.
 */
export async function getToolUsageStats(days = 30): Promise<ToolUsageStats> {
  const pool = db();
  const empty: ToolUsageStats = { days, totals: [], byLanguage: [], byChannel: [] };
  if (!pool) return empty;
  try {
    const { rows } = await pool.query<{
      fn: string;
      lang: string | null;
      channel: string | null;
      n: number;
    }>(
      `select a.action as fn,
              c.language as lang,
              c.channel  as channel,
              count(*)::int as n
       from audit_log a
       left join conversations c on c.id::text = a.target
       where a.actor = 'ambrosio@ai'
         and a.action = any($1)
         and a.created_at > now() - ($2 || ' days')::interval
       group by a.action, c.language, c.channel`,
      [Object.keys(TOOL_ACTIONS), String(Math.max(1, Math.round(days)))],
    );
    const totalsMap = new Map<string, number>();
    const byLanguage: ToolUsageStats["byLanguage"] = [];
    const byChannel: ToolUsageStats["byChannel"] = [];
    for (const r of rows) {
      const fn = TOOL_ACTIONS[r.fn] ?? r.fn;
      totalsMap.set(fn, (totalsMap.get(fn) ?? 0) + r.n);
      byLanguage.push({ lang: r.lang ?? "it", fn, n: r.n });
      byChannel.push({ channel: r.channel ?? "web", fn, n: r.n });
    }
    return {
      days,
      totals: [...totalsMap.entries()].map(([fn, n]) => ({ fn, n })).sort((a, b) => b.n - a.n),
      byLanguage: byLanguage.sort((a, b) => b.n - a.n),
      byChannel: byChannel.sort((a, b) => b.n - a.n),
    };
  } catch (e) {
    console.error("[ai-tools] stats:", e);
    return empty;
  }
}
