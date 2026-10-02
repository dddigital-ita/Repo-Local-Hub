import { NextResponse } from "next/server";
import { getClosing, getNextShift, type LeadData } from "@/lib/chat-script";
import { nowInRome } from "@/lib/operators";
import { buildChatContext, onDutyOperator, getCallbackSlots, whatsappLink } from "@/lib/server-context";
import { db } from "@/lib/db";
import { notifyOperator } from "@/lib/notify";
import { limit, clientIp } from "@/lib/rate-limit";
import { shieldCheck, shieldViolate, honeypotTripped } from "@/lib/shield";
import { verifyTurnstile } from "@/lib/turnstile";
import { getSyncConfig } from "@/lib/notion-config";
import { enqueueNotionSync } from "@/lib/notion-queue";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rl = limit("lead", clientIp(req.headers), 5, 60 * 60_000);
  if (!rl.ok) {
    await shieldViolate(req, "rate_limit", "/api/lead", "oltre il limite di richieste");
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }
  const blocked = await shieldCheck(req, "/api/lead");
  if (blocked) {
    return NextResponse.json({ ok: false, error: "blocked_by_shield" }, { status: blocked.status });
  }
  const bodyJson = (await req.json().catch(() => ({}))) as {
    conversationId?: string | null;
    lead?: Partial<LeadData>;
    query?: string;
    sourcePage?: string;
    utm?: Record<string, string>;
    website_url?: string;
    turnstileToken?: string;
  };
  const ts = await verifyTurnstile(bodyJson.turnstileToken, clientIp(req.headers));
  if (!ts.ok) {
    // Come in /api/chat/init: token mancante = timing del client, non abuso
    // (nessuna violazione Shield); token INVALIDO resta una violazione.
    if (ts.reason !== "token_mancante") {
      await shieldViolate(req, "bad_payload", "/api/lead", "token captcha non valido");
    }
    return NextResponse.json({ ok: false, error: "captcha_failed" }, { status: 403 });
  }
  if (honeypotTripped(bodyJson)) {
    // Bot: risposta 200 finta per non dargli informazioni, ma nessun salvataggio
    await shieldViolate(req, 'honeypot', '/api/lead', 'campo trappola riempito');
    return NextResponse.json({ ok: true, honeypot: true });
  }
  const { conversationId, lead, query, sourcePage, utm } = bodyJson;

  if (!lead?.name || !lead.phone || lead.consent !== true) {
    return NextResponse.json({ ok: false, error: "missing_consent_or_data" }, { status: 400 });
  }

  // Sanitizzazione: tipi sbagliati o payload sporchi non entrano nel DB.
  const name = String(lead.name).trim().slice(0, 100);
  const phone = String(lead.phone).replace(/[^\d+()\-\s]/g, "").trim().slice(0, 30);
  const service = lead.service == null ? null : String(lead.service).slice(0, 100);
  const urgency = lead.urgency == null ? null : String(lead.urgency).slice(0, 100);
  const existingSite = lead.existingSite == null ? null : String(lead.existingSite).slice(0, 100);
  const budget = lead.budget == null ? null : String(lead.budget).slice(0, 100);
  const company = lead.company == null ? null : String(lead.company).slice(0, 100);
  const companyName = lead.companyName == null ? null : String(lead.companyName).slice(0, 100);
  const cleanQuery = query == null ? null : String(query).slice(0, 300);
  const cleanSourcePage = sourcePage == null ? null : String(sourcePage).slice(0, 200);
  if (!name || phone.replace(/\D/g, "").length < 6) {
    return NextResponse.json({ ok: false, error: "invalid_data" }, { status: 400 });
  }

  const now = nowInRome();
  const ctx = await buildChatContext(query ?? "", now);
  const onDuty = onDutyOperator(ctx.operators, now);
  const pool = db();

  let leadId: string | null = null;
  // Un fallimento di persistenza NON deve restare invisibile: il 27/09/2026
  // l'INSERT è fallito per 4 giorni (parametri disallineati) con risposta
  // ok:true e nessuna traccia. Il flag emerge nella risposta per monitoraggio.
  let leadInsertFailed = false;
  if (pool) {
    try {
      const { rows } = await pool.query<{ id: string }>(
        `insert into leads (conversation_id, name, phone, service, urgency, existing_site, budget, company, company_name,
                            consent, hot, status, initial_query, source_page, utm_source, utm_medium, utm_campaign)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9, true, $10, 'nuovo', $11,$12,$13,$14,$15)
         returning id`,
        [
          conversationId ?? null,
          name,
          phone,
          service,
          urgency,
          existingSite,
          budget,
          company, // $8 company
          companyName, // $9 company_name
          Boolean(lead.hot), // $10 hot — fino al 2026-09-27 era in coda: l'INSERT falliva (colonna boolean riceveva il nome ditta) e il lead non veniva mai salvato, con notifica che partiva lo stesso
          cleanQuery,
          cleanSourcePage,
          utm?.utm_source ?? null,
          utm?.utm_medium ?? null,
          utm?.utm_campaign ?? null,
        ],
      );
      leadId = rows[0]?.id ?? null;

      if (conversationId) {
        await pool.query("update conversations set status = 'lead_captured', lead_id = $1 where id = $2", [
          leadId,
          conversationId,
        ]);
      }
      // Notion on_create (config): accodamento non bloccante, failure silenziosa.
      try {
        const cfg = await getSyncConfig();
        if (cfg.entities.leads.enabled && cfg.sync.onCreate) {
          const { rows: fresh } = await pool.query("select * from leads where id = $1", [leadId]);
          if (fresh[0]) await enqueueNotionSync("lead", fresh[0] as Record<string, unknown>, cfg);
        }
      } catch {}
    } catch (e) {
      console.error("[lead] insert:", e);
      leadInsertFailed = true;
    }
  }

  const notification = await notifyOperator({
    name,
    phone,
    service: service ?? undefined,
    urgency: urgency ?? undefined,
    budget: budget ?? undefined,
    existingSite: existingSite ?? undefined,
    query: cleanQuery ?? undefined,
    sourcePage: cleanSourcePage ?? undefined,
    operatorName: onDuty?.firstName,
    operatorPhone: onDuty?.phone,
  });

  return NextResponse.json({
    ok: true,
    leadId,
    leadInsertFailed,
    notified: notification,
    onDuty: onDuty ? { firstName: onDuty.firstName, phone: onDuty.phone, whatsapp: whatsappLink(onDuty) } : null,
    nextShiftLabel: onDuty ? null : getNextShift(ctx).label,
    callbackSlots: getCallbackSlots(ctx),
    closing: getClosing(ctx, lead as LeadData),
  });
}
