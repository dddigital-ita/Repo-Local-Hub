import { db } from "@/lib/db";
import { extractMessage } from "@/lib/telegram";
import { getEffectiveTelegramConfig } from "@/lib/telegram-config";
import { processTelegramMessage } from "@/lib/telegram-ingest";

export const dynamic = "force-dynamic";

/**
 * WEBHOOK TELEGRAM — la porta d'ingresso del canale bidirezionale.
 *
 * Telegram chiama POST https://sito/api/telegram/webhook con un update JSON.
 * La registrazione (URL + secret) si fa con scripts/telegram-webhook.mjs.
 *
 * Sicurezza e affidabilità, nell'ordine:
 *  1. secret: header x-telegram-bot-api-secret-token confrontato in tempo
 *     costante (403 se sbagliato; GET semplice per la verifica del setup);
 *  2. dedup: update_id già visto → 200 subito (Telegram ritenta per ore);
 *  3. solo messaggi di chat private (gruppi/canali fuori policy);
 *  4. la pipeline vera vive in src/lib/telegram-ingest.ts, condivisa col
 *     polling di riserva del cron: comandi, thread per chat id, routing
 *     Ambrosio/team.
 *
 * Sempre 200 a pipeline partita (salvo secret): un 5xx fa ritentare Telegram
 * e il dedup protegge, ma meglio non abusarne.
 */

/** Confronto in tempo costante (niente timing attack sul secret). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function GET() {
  return Response.json({ ok: true, endpoint: "telegram-webhook" });
}

export async function POST(req: Request) {
  const cfg = await getEffectiveTelegramConfig();
  if (!cfg) return Response.json({ ok: false, error: "telegram_off" }, { status: 200 });

  // Secret: se configurato, DEVE combaciare (403 altrimenti).
  if (cfg.webhookSecret) {
    const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!got || !safeEqual(got, cfg.webhookSecret)) {
      console.warn("[telegram/webhook] secret mancante o sbagliato");
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
  }

  const update = await req.json().catch(() => null);
  if (!update || typeof update !== "object") return Response.json({ ok: true });

  const pool = db();
  if (!pool) return Response.json({ ok: true, error: "db_non_configurato" });

  const msg = extractMessage(update);
  if (!msg) return Response.json({ ok: true }); // edit/canale/non-testo: nulla da fare

  // ── Dedup: update_id è la chiave unica di Telegram. ────────────────
  // Insert vincente = noi processiamo; conflitto = già fatto (ritento o
  // cron in polling): 200 subito.
  try {
    await pool.query("insert into telegram_updates (update_id, payload) values ($1, $2)", [
      msg.updateId,
      JSON.stringify(update),
    ]);
  } catch {
    return Response.json({ ok: true, duplicate: true });
  }

  try {
    await processTelegramMessage(pool, cfg, msg);
  } catch (e) {
    // Pipeline già accettata (update deduplicato): il 200 evita ritenti che
    // riverserebbero lo stesso messaggio nel thread. L'errore resta nei log.
    console.error("[telegram/webhook]", e);
  }
  return Response.json({ ok: true });
}
