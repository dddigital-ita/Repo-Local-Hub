import { NextResponse } from "next/server";
import { notifyCallback } from "@/lib/notify";
import { slotToDate } from "@/lib/slots";
import { db } from "@/lib/db";
import { limit, clientIp } from "@/lib/rate-limit";
import { shieldCheck, shieldViolate, honeypotTripped } from "@/lib/shield";
import { queueGCalSyncForCallback } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rl = limit("callback", clientIp(req.headers), 5, 60 * 60_000);
  if (!rl.ok) {
    await shieldViolate(req, "rate_limit", "/api/callback", "oltre il limite di richieste");
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }
  const blocked = await shieldCheck(req, "/api/callback");
  if (blocked) {
    return NextResponse.json({ ok: false, error: "blocked_by_shield" }, { status: blocked.status });
  }
  const bodyJson = (await req.json().catch(() => ({}))) as {
    conversationId?: string | null;
    slot?: string;
    phone?: string;
    email?: string;
    query?: string;
    sourcePage?: string;
    website_url?: string;
  };
  if (honeypotTripped(bodyJson)) {
    await shieldViolate(req, 'honeypot', '/api/callback', 'campo trappola riempito');
    return NextResponse.json({ ok: true, honeypot: true });
  }
  const { conversationId, slot, phone, email, query, sourcePage } = bodyJson;
  if (!slot || (!phone && !email)) {
    return NextResponse.json({ ok: false, error: "missing" }, { status: 400 });
  }

  const pool = db();
  if (pool) {
    try {
      const scheduledAt = slotToDate(slot) ?? new Date();
      // collega lead e conversazione se esistono
      let leadId: string | null = null;
      if (phone) {
        const { rows } = await pool.query<{ id: string }>(
          "select id from leads where phone = $1 order by created_at desc limit 1",
          [phone],
        );
        leadId = rows[0]?.id ?? null;
      }
      await pool.query(
        `insert into callbacks (conversation_id, lead_id, scheduled_at, slot_label)
         values ($1, $2, $3, $4)`,
        [conversationId ?? null, leadId, scheduledAt, slot],
      );
      if (conversationId) {
        await pool.query("update conversations set status = 'callback_scheduled', callback_slot = $1 where id = $2", [
          slot,
          conversationId,
        ]);
      }
      if (leadId) {
        await pool.query("update leads set status = 'callback_scheduled', callback_slot = $1 where id = $2", [
          slot,
          leadId,
        ]);
      }
      // GOOGLE CALENDAR (se attivo): l'appuntamento finisce nel calendario
      // dell'agenzia. Non bloccante e idempotente: il suo errore non tocca
      // la risposta al cliente.
      const cbId = await pool.query<{ id: string }>("select id from callbacks where conversation_id = $1 order by created_at desc limit 1", [conversationId ?? null]);
      const newCallbackId = cbId.rows[0]?.id;
      if (newCallbackId) {
        await queueGCalSyncForCallback(pool, newCallbackId, "create");
      }
    } catch (e) {
      console.error("[callback]", e);
    }
  }

  await notifyCallback({ slot, phone: phone ?? null, email: email ?? null, query, sourcePage });
  return NextResponse.json({ ok: true });
}
