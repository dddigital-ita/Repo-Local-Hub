/**
 * TELEGRAM — canale bidirezionale di Ambrosio.
 *
 * Fino a oggi Telegram era solo in USCITA (notify.ts usa direttamente le
 * env per lead/SLA/Shield/backup: quel percorso resta intoccato). Da qui
 * il bot risponde ANCHE a chi gli scrive: il webhook (/api/telegram/webhook)
 * riceve gli update, il cervello è lo stesso della web chat
 * (ambrosio-turn.ts) e le risposte umane dei ticket escono da qui.
 *
 * Configurazione (env, come notify.ts — niente credenziali nuove a DB):
 *   TELEGRAM_BOT_TOKEN  token del bot (già usato dalle notifiche)
 *   TELEGRAM_CHAT_ID    chat delle notifiche del team (invariato)
 *   TELEGRAM_WEBHOOK_SECRET  secret opzionale del webhook (x-telegram-bot-api-secret-token)
 *
 * Canali Telegram accettati: chat PRIVATE. Gruppi e canali restano fuori:
 * un bot che risponde in gruppo spara nel mucchio e il payload update è
 * diverso (reply, mention). L'aggiunta del bot a un gruppo NON crea ticket.
 */

export const TELEGRAM_MESSAGE_MAX = 4000; // limite reale API: 4096, margine per l'HTML

export interface TelegramConfig {
  token: string;
  teamChatIds: string[];
  webhookSecret: string | null;
}

/**
 * Credenziali SOLO-ENV (funzione pura, testata): è il fallback storico.
 * Per la config EFFETTIVA usare getEffectiveTelegramConfig() in
 * telegram-config.ts: DB (scheda admin) → env. I chiamanti runtime sono
 * già stati migrati; questa resta per test e script CLI.
 */
export function getTelegramConfig(): TelegramConfig | null {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (!token) return null;
  return {
    token,
    teamChatIds: (process.env.TELEGRAM_CHAT_ID ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null,
  };
}
// NOTA: la config effettiva del runtime (DB → env) sta in telegram-config.ts
// (getEffectiveTelegramConfig). QUESTO file resta puro: niente import — lo
// leggono direttamente i test di node e gli script CLI.

export interface TelegramChatInfo {
  id: string;
  kind: string;
  title: string | null;
  username: string | null;
}

/** Estrae la chat da un update; null se non è un messaggio testo che ci interessa. */
export function extractMessage(u: unknown): {
  updateId: number;
  chat: TelegramChatInfo;
  text: string;
  firstName: string | null;
  username: string | null;
  languageCode: string | null;
} | null {
  const upd = u as {
    update_id?: number;
    message?: {
      text?: string;
      from?: { first_name?: string; username?: string; language_code?: string };
      chat?: { id?: number | string; type?: string; title?: string; first_name?: string; username?: string };
    };
    edited_message?: unknown;
    channel_post?: unknown;
  };
  // Solo message «pulito»: edit e post di canale non generano conversazioni.
  if (!upd || typeof upd.update_id !== "number" || !upd.message) return null;
  const chat = upd.message.chat;
  if (!chat || chat.id == null || chat.type !== "private") return null;
  const text = upd.message.text ?? "";
  if (!text.trim()) return null;
  return {
    updateId: upd.update_id,
    chat: {
      id: String(chat.id),
      kind: chat.type,
      title: chat.title ?? chat.first_name ?? null,
      username: chat.username ?? null,
    },
    text,
    firstName: upd.message.from?.first_name ?? null,
    username: upd.message.from?.username ?? null,
    languageCode: upd.message.from?.language_code ?? null,
  };
}

/* ── Formattazione: markdown leggero → HTML Telegram ────────────── */

/** Escape minimo per la modalità HTML dell'API Telegram. */
export function escapeHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Adatta il testo di Ambrosio al canale: niente markdown pesante (come
 * WhatsApp in messaging.ts), ma **grassetto** diventa <b> — Telegram lo
 * rende bene e le risposte del modello lo usano spesso. Ritorna anche
 * la forma plaintext (fallback se l'HTML dovesse essere rifiutato).
 */
export function formatForTelegram(text: string): { html: string; plain: string } {
  const t = text.trim();
  const plain = t
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)");
  // Prima l'escape, POI i tag: l'escape consume i caratteri speciali ma
  // lascia gli asterischi, che diventano <b>/<i> solo dopo.
  const html = escapeHtml(t)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)");
  return { html, plain };
}

/** Spezza un testo lungo in pezzi entro il limite (risposte molto lunghe). */
export function chunkText(text: string, max = TELEGRAM_MESSAGE_MAX): string[] {
  const t = text.trim();
  if (t.length <= max) return [t];
  const parts: string[] = [];
  let rest = t;
  while (rest.length > max) {
    // Preferisci lo spezzo a fine riga, poi a fine frase, poi a secco.
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(". ", max);
    if (cut < max * 0.5) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/* ── API: invio (con fallback HTML → plaintext) e chiamate generiche ── */

async function callApi<T>(token: string, method: string, body: unknown, timeoutMs = 15_000): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!res.ok || !data?.ok) {
    const err = new Error(`telegram ${method} ${res.status}: ${data?.description ?? res.statusText}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return data.result as T;
}

/** Invia un messaggio testo, gestendo markdown→HTML, limite di lunghezza e fallback. */
export async function sendMessage(
  token: string,
  chatId: string,
  text: string,
  opts?: { replyTo?: number },
): Promise<void> {
  const chunks = chunkText(text);
  for (let i = 0; i < chunks.length; i++) {
    const { html } = formatForTelegram(chunks[i]);
    const body: Record<string, unknown> = { chat_id: chatId, text: html, parse_mode: "HTML" };
    if (i === 0 && opts?.replyTo) body.reply_to_message_id = opts.replyTo;
    try {
      await callApi(token, "sendMessage", body);
    } catch (e) {
      const status = (e as Error & { status?: number }).status;
      // HTML rifiutato (400: tag malformati) o entità non valide: riprova plain.
      if (status === 400) {
        const fallback: Record<string, unknown> = { chat_id: chatId, text: chunks[i] };
        if (i === 0 && opts?.replyTo) fallback.reply_to_message_id = opts.replyTo;
        await callApi(token, "sendMessage", fallback);
      } else {
        throw e;
      }
    }
  }
}

/** Imposta il webhook sul server dell'agenzia (usato da scripts/telegram-webhook.mjs). */
export async function setWebhook(token: string, url: string, secret?: string | null): Promise<unknown> {
  const body: Record<string, unknown> = {
    url,
    allowed_updates: ["message"], // solo messaggi: callback_query e company updates non servono
    drop_pending_updates: false, // i messaggi accumulati mentre eravamo giù restano leggibili via cron
  };
  if (secret) body.secret_token = secret;
  return callApi(token, "setWebhook", body);
}

export async function deleteWebhook(token: string): Promise<unknown> {
  return callApi(token, "deleteWebhook", { drop_pending_updates: false });
}

export async function getWebhookInfo(token: string): Promise<{ url?: string; pending_update_count?: number; last_error_message?: string }> {
  return callApi(token, "getWebhookInfo", {});
}

/**
 * Fetch manuale degli update (palli di riserva se il webhook è irraggiungibile,
 * es. sviluppo locale senza HTTPS): la modalità webhook di Telegram non può
 * essere attiva in parallelo con getUpdates, quindi il cron usa questa via
 * SOLO se TELEGRAM_POLLING=1 (documentato in README).
 */
export async function getUpdates(token: string, offset: number): Promise<{ ok: boolean; updates: unknown[] }> {
  try {
    const updates = await callApi<unknown[]>(token, "getUpdates", {
      offset,
      timeout: 0,
      allowed_updates: ["message"],
    });
    return { ok: true, updates };
  } catch {
    return { ok: false, updates: [] };
  }
}
