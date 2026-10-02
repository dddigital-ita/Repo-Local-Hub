/**
 * IL CERVELLO DI AMBROSIO — un turno di conversazione, indipendente dal canale.
 *
 * Estratto da /api/chat/ai (web chat) perché Telegram fa esattamente le stesse
 * cose: gate di autonomia, tetto mosse con handoff, raccolta lead dal testo
 * libero, tool calls, rete di sicurezza L3, persistenza del messaggio bot.
 * La route web e il webhook Telegram chiamano QUESTA funzione: il comportamento
 * cambia solo per cosa c'è attorno (Shield/rate-limit lato web, dedup update
 * lato Telegram), non per come si decide la risposta.
 *
 * Il fallback «sessione fantasma» del percorso web (no_conversation) qui non
 * esiste: chi crea la conversazione la crea PERSISTITA prima di chiamare.
 */
import { db } from "@/lib/db";
import { ambrosioReply, AiNotConfiguredError, type AiTurn } from "@/lib/ai";
import { getAiSettings } from "@/lib/ai";
import { extractPhone, extractName, extractConsent } from "@/lib/lead-extract";
import { notifyOperator } from "@/lib/notify";
import { buildChatContext, onDutyOperator } from "@/lib/server-context";
import { nowInRome } from "@/lib/operators";
import { runToolCall, setToolLevel } from "@/lib/ai-tools";
import { getAutonomyConfig, botAnswerCount, insertProposal, hasProposalForConversation } from "@/lib/ambrosio-server";
import { movesDecision } from "@/lib/ambrosio-autonomy";
import { detectLanguage, type Lang } from "@/lib/language";
import { toE164 } from "@/lib/messaging";

export interface AmbrosioTurnResult {
  ok: boolean;
  /** La risposta da mostrare (chiusura handoff compresa). Assente se !ok. */
  reply?: string;
  handoff?: boolean;
  leadSaved?: boolean;
  /** Errore solo peragnostico (log/telemetria), mai mostrato al cliente. */
  error?: "ai_off" | "empty" | "provider_error" | AiNotConfiguredError;
}

/**
 * Raccolta lead fuori turno (nome + telefono + consenso dal testo libero).
 * Usata sul percorso normale E prima dell'handoff forzato del tetto mosse:
 * se il cliente dà i contatti nell'ultimo messaggio utile, il lead non si
 * perde dietro il passaggio al team. Restituisce il nome salvato, o null.
 */
export async function tryCaptureLead(opts: {
  conversationId: string;
  question: string;
  context?: Record<string, string>;
}): Promise<string | null> {
  const pool = db();
  if (!pool) return null;
  try {
    const ctxRows = await pool.query<{ lead_id: string | null }>(
      "select lead_id from conversations where id = $1",
      [opts.conversationId],
    );
    if (ctxRows.rows[0]?.lead_id) return null; // lead già presente: nessun duplicato

    const name = extractName(opts.question) ?? (opts.context?.name ? String(opts.context.name) : null);
    const phone = extractPhone(opts.question);
    const consent = extractConsent(opts.question) ?? (opts.context?.consent === "true" ? true : null);
    if (!name || !phone || consent !== true) return null;

    const phoneE164 = toE164(phone);
    const ins = await pool.query<{ id: string }>(
      `insert into leads (conversation_id, name, phone, service, urgency, existing_site, budget,
                          consent, status, initial_query, source_page, source, wa_phone)
       values ($1,$2,$3,$4,$5,$6,$7, true, 'nuovo', $8, $9, 'ai', $10)
       returning id`,
      [
        opts.conversationId,
        name.slice(0, 80),
        phone,
        opts.context?.service ?? null,
        opts.context?.urgency ?? null,
        opts.context?.existingSite ?? null,
        opts.context?.budget ?? null,
        opts.context?.query ?? null,
        opts.context?.sourcePage ?? null,
        phoneE164,
      ],
    );
    await pool.query("update conversations set lead_id = $2, status = 'lead_captured' where id = $1", [
      opts.conversationId,
      ins.rows[0].id,
    ]);
    // Notifica al team (email/Telegram se configurati) con l'operatore del prossimo turno
    try {
      const now = nowInRome();
      const ctx = await buildChatContext(String(opts.context?.query ?? ""), now);
      const next = onDutyOperator(ctx.operators, now) ?? ctx.operators[0];
      await notifyOperator({
        name: name.slice(0, 80),
        phone,
        service: opts.context?.service ?? undefined,
        urgency: opts.context?.urgency ?? undefined,
        budget: opts.context?.budget ?? undefined,
        existingSite: opts.context?.existingSite ?? undefined,
        query: opts.context?.query ?? undefined,
        sourcePage: opts.context?.sourcePage ?? undefined,
        operatorName: next?.firstName,
        operatorPhone: next?.phone,
      });
    } catch (e) {
      console.error("[ambrosio-turn] notifica lead AI:", e);
    }
    return name.slice(0, 80);
  } catch (e) {
    console.error("[ambrosio-turn] estrazione lead:", e);
    return null;
  }
}

/**
 * RETE DI SICUREZZA L3: con modelli piccoli capita che la proposta venga
 * scritta SOLO in chat, senza chiamare `prepara_proposta` — e per il team
 * non esiste nessuna bozza. Se il take-over SLA è attivo e la risposta
 * contiene prezzi come testo, la bozza la crea comunque qui (dedup: una
 * proposta per conversazione). Mai bloccante.
 */
export async function safetyNetProposal(
  conversationId: string,
  level: number,
  takeoverSla: boolean,
  reply: string,
): Promise<void> {
  if (level < 3 || !takeoverSla) return;
  if (await hasProposalForConversation(conversationId)) return;
  // Un preventivo «scritto in chat» riconoscibile: voci con importi (€) e
  // almeno 2 righe. Testi senza cifre non producono bozze fittizie.
  const priceLines = reply
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /\d[\d.,]*\s*€|€\s*\d/.test(l))
    .slice(0, 8);
  if (priceLines.length < 2) return;
  const items = priceLines.map((l) => {
    // Etichetta = testo prima dell'importo (senza markdown/bullet), prezzo = match.
    const pm = l.match(/(\d[\d.,]*\s*€|€\s*\d[\d.,]*)/);
    let label = l
      .slice(0, pm?.index ?? l.length)
      .replace(/[:|—-]+\s*$/, "")
      .replace(/\*\*/g, "")
      .replace(/^[\-•*\s]+/, "")
      .trim();
    if (!label) label = l.replace(/\*\*/g, "").trim().slice(0, 60) || "Voce";
    return { label: label.slice(0, 80), price: (pm?.[1] ?? "—").slice(0, 40) };
  });
  await insertProposal({
    conversationId,
    title: `Bozza automatica — proposta discussa in chat`,
    body: reply.slice(0, 4000),
    items,
    extras: { source: "safety_net_l3" },
  });
}

/**
 * Un turno completo: risponde come Ambrosio alla domanda del visitatore
 * dentro la conversazione (già persistita e impostata a canale giusto).
 * L'ordine delle fasi è IDENTICO a quello della route web da cui è estratto.
 */
export async function handleAmbrosioTurn(opts: {
  conversationId: string;
  question: string;
  /** Contesto qualificazione già raccolto (il client web lo manda; Telegram non ce l'ha). */
  context?: Record<string, string>;
}): Promise<AmbrosioTurnResult> {
  const { conversationId, question } = opts;
  if (!question.trim()) return { ok: false, error: "empty" };

  const settings = await getAiSettings();
  if (!settings?.enabled) return { ok: false, error: "ai_off" };

  /* ── AUTONOMIA: gate del livello e tetto mosse ────────────────
     A L1/L2, se Ambrosio ha già esaurito il tetto di mosse sulla
     conversazione, non risponde e passa il turno al team (handoff
     forzato). L3 non ha tetto: al suo posto parliamo di take-over SLA. */
  const auto = await getAutonomyConfig();
  // Il livello attivo DEVE valere anche per l'handoff forzato del gate qui
  // sotto: prima setToolLevel era dopo, e l'handoff a tetto raggiunto parte-
  // va col default L1 → bloccato dal gate (audit vuoto, mai status operator).
  setToolLevel(auto.level);
  const pool = db();
  if (auto.level < 3) {
    const answers = await botAnswerCount(conversationId);
    const md = movesDecision(answers, auto.movesCap);
    if (!md.allowed) {
      // Prima di passare il turno: se l'ultimo messaggio contiene nome,
      // telefono e consenso, il lead va salvato ORA (prima dell'handoff,
      // che cambia stato e chiuderebbe la finestra di raccolta).
      const capturedName = await tryCaptureLead({ conversationId, question, context: opts.context });

      // Handoff forzato una volta sola: il claim è lo stesso update di stato.
      let alreadyHanded = false;
      if (pool) {
        try {
          const st = await pool.query<{ status: string }>("select status from conversations where id = $1", [conversationId]);
          alreadyHanded = st.rows[0]?.status === "operator";
        } catch {}
      }
      if (!alreadyHanded) {
        await runToolCall({ fn: "handoff", args: { motivo: `tetto mosse raggiunto (${md.used}/${md.cap}): Ambrosio passa il turno al team` } }, { conversationId });
      }
      // Messaggio di chiusura nel thread: il cliente non resta a chiacchiare
      // con un muro. Se abbiamo appena salvato il lead, la chiusura si
      // personalizza: niente «lasciami nome e numero» a chi lo ha già dato.
      const closing = capturedName
        ? `Grazie ${capturedName}: ho registrato i tuoi contatti e garantisco la richiamata. Un collega del team prenderà in carico la conversazione al primo turno utile.`
        : "A questo punto ti metto in contatto con una persona vera: un collega del team prenderà in carico la conversazione al primo turno utile. Se vuoi, lasciami nome e numero e garantisco la richiamata.";
      if (pool) {
        try {
          await pool.query(
            "insert into messages (conversation_id, sender, body) values ($1, 'bot', $2)",
            [conversationId, closing],
          );
        } catch {}
      }
      return { ok: true, reply: closing, leadSaved: Boolean(capturedName), handoff: true };
    }
  }

  // Storico recente della conversazione per continuità
  const turns: AiTurn[] = [];
  if (pool) {
    try {
      const { rows } = await pool.query<{ sender: string; body: string }>(
        "select sender, body from messages where conversation_id = $1 order by created_at desc limit 8",
        [conversationId],
      );
      for (const m of rows.reverse()) {
        // La domanda corrente è già passata nel body: evitiamo il doppione
        if (m.sender === "visitor" && m.body.trim() === question.trim()) continue;
        if (m.sender === "visitor") turns.push({ role: "user", content: m.body });
        else if (m.sender === "operator" || m.sender === "bot") turns.push({ role: "assistant", content: m.body });
      }
    } catch {
      /* storico facoltativo */
    }
  }

  // Contesto qualificazione già raccolta (serve ad Ambrosio per non ricominciare da zero)
  const ctxLines = Object.entries(opts.context ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);
  const userMsg = ctxLines.length
    ? `[Contesto già raccolto — ${ctxLines.join("; ")}]\n\nDomanda del visitatore: ${question.trim()}`
    : question.trim();
  turns.push({ role: "user", content: userMsg });

  /* ── Lingua del cliente (sticky per conversazione) ────────────
     Rilevata dalla risposta del cliente e salvata su conversations;
     resta per tutto il thread (mentre è 'it' si aggiorna se cambia). */
  let lang: Lang = "it";
  if (pool) {
    try {
      const lr = await pool.query<{ language: string }>("select language from conversations where id = $1", [conversationId]);
      const stored = (lr.rows[0]?.language ?? "it") as Lang;
      lang = stored;
      if (stored === "it") {
        const detected = detectLanguage(question);
        if (detected !== "it") {
          lang = detected;
          await pool.query("update conversations set language = $2 where id = $1", [conversationId, detected]);
        }
      }
    } catch {
      lang = "it";
    }
  }

  try {
    const ai = await ambrosioReply(turns, conversationId, { lang });
    const reply = ai.reply;
    if (!reply) return { ok: false, error: "empty" };

    /* ── Raccolta lead fuori turno ────────────────────────────────
       Mentre Ambrosio conversa, se dal testo libero emergono nome e
       telefono (e consenso) salviamo SUBITO il lead con source='ai':
       di notte non aspettiamo lo script. */

    /* ── Raccolta lead PRIMA dei tool: se il cliente ha appena dato nome,
       telefono e consenso nello stesso messaggio in cui il modello chiama
       fissa_callback, la callback DEVE trovare il lead già salvato (sul vivo
       l'ordine inverso la negava con «nessun lead con consenso»). */
    let leadSaved = false;
    if (pool) {
      leadSaved = Boolean(await tryCaptureLead({ conversationId, question, context: opts.context }));
    }

    /* ── Esecuzione dell'azione richiesta (tool use) ──────────────
       Dopo la raccolta lead: il modello può richiedere UNA o PIÙ funzioni;
       quelle fuori whitelist vengono bloccate dal gate per livello. Mai
       bloccante: un errore qui non tocca la risposta già pronta. */
    for (const call of ai.toolCalls ?? (ai.toolCall ? [ai.toolCall] : [])) {
      if (!pool) break;
      try {
        const tr = await runToolCall(call, { conversationId });
        if (tr.fn === "salva_lead" && tr.ok) leadSaved = true;
      } catch (e) {
        console.error("[ambrosio-turn] tool execution:", e);
      }
    }

    // RETE DI SICUREZZA L3: proposta scritta solo in chat → bozza comunque
    // registrata per il team (dedup per conversazione, mai bloccante).
    try {
      await safetyNetProposal(conversationId, auto.level, auto.takeoverSla, reply);
    } catch (e) {
      console.error("[ambrosio-turn] safety-net proposta:", e);
    }

    // Persistiamo la risposta come messaggio "bot" così il visitatore la vede
    // anche ricaricando, e l'operatore umano la rilegge nel ticket.
    if (pool) {
      try {
        await pool.query("insert into messages (conversation_id, sender, body) values ($1, 'bot', $2)", [
          conversationId,
          reply,
        ]);
      } catch (e) {
        console.error("[ambrosio-turn] persist risposta:", e);
      }
    }
    return { ok: true, reply, leadSaved };
  } catch (e) {
    if (e instanceof AiNotConfiguredError) {
      return { ok: false, error: e };
    }
    console.error("[ambrosio-turn]", e);
    return { ok: false, error: "provider_error" };
  }
}
