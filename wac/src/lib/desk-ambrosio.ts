/**
 * PANNELLO AMBROSIO DEL DESK (Fase 3 del ridisegno ticketing): contesto
 * AI per la scheda ticket — riepilogo del filo, risposta suggerita,
 * classifica, e la "verità" dell'auto-pilota (le impronte REALI che
 * Ambrosio ha lasciato sulla conversazione: takeover e follow-up).
 *
 * Regole del progetto rispettate:
 *  - l'AI NON scrive mai da sola: le azioni dall'utente passano dall'audit
 *    (ambrosio.desk.*) e la risposta suggerita FINISCE NEL COMPOSER dove
 *    l'operatore la edita e la firma lui;
 *  - tutto degradabile: senza chiavi AI (getAiSettings assente/spenta) il
 *    pannello dice «spento» invece di rompere la scheda;
 *  - i prompt leggono SOLO i dati della conversazione (filo, lead, cliente)
 *    e le FAQ ufficiali restano la conoscenza: stessa fonte di Ambrosio live.
 */
import { db } from "./db";
import { logAudit } from "./audit";
import {
  getAiSettings,
  providerChain,
  callProvider,
  getAiFaqs,
  AiNotConfiguredError,
  type AiProvider,
} from "./ai";
import { autopilotaEsito, autopilotaPlan, followupEsito, followupPlan, followupNowConsentibile, FOLLOWUP_NOW_AUDIT } from "./desk-autopilota-shared";
import { sendLeadFollowup } from "./ai-tools";
import { loadOperators } from "./server-context";
import { onDutyOperator, nowInRome } from "./operators";
import type { Lang } from "./language";

/** Le FAQ servono al blocco di conoscenza: stessa fonte di ambrosioReply. */
async function faqKnowledgeBlock(): Promise<string> {
  try {
    const faqs = await getAiFaqs();
    if (!faqs.length) return "";
    const righe = faqs.slice(0, 25).map((f) => `- Q: ${f.question}\n  A: ${f.answer}`);
    return `\nCONOSCENZA UFFICIALE (usa SOLO queste informazioni per prezzi, tempi, policy):\n${righe.join("\n")}\n`;
  } catch {
    return "";
  }
}

export interface DeskAmbrosioContext {
  ticket: {
    number: number;
    initial_query: string | null;
    status: string;
    priority: string;
    channel: string | null;
    created_at: string;
  };
  /** Filo della conversazione in ordine cronologico (ruolo + testo). */
  messages: { sender: string; body: string; created_at: string }[];
  lead: {
    name: string | null;
    phone: string | null;
    service: string | null;
    urgency: string | null;
    budget: string | null;
    notes: string | null;
  } | null;
  /** La scheda cliente abbinata dal sync portafoglio, se c'è. */
  client: {
    id: string;
    name: string;
    client_type: string | null;
    company_name: string | null;
    ticket_count: number;
    budget_total: number | null;
    notes: string | null;
  } | null;
  /** Le impronte AI reali: takeover SLA e follow-up già inviati, più il flag di esclusione del follow-up. */
  ambrosio: { takeover: boolean; followup: boolean; followupDisabled: boolean };
}

/**
 * Tutto il contesto che il pannello mostra (e che i prompt usano):
 * UNA round-trip, nessun dato inventato.
 */
export async function getDeskContext(conversationId: string): Promise<DeskAmbrosioContext | null> {
  const pool = db();
  if (!pool) return null;
  const { rows } = await pool.query<{
    number: number;
    initial_query: string | null;
    status: string;
    priority: string;
    channel: string | null;
    created_at: string;
    ai_takeover_at: string | null;
    followup_sent_at: string | null;
    followup_disabled_at: string | null;
  }>(
    `select number, initial_query, status, priority, channel, created_at, ai_takeover_at, followup_sent_at, followup_disabled_at
     from conversations where id = $1`,
    [conversationId],
  );
  const t = rows[0];
  if (!t) return null;

  const [msgs, leadRows, clientRows] = await Promise.all([
    pool.query<{ sender: string; body: string; created_at: string }>(
      `select sender, body, created_at from messages where conversation_id = $1 order by created_at asc`,
      [conversationId],
    ),
    pool.query<{ name: string; phone: string; service: string | null; urgency: string | null; budget: string | null; notes: string | null }>(
      `select l.name, l.phone, l.service, l.urgency, l.budget, l.notes
       from conversations c join leads l on l.id = c.lead_id where c.id = $1`,
      [conversationId],
    ),
    pool.query<{ id: string; name: string; client_type: string | null; company_name: string | null; ticket_count: number; budget_total: number | null; notes: string | null }>(
      `select cl.id, cl.name, cl.client_type, cl.company_name, cl.notes,
              (select count(*)::int from client_conversations cc2 where cc2.client_id = cl.id) as ticket_count,
              (select sum((x->>'v')::numeric)::float from (
                 select jsonb_array_elements(cm.value->'budgets') as x
                 from client_meta cm where cm.client_id = cl.id
               ) b) as budget_total
       from client_conversations cc join clients cl on cl.id = cc.client_id
       where cc.conversation_id = $1 limit 1`,
      [conversationId],
    ),
  ]);

  return {
    ticket: {
      number: t.number,
      initial_query: t.initial_query,
      status: t.status,
      priority: t.priority,
      channel: t.channel,
      created_at: t.created_at,
    },
    messages: msgs.rows,
    lead: leadRows.rows[0] ?? null,
    client: clientRows.rows[0] ?? null,
    ambrosio: { takeover: t.ai_takeover_at != null, followup: t.followup_sent_at != null, followupDisabled: t.followup_disabled_at != null },
  };
}

function filoText(ctx: DeskAmbrosioContext): string {
  return ctx.messages
    .slice(-20)
    .map((m) => `[${m.sender === "visitor" ? "CLIENTE" : m.sender === "operator" ? "TEAM" : m.sender.toUpperCase()}] ${m.body}`)
    .join("\n");
}

async function deskCall(
  system: string,
  user: string,
): Promise<{ text: string; usedProvider: AiProvider; fallbacksTried: AiProvider[] }> {
  const settings = await getAiSettings();
  if (!settings || !settings.enabled) throw new AiNotConfiguredError("ai_disabilitata");
  const chain = await providerChain(settings.provider);
  if (chain.length === 0) throw new AiNotConfiguredError("chiave_mancante");
  const knowledge = await faqKnowledgeBlock();
  const fallbacksTried: AiProvider[] = [];
  for (const cred of chain) {
    try {
      const reply = await callProvider(cred, {
        system: system + knowledge,
        turns: [{ role: "user", content: user }],
        temperature: 0.3,
      });
      if (reply && reply.trim()) return { text: reply.trim(), usedProvider: cred.provider, fallbacksTried };
      fallbacksTried.push(cred.provider);
    } catch (e) {
      console.error("[desk-ambrosio] provider", cred.provider, ":", e instanceof Error ? e.message : e);
      fallbacksTried.push(cred.provider);
    }
  }
  throw new AiNotConfiguredError("nessun_provider_disponibile");
}

/** Riepilogo del filo per l'operatore che apre il ticket adesso. */
export async function deskRiepilogo(ctx: DeskAmbrosioContext): Promise<{ text: string; usedProvider: AiProvider; fallbacksTried: AiProvider[] }> {
  return deskCall(
    [
      "Sei Ambrosio, assistente interno del team di Web Agency Crema.",
      "Riassumi la conversazione per un OPERATORE che la apre adesso. Massimo 5 punti.",
      "Per ogni punto: fatti rilevanti, richieste concrete, impegni presi, prossimo passo.",
      "Non inventare nulla: solo ciò che è nel filo e nel contesto. Tono asciutto, italiano.",
    ].join("\n"),
    `TICKET #${ctx.ticket.number} «${ctx.ticket.initial_query ?? "senza query"}» (canale ${ctx.ticket.channel ?? "web"}, stato ${ctx.ticket.status}, priorità ${ctx.ticket.priority})\n` +
      (ctx.lead ? `LEAD: ${ctx.lead.name} · ${ctx.lead.phone} · ${[ctx.lead.service, ctx.lead.urgency, ctx.lead.budget].filter(Boolean).join(" / ") || "nessun dettaglio"}\n` : "") +
      (ctx.client ? `CLIENTE NOTO: ${ctx.client.name}${ctx.client.company_name ? ` (${ctx.client.company_name})` : ""} · ${ctx.client.ticket_count} ticket nel portafoglio\n` : "") +
      `FILO:\n${filoText(ctx)}`,
  );
}

/** Risposta suggerita: testo pronto da iniettare nel composer (l'operatore edita e firma). */
export async function deskRisposta(ctx: DeskAmbrosioContext): Promise<{ text: string; usedProvider: AiProvider; fallbacksTried: AiProvider[] }> {
  const ultimoCliente = [...ctx.messages].reverse().find((m) => m.sender === "visitor");
  return deskCall(
    [
      "Sei Ambrosio di Web Agency Crema. Scrivi la BOZZA della risposta al cliente:",
      "la firmerà un umano che la edita prima dell'invio.",
      "Regole: italiano, tono professionale e caldo, concreto, massimo 120 parole.",
      "Rispondi SOLO con il testo della risposta (niente preamboli, niente virgolette).",
      "Prezzi e policy SOLO se presenti nella conoscenza ufficiale: mai inventare.",
    ].join("\n"),
    `TICKET #${ctx.ticket.number} «${ctx.ticket.initial_query ?? ""}»\n` +
      (ctx.lead?.budget ? `Budget dichiarato dal cliente: ${ctx.lead.budget}\n` : "") +
      `FILO:\n${filoText(ctx)}\n\n` +
      (ultimoCliente ? `L'ULTIMO messaggio del cliente è: «${ultimoCliente.body.slice(0, 600)}»` : ""),
  );
}

/** Classifica: priorità, stato suggerito e perché — propose, mai scritture. */
export async function deskClassifica(ctx: DeskAmbrosioContext): Promise<{ text: string; usedProvider: AiProvider; fallbacksTried: AiProvider[] }> {
  return deskCall(
    [
      "Sei Ambrosio, triagista interno di Web Agency Crema.",
      "Proponi la CLASSIFICA del ticket in ESATTAMENTE tre righe:",
      "PRIORITÀ: normale | alta | urgente",
      "STATO: operator | waiting_customer | on_hold",
      "PERCHÉ: una frase.",
      "Nessun altro testo.",
    ].join("\n"),
    `TICKET #${ctx.ticket.number} «${ctx.ticket.initial_query ?? ""}» — canale ${ctx.ticket.channel ?? "web"}, stato attuale ${ctx.ticket.status}, priorità attuale ${ctx.ticket.priority}\n` +
      (ctx.lead ? `LEAD: ${[ctx.lead.name, ctx.lead.service, ctx.lead.urgency, ctx.lead.budget].filter(Boolean).join(" · ") || "qualificazione incompleta"}\n` : "") +
      (ctx.client ? `CLIENTE NOTO: ${ctx.client.name} · ${ctx.client.ticket_count} ticket · tipo ${ctx.client.client_type ?? "da classificare"}\n` : "") +
      `FILO:\n${filoText(ctx)}`,
  );
}

/**
 * Toggle MANUALE dell'auto-pilota sull'aperto: l'operatore decide se Ambrosio
 * risponde al posto del team. Attiva = ai_takeover_at = now() (la STESSA
 * impronta del take-over SLA del cron), disattiva = null (come
 * releaseTakeoverClaim). L'UPDATE condizionato ad archived_at is null è il
 * lock anti-corsa col cron: niente takeover su ticket archiviati. Audit
 * sempre: ambrosio.desk.autopilota_on / ambrosio.desk.autopilota_off.
 *
 * Il piano (SQL col lock, parametri, azione d'audit) e la lettura dell'esito
 * vivono in desk-autopilota-shared.ts, modulo puro verificato dalla
 * sentinella tests/desk-autopilota.test.mjs senza DB né AI.
 */
export async function deskSetAutopilota(
  conversationId: string,
  actor: string,
  attiva: boolean,
): Promise<{ ok: true; takeover: boolean } | { ok: false; reason: string }> {
  const pool = db();
  if (!pool) return { ok: false, reason: "db_non_disponibile" };
  const piano = autopilotaPlan(attiva, conversationId);
  try {
    const { rows } = await pool.query<{ ai_takeover_at: Date | string | null }>(piano.sql, piano.params);
    const esito = autopilotaEsito(rows);
    if (!esito.ok) return { ok: false, reason: esito.reason };
    await logAudit(actor, piano.auditAction, conversationId, esito.auditDetail);
    return { ok: true, takeover: esito.takeover };
  } catch (e) {
    // Colonna non ancora migrata o DB lontano: il pannello lo dice, senza 500.
    const reason = e instanceof Error ? e.message : "errore_db";
    return { ok: false, reason };
  }
}

/**
 * Toggle del follow-up automatico sul SINGOLO ticket: l'operatore lo esclude
 * (followup_disabled_at = now()) o lo riattiva (flag a null). L'impronta
 * followup_sent_at non è MAI toccata: disattivare non riarma il cron, la
 * dedup standard resta la verità. Lock anti-corsa archived_at is null,
 * audit ambrosio.desk.followup_off / ambrosio.desk.followup_on.
 */
export async function deskSetFollowupAuto(
  conversationId: string,
  actor: string,
  attiva: boolean,
): Promise<{ ok: true; followupDisabled: boolean } | { ok: false; reason: string }> {
  const pool = db();
  if (!pool) return { ok: false, reason: "db_non_disponibile" };
  const piano = followupPlan(attiva, conversationId);
  try {
    const { rows } = await pool.query<{ followup_disabled_at: Date | string | null }>(piano.sql, piano.params);
    const esito = followupEsito(rows);
    if (!esito.ok) return { ok: false, reason: esito.reason };
    await logAudit(actor, piano.auditAction, conversationId, esito.auditDetail);
    return { ok: true, followupDisabled: esito.followupDisabled };
  } catch (e) {
    // Colonna non ancora migrata o DB lontano: il pannello lo dice, senza 500.
    const reason = e instanceof Error ? e.message : "errore_db";
    return { ok: false, reason };
  }
}

/**
 * «Invia follow-up ora»: l'operatore fa partire ADESSO il follow-up di
 * Ambrosio nel thread. Il verdetto di consenso è PURO (followupNowConsentibile:
 * dedup, chiuso, bot, ultima parola), l'invio passa dalla STESSA pipeline del
 * cron (policy di canale, testo, release su fallimento) in modalità manuale —
 * che scavalca solo il flag di esclusione, mai la dedup — e l'audit di
 * successo (ambrosio.desk.followup_now) porta il nome dell'operatore. Il
 * fallimento lo registro qui, col ticket come target.
 */
export async function deskFollowupNow(
  conversationId: string,
  actor: string,
): Promise<{ ok: true; detail: string } | { ok: false; reason: string; bloccato: boolean }> {
  const pool = db();
  if (!pool) return { ok: false, reason: "db_non_disponibile", bloccato: false };
  try {
    const info = await pool.query<{ status: string; language: string | null; followup_sent_at: string | null }>(
      "select status, language, followup_sent_at from conversations where id = $1",
      [conversationId],
    );
    const t = info.rows[0];
    if (!t) return { ok: false, reason: "ticket_non_trovato", bloccato: false };
    const last = await pool.query<{ sender: string | null }>(
      "select sender from messages where conversation_id = $1 order by created_at desc limit 1",
      [conversationId],
    );
    const verdetto = followupNowConsentibile({
      followupSent: t.followup_sent_at != null,
      lastSender: last.rows[0]?.sender ?? null,
      status: t.status,
    });
    if (!verdetto.consentito) return { ok: false, reason: verdetto.motivo, bloccato: true };
    // Nome dell'operatore del prossimo turno per personalizzare il messaggio
    // (stessa meccanica del cron): mai bloccante.
    let who: string | null = null;
    try {
      const ops = await loadOperators();
      who = (onDutyOperator(ops, nowInRome()) ?? ops[0])?.firstName ?? null;
    } catch {
      who = null;
    }
    const r = await sendLeadFollowup(conversationId, { operatorName: who, lang: (t.language ?? "it") as Lang }, { manuale: true, actor });
    if (!r.ok) {
      await logAudit(actor, FOLLOWUP_NOW_AUDIT, conversationId, `fallito: ${r.detail}`);
      return { ok: false, reason: r.detail, bloccato: false };
    }
    return { ok: true, detail: r.detail };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "errore_db";
    return { ok: false, reason, bloccato: false };
  }
}

/** Azione del pannello: audit sempre (ambrosio.desk.*), mai scritture sul ticket. */
export async function deskAmbrosioAction(
  action: "riepilogo" | "risposta" | "classifica",
  conversationId: string,
  actor: string,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const ctx = await getDeskContext(conversationId);
  if (!ctx) return { ok: false, reason: "ticket_non_trovato" };
  try {
    const res =
      action === "riepilogo"
        ? await deskRiepilogo(ctx)
        : action === "risposta"
          ? await deskRisposta(ctx)
          : await deskClassifica(ctx);
    await logAudit(actor, `ambrosio.desk.${action}`, conversationId, `provider ${res.usedProvider}${res.fallbacksTried.length ? `, fallback ${res.fallbacksTried.join(">")}` : ""}`);
    return { ok: true, text: res.text };
  } catch (e) {
    // AiNotConfiguredError porta il motivo nel messaggio ("ai_disabilitata",
    // "chiave_mancante", "nessun_provider_disponibile"): il pannello lo
    // mostra all'operatore invece di un errore secco.
    const reason = e instanceof Error ? e.message : "errore";
    await logAudit(actor, `ambrosio.desk.${action}`, conversationId, `fallito: ${reason}`);
    return { ok: false, reason };
  }
}
