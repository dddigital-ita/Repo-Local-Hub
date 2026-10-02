import { NextResponse } from "next/server";
import { getGreeting, getOnDutyStatusLine } from "@/lib/chat-script";
import { nowInRome } from "@/lib/operators";
import { buildChatContext, onDutyOperator, getCallbackSlots, whatsappLink } from "@/lib/server-context";
import { db } from "@/lib/db";
import { limit, clientIp } from "@/lib/rate-limit";
import { shieldCheck, shieldViolate } from "@/lib/shield";
import { verifyTurnstile } from "@/lib/turnstile";
import { getAiSettings } from "@/lib/ai";
import { isSpamQuery, slaDueFor } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rl = limit("chat-init", clientIp(req.headers), 20, 60_000);
  if (!rl.ok) {
    await shieldViolate(req, "rate_limit", "/api/chat/init", "oltre il limite di richieste");
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }
  const blocked = await shieldCheck(req, "/api/chat/init");
  if (blocked) {
    return NextResponse.json({ ok: false, error: "blocked_by_shield" }, { status: blocked.status });
  }
  const bodyJson = (await req.json().catch(() => ({}))) as {
    query?: string;
    sourcePage?: string;
    utm?: Record<string, string>;
    turnstileToken?: string;
  };
  // Turnstile: captcha invisibile (attivo solo se le chiavi sono configurate).
  // Un token MANCANTE è un problema di timing del client (script lazy), non un
  // abuso: 403 sì, ma NESSUNA violazione Shield — i 403 di Turnstile facevano
  // salire il contatore «bad_payload» e bannavano l'IP di visitatori veri.
  const ts = await verifyTurnstile(bodyJson.turnstileToken, clientIp(req.headers));
  if (!ts.ok) {
    if (ts.reason !== "token_mancante") {
      await shieldViolate(req, "bad_payload", "/api/chat/init", "token captcha non valido");
    }
    return NextResponse.json({ ok: false, error: "captcha_failed" }, { status: 403 });
  }
  const { query, sourcePage, utm } = bodyJson;
  const now = nowInRome();
  const ctx = await buildChatContext(query ?? "", now);
  const onDuty = onDutyOperator(ctx.operators, now);

  let conversationId: string | null = null;
  const pool = db();
  if (pool) {
    try {
      // Query spam (0–1 caratteri: "t", "x", invii vuoti): il ticket nasce
      // archiviato. Se il visitatore scrive davvero, /api/chat/message lo
      // riattiva in automatico — zero falsi positivi permanenti.
      const spam = isSpamQuery(query ?? "");
      // Il clock «risoluzione» parte con il ticket; il clock «prossima risposta»
      // si arma solo quando un agente scrive (prima l'attesa è coperta dal 2h
      // di prima risposta). Priorità di default: normale.
      const due = slaDueFor("normale", now);
      const { rows } = await pool.query<{ id: string }>(
        `insert into conversations (initial_query, source_page, status, operator_id, utm_source, utm_medium, utm_campaign, sla_resolve_due${spam ? ", archived_at" : ""})
         values ($1, $2, 'bot', $3, $4, $5, $6, $7${spam ? ", now()" : ""}) returning id`,
        [
          query ?? "",
          sourcePage ?? "/",
          onDuty?.id ?? null,
          utm?.utm_source ?? null,
          utm?.utm_medium ?? null,
          utm?.utm_campaign ?? null,
          due.resolveDue,
        ],
      );
      conversationId = rows[0]?.id ?? null;
    } catch (e) {
      console.error("[chat/init] insert conversation:", e);
    }
  }

  const ai = await getAiSettings();

  return NextResponse.json({
    conversationId,
    onDuty: onDuty
      ? {
          id: onDuty.id,
          firstName: onDuty.firstName,
          phone: onDuty.phone,
          whatsapp: whatsappLink(onDuty),
          shiftEnd: onDuty.shiftEnd,
        }
      : null,
    greeting: getGreeting(ctx),
    statusLine: getOnDutyStatusLine(ctx),
    callbackSlots: getCallbackSlots(ctx),
    aiAvailable: Boolean(ai?.enabled),
  });
}
