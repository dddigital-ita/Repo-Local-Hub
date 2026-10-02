import { NextResponse } from "next/server";
import { limit, clientIp } from "@/lib/rate-limit";
import { shieldCheck, shieldViolate } from "@/lib/shield";
import { db } from "@/lib/db";
import { slaDueFor } from "@/lib/tickets";
import { notifyAwaitingReply } from "@/lib/notify";

export const dynamic = "force-dynamic";

/** Salva un messaggio e (se afterId è passato) restituisce i messaggi nuovi dell'operatore. */
export async function POST(req: Request) {
  const rl = limit("chat-msg", clientIp(req.headers), 40, 60_000);
  if (!rl.ok) {
    await shieldViolate(req, "rate_limit", "/api/chat/message", "oltre il limite di richieste");
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }
  const blocked = await shieldCheck(req, "/api/chat/message");
  if (blocked) {
    return NextResponse.json({ ok: false, error: "blocked_by_shield" }, { status: blocked.status });
  }
  const { conversationId, sender, body, afterId } = (await req.json().catch(() => ({}))) as {
    conversationId?: string;
    sender?: string;
    body?: string;
    afterId?: string | null;
  };
  // Validazione stretta: tipi sbagliati devono essere 400, non un crash 500
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    typeof conversationId !== "string" ||
    !UUID_RE.test(conversationId) ||
    typeof body !== "string" ||
    !body.trim() ||
    typeof sender !== "string" ||
    !["visitor", "operator", "system"].includes(sender) ||
    (afterId != null && (typeof afterId !== "string" || !UUID_RE.test(afterId)))
  ) {
    await shieldViolate(req, "bad_payload", "/api/chat/message", "payload malformato o tipi sbagliati");
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const pool = db();
  if (!pool) return NextResponse.json({ ok: true, persisted: false });

  const isPoll = body === "__poll__";
  if (!isPoll) {
    try {
      await pool.query(
        "insert into messages (conversation_id, sender, body) values ($1, $2, $3)",
        [conversationId, sender, body.slice(0, 2000)],
      );
      // Se la conversazione era nata come spam (query corta) ma il visitatore
      // sta scrivendo davvero, torna in inbox: niente falsi positivi.
      if (sender === "visitor") {
        await pool.query(
          "update conversations set archived_at = null, archived_by = null where id = $1 and archived_at is not null",
          [conversationId],
        );
        await onVisitorMessage(pool, conversationId, body);
      }
    } catch (e) {
      console.error("[chat/message] insert:", e);
      return NextResponse.json({ ok: false }, { status: 500 });
    }
  }

  // Polling: messaggi dell'operatore arrivati dopo afterId (take-over Fase 2, già funzionante)
  let operatorMessages: { id: string; body: string; created_at: string }[] = [];
  if (afterId) {
    try {
      const { rows } = await pool.query(
        "select id, body, created_at from messages where conversation_id = $1 and sender = 'operator' and id > $2 order by created_at",
        [conversationId, afterId],
      );
      operatorMessages = rows;
    } catch (e) {
      console.error("[chat/message] poll:", e);
    }
  }
  return NextResponse.json({ ok: true, operatorMessages });
}

/**
 * FASE 1 — Il cliente ha scritto: le tre cose che devono succedere, SEMPRE.
 * 1. Riapertura automatica (1.2): un messaggio su un ticket chiuso lo riporta
 *    in coda come «In attesa cliente» → «Da rispondere», con audit.
 * 2. Notifica «il cliente attende» (1.4): email + Telegram al team, DEDUP con
 *    awaiting_notified_at (una sola per fase di attesa: si riarmia quando un
 *    umano risponde).
 * Fire-and-forget: un fallimento non deve mai bloccare la risposta 200 al client.
 */
async function onVisitorMessage(
  pool: NonNullable<ReturnType<typeof db>>,
  conversationId: string,
  rawBody: string,
): Promise<void> {
  try {
    const { rows } = await pool.query<{
      id: string;
      number: number;
      status: string;
      priority: string;
      first_response_at: Date | null;
      lead_name: string | null;
      awaiting_notified_at: Date | null;
    }>(
      `select c.id, c.number, c.status, c.priority, c.first_response_at,
              l.name as lead_name, c.awaiting_notified_at
       from conversations c left join leads l on l.id = c.lead_id
       where c.id = $1`,
      [conversationId],
    );
    const t = rows[0];
    if (!t) return;

    // 1. Riapertura automatica: chiuso → operator (la palla torna all'agente,
    //    clock armato con la policy della priorità).
    if (t.status === "closed") {
      const due = slaDueFor(t.priority, new Date());
      await pool.query(
        `update conversations
         set status = 'operator', closed_at = null, closed_by = null,
             sla_next_reply_due = $2, sla_resolve_due = $3, awaiting_notified_at = null
         where id = $1`,
        [conversationId, due.nextReplyDue, due.resolveDue],
      );
      await pool.query(
        "insert into audit_log (actor, action, target, detail) values ($1, $2, $3, $4)",
        ["system", "ticket.riaperto", conversationId, "messaggio del cliente su ticket chiuso"],
      );
      t.awaiting_notified_at = null; // la riapertura è di per sé una nuova fase: notifica sotto
    }
    // Il cliente ha l'ultima parola su un ticket attivo: il clock «devi
    // rispondere entro» si arma anche se il ticket era già aperto. Il flag di
    // notifica NON si tocca qui: il riarmo avviene solo alla risposta umana
    // (replyToTicket), così messaggi consecutivi del cliente = un avviso solo.
    else if (t.status !== "on_hold") {
      const due = slaDueFor(t.priority, new Date());
      await pool.query(
        `update conversations
         set status = case when status = 'bot' then 'lead_captured' else status end,
             sla_next_reply_due = $2
         where id = $1`,
        [conversationId, due.nextReplyDue],
      );
    }

    // 2. Notifica «attende risposta» con dedup: solo se un umano ha già
    //    risposto almeno una volta (il flusso bot è gestito da Ambrosio e dal
    //    take-over) e non c'è già un avviso in piedi per questa fase.
    if (t.first_response_at && !t.awaiting_notified_at) {
      await pool.query("update conversations set awaiting_notified_at = now() where id = $1", [
        conversationId,
      ]);
      void notifyAwaitingReply({
        number: t.number,
        ticketId: conversationId,
        customerName: t.lead_name,
        snippet: rawBody,
        baseUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "",
      }).catch((e) => console.error("[chat/message] notify awaiting:", e));
    }
  } catch (e) {
    console.error("[chat/message] onVisitorMessage:", e);
  }
}
