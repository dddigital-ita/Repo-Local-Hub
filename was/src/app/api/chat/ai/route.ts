import { NextResponse } from "next/server";
import { limit, clientIp } from "@/lib/rate-limit";
import { shieldCheck, shieldViolate } from "@/lib/shield";
import { handleAmbrosioTurn } from "@/lib/ambrosio-turn";

export const dynamic = "force-dynamic";

/**
 * Ambrosio (operatore AI): risponde SOLO se configurata e nessun umano in turno.
 * Il client manda la domanda + il contesto qualificazione già raccolto.
 *
 * Shield e rate-limit restano QUI (sono perimetrali, legati alla richiesta
 * HTTP del browser): tutto il resto è il cervello condiviso in
 * `src/lib/ambrosio-turn.ts`, lo stesso che risponde su Telegram.
 */
export async function POST(req: Request) {
  const rl = limit("chat-ai", clientIp(req.headers), 10, 60_000);
  if (!rl.ok) {
    await shieldViolate(req, "rate_limit", "/api/chat/ai", "oltre il limite di richieste");
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }
  const blocked = await shieldCheck(req, "/api/chat/ai");
  if (blocked) {
    return NextResponse.json({ ok: false, error: "blocked_by_shield" }, { status: blocked.status });
  }

  const { conversationId, question, context } = (await req.json().catch(() => ({}))) as {
    conversationId?: string;
    question?: string;
    context?: Record<string, string>;
  };
  if (!question?.trim()) return NextResponse.json({ ok: false }, { status: 400 });
  if (!conversationId) {
    // Sessione fantasma: senza conversazione persistita non c'è né thread né
    // ticket né raccolta lead — rispondere qui creerebbe una chat che il team
    // non vedrà mai. Il client mostra il fallback onesto («una persona vera…»).
    return NextResponse.json({ ok: false, error: "no_conversation" }, { status: 200 });
  }

  const r = await handleAmbrosioTurn({ conversationId, question, context });

  // Mappa degli errori ai codici noti dal percorso web (client e test non cambiano).
  if (!r.ok) {
    if (r.error === "ai_off") return NextResponse.json({ ok: false, error: "ai_off" }, { status: 200 });
    if (r.error === "empty") return NextResponse.json({ ok: false, error: "empty" }, { status: 200 });
    if (r.error === "provider_error") return NextResponse.json({ ok: false, error: "provider_error" }, { status: 200 });
    // AiNotConfiguredError: messaggio umano già pronto nell'errore
    return NextResponse.json({ ok: false, error: r.error?.message }, { status: 200 });
  }

  return NextResponse.json({ ok: true, reply: r.reply, leadSaved: r.leadSaved, handoff: r.handoff });
}
