/**
 * INGEST TELEGRAM — la pipeline condivisa da webhook e polling.
 *
 * Il webhook (/api/telegram/webhook) riceve gli update in tempo reale; il
 * cron (step 13) può rileggere gli update con getUpdates quando il webhook
 * non è raggiungibile (sviluppo locale senza HTTPS, TELEGRAM_POLLING=1).
 * Entrambi finiscono QUI: stessa dedup (update_id), stessi thread, stesso
 * routing Ambrosio/team.
 */
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { slaDueFor } from "@/lib/tickets";
import { notifyAwaitingReply } from "@/lib/notify";
import { handleAmbrosioTurn } from "@/lib/ambrosio-turn";
import { extractMessage, getUpdates, sendMessage, type TelegramConfig } from "@/lib/telegram";
import { getEffectiveTelegramConfig } from "@/lib/telegram-config";
import { nowInRome } from "@/lib/operators";

type Pool = NonNullable<ReturnType<typeof db>>;
type InboundMsg = NonNullable<ReturnType<typeof extractMessage>>;

/** Ultima conversazione 'telegram' di questo chat id. */
async function findConversation(pool: Pool, chatId: string) {
  const { rows } = await pool.query<{ id: string; number: number; status: string; priority: string | null }>(
    `select id, number, status, priority from conversations
     where channel = 'telegram' and contact_handle = $1
     order by created_at desc limit 1`,
    [chatId],
  );
  return rows[0] ?? null;
}

async function createConversation(pool: Pool, msg: InboundMsg): Promise<string | null> {
  try {
    const due = slaDueFor("normale", nowInRome());
    const { rows } = await pool.query<{ id: string }>(
      `insert into conversations (channel, status, initial_query, contact_handle, sla_resolve_due)
       values ('telegram', 'bot', $1, $2, $3) returning id`,
      [msg.text.slice(0, 500), msg.chat.id, due.resolveDue],
    );
    const id = rows[0]?.id ?? null;
    if (id) {
      await logAudit(
        "system",
        "telegram.conversazione_aperta",
        msg.chat.id,
        `chat ${msg.chat.kind}${msg.chat.username ? ` (@${msg.chat.username})` : ""}`,
      );
    }
    return id;
  } catch (e) {
    console.error("[telegram-ingest] create conversation:", e);
    return null;
  }
}

/** Risponde su Telegram e marca last_out_at (registry). Best-effort. */
async function replyAndLog(pool: Pool, cfg: TelegramConfig, chatId: string, text: string): Promise<void> {
  try {
    await sendMessage(cfg.token, chatId, text);
    await pool.query("update telegram_chats set last_out_at = now() where chat_id = $1", [chatId]);
  } catch (e) {
    console.error("[telegram-ingest] send:", e);
  }
}

/** Registra la chat nel registry (upsert, dati per la pagina admin futura). */
async function upsertChat(pool: Pool, msg: InboundMsg): Promise<void> {
  await pool.query(
    `insert into telegram_chats (chat_id, kind, title, username, last_in_at)
     values ($1,$2,$3,$4, now())
     on conflict (chat_id) do update set kind = $2, title = $3, username = $4, last_in_at = now()`,
    [msg.chat.id, msg.chat.kind, msg.chat.title, msg.chat.username],
  );
}

/**
 * Un messaggio Telegram valido (chat privata, già deduplicato a monte):
 * comandi, thread e routing Ambrosio/team.
 */
export async function processTelegramMessage(pool: Pool, cfg: TelegramConfig, msg: InboundMsg): Promise<void> {
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  await upsertChat(pool, msg);

  // ── Comandi: il controllo resta all'utente ────────────────────────
  if (text === "/start") {
    await replyAndLog(
      pool,
      cfg,
      chatId,
      `Ciao! Sono Ambrosio, l'assistente di Web Agency Crema. Scrivimi la tua richiesta: se non ci sono operatori in turno ti rispondo io, altrimenti metto il messaggio davanti al team.\n\nComandi: /stato — a che punto siamo · /umano — parlo con una persona · /stop — silenzio.`,
    );
    return;
  }
  if (text === "/stop") {
    await pool.query(
      "update conversations set status = 'on_hold' where channel = 'telegram' and contact_handle = $1 and status not in ('closed','on_hold')",
      [chatId],
    );
    await logAudit("system", "telegram.stop", chatId, "sospeso su richiesta dell'utente");
    await replyAndLog(pool, cfg, chatId, "Va bene, silenzio. Quando vuoi riprendere, scrivimi pure.");
    return;
  }
  if (text === "/stato" || text === "/umano") {
    const conv = await findConversation(pool, chatId);
    if (text === "/umano") {
      if (conv) {
        await pool.query(
          `update conversations set status = 'operator', sla_next_reply_due = coalesce(sla_next_reply_due, $2)
           where id = $1 and status <> 'closed'`,
          [conv.id, slaDueFor(conv.priority ?? "normale", nowInRome()).nextReplyDue],
        );
        await logAudit("system", "telegram.umano", chatId, "richiesto handoff umano");
        // Campanello al team: un umano è stato richiesto ESPLICITAMENTE.
        await notifyAwaitingReply({
          number: conv.number,
          ticketId: conv.id,
          customerName: msg.firstName ?? msg.chat.title,
          snippet: "/umano — il cliente chiede una persona vera",
          baseUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "",
        }).catch(() => {});
      }
      await replyAndLog(
        pool,
        cfg,
        chatId,
        "Ti metto davanti a una persona vera: un collega prenderà in carico la conversazione al primo turno utile.",
      );
      return;
    }
    // /stato
    if (conv) {
      const stato =
        conv.status === "closed"
          ? "chiuso ✅"
          : conv.status === "operator" || conv.status === "waiting_customer"
            ? "in mano al team 👤"
            : "con me 🤖";
      await replyAndLog(pool, cfg, chatId, `Il tuo ticket è #${conv.number} (${stato}). Scrivi pure qui per aggiornarlo.`);
    } else {
      await replyAndLog(pool, cfg, chatId, "Non ho ancora una conversazione con te: scrivimi la tua richiesta e la apro.");
    }
    return;
  }

  // ── Thread: trova o crea la conversazione del chat id ─────────────
  const conv = await findConversation(pool, chatId);
  const convId = conv?.id ?? (await createConversation(pool, msg));
  if (!convId) return; // db giù: update già deduplicato, niente da rispondere

  // ── Messaggio del visitatore nel thread ───────────────────────────
  await pool.query("insert into messages (conversation_id, sender, body) values ($1, 'visitor', $2)", [
    convId,
    text.slice(0, 2000),
  ]);

  // ── Routing: umano in gioco → ticket; altrimenti Ambrosio ─────────
  const cur = await pool.query<{ status: string; number: number; first_response_at: Date | null }>(
    "select status, number, first_response_at from conversations where id = $1",
    [convId],
  );
  const row = cur.rows[0];

  // Riapertura: come la web chat, un messaggio su un ticket chiuso lo riporta
  // in gioco (stato bot → Ambrosio può rispondere, poi eventuale handoff).
  if (row?.status === "closed") {
    const due = slaDueFor("normale", nowInRome());
    await pool.query(
      `update conversations set status = 'bot', closed_at = null, closed_by = null,
              sla_resolve_due = $2, sla_next_reply_due = null, awaiting_notified_at = null
       where id = $1`,
      [convId, due.resolveDue],
    );
    await logAudit("system", "ticket.riaperto", convId, "messaggio del cliente su ticket chiuso (telegram)");
    row.status = "bot";
  }

  if (row && ["operator", "waiting_customer"].includes(row.status)) {
    // Il team ha il turno: nessuna risposta automatica. Il campanello «cliente
    // attende» suona come sulla web chat: claim su awaiting_notified_at PRIMA
    // dell'invio (update condizionale con returning) — più messaggi
    // consecutivi del cliente = UN avviso; il riarmo avviene quando un umano
    // risponde (replyToTicket azzera il flag). Se l'invio fallisce il claim
    // si rilascia (peggio un silenzio che un doppione... no: qui il silenzio
    // non è accettabile — rilascio e il prossimo messaggio ritenta).
    const claimed = await pool.query<{ claimed: boolean }>(
      `update conversations set awaiting_notified_at = now()
       where id = $1 and awaiting_notified_at is null
       returning true as claimed`,
      [convId],
    );
    if (claimed.rows[0]?.claimed) {
      try {
        await notifyAwaitingReply({
          number: row.number,
          ticketId: convId,
          customerName: msg.firstName ?? msg.chat.title,
          snippet: text,
          baseUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "",
        });
      } catch (e) {
        await pool.query("update conversations set awaiting_notified_at = null where id = $1", [convId]).catch(() => {});
        console.error("[telegram-ingest] notify awaiting:", e);
      }
    }
    return;
  }

  // Palla ad Ambrosio (stato bot / lead_captured / on_hold / takeover).
  const turn = await handleAmbrosioTurn({ conversationId: convId, question: text });
  if (turn.ok && turn.reply) {
    await replyAndLog(pool, cfg, chatId, turn.reply);
  } else if (turn.error === "ai_off" || turn.error === "provider_error" || turn.error === "empty") {
    // Onestà: la AI non è disponibile, non finge.
    await replyAndLog(
      pool,
      cfg,
      chatId,
      "In questo momento non riesco a rispondere io. Il messaggio è arrivato al team: una persona vera ti scrive appena possibile. Grazie della pazienza!",
    );
  }
  // Altri errori (AiNotConfiguredError compreso): il messaggio è nel ticket,
  // il team lo vede dalla inbox — niente risposte finte.
}

/**
 * Pallino di riserva del cron (solo con TELEGRAM_POLLING=1): legge gli
 * update con getUpdates partendo dall'offset salvato (max update_id + 1).
 * Dedup identica al webhook (insert su telegram_updates): se webhook e
 * polling corrono insieme lo stesso messaggio non entra due volte.
 */
export async function pollTelegramUpdates(): Promise<number> {
  const pool = db();
  if (!pool) return 0;
  const cfg = await getEffectiveTelegramConfig();
  if (!cfg) return 0;
  const maxRow = await pool.query<{ max: string | null }>("select max(update_id) as max from telegram_updates");
  const offset = Number(maxRow.rows[0]?.max ?? 0) + 1;
  const { ok, updates } = await getUpdates(cfg.token, offset);
  if (!ok) return 0;
  let processed = 0;
  for (const u of updates) {
    const msg = extractMessage(u);
    const updateId = (u as { update_id?: number }).update_id;
    if (typeof updateId !== "number") continue;
    try {
      await pool.query("insert into telegram_updates (update_id, payload) values ($1, $2)", [
        updateId,
        JSON.stringify(u),
      ]);
    } catch {
      continue; // già visto
    }
    if (msg) {
      await processTelegramMessage(pool, cfg, msg);
      processed++;
    }
  }
  return processed;
}
