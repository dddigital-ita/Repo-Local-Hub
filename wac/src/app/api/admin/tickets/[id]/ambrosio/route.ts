import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { deskAmbrosioAction, deskSetAutopilota, deskSetFollowupAuto, deskFollowupNow } from "@/lib/desk-ambrosio";

export const dynamic = "force-dynamic";

/**
 * Endpoint del pannello Ambrosio nella scheda ticket (Fase 3 desk).
 * POST { action: "riepilogo" | "risposta" | "classifica" } → { ok, text }.
 * POST { action: "autopilota", attiva: boolean } → { ok, takeover }:
 * toggle MANUALE del take-over sull'aperto (scrittura sull'impronta reale
 * ai_takeover_at, audit ambrosio.desk.autopilota_*, ma niente generazione
 * AI sincrona: chi attiva lo sa).
 * POST { action: "followup", attiva: boolean } → { ok, followupDisabled }:
 * esclude/riattiva il follow-up automatico sul SINGOLO ticket (flag
 * followup_disabled_at, audit ambrosio.desk.followup_*; l'impronta
 * followup_sent_at non è toccata: disattivare non riarma il cron).
 * POST { action: "followup_now" } → { ok, detail }: invia ADESSO il
 * follow-up di Ambrosio (pipeline del cron in modalità manuale: scavalca
 * solo il flag di esclusione, mai la dedup; audit
 * ambrosio.desk.followup_now col nome dell'operatore). Blocchi di regola
 * (già inviato, chiuso, bot, ultima parola) = 409 RFC 7807.
 *
 * Auth = sessione admin (stesso contratto degli altri endpoint /api/admin).
 * L'audit (ambrosio.desk.*) vive nella lib: ogni chiamata lascia traccia con
 * l'operatore che l'ha chiesta. Errori RFC 7807 con type URI stabile.
 */
const ACTIONS = new Set(["riepilogo", "risposta", "classifica", "autopilota", "followup", "followup_now"]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAdminUser();
  if (!user) {
    return NextResponse.json(
      { type: "https://wac.dddigital.net/errors/unauthorized", title: "Non autorizzato", status: 401 },
      { status: 401, headers: { "Content-Type": "application/problem+json" } },
    );
  }
  const { id } = await params;
  let action = "";
  let attiva: boolean | undefined;
  try {
    const body = (await req.json()) as { action?: unknown; attiva?: unknown };
    action = String(body.action ?? "");
    if (typeof body.attiva === "boolean") attiva = body.attiva;
  } catch {
    action = "";
  }
  if (!ACTIONS.has(action)) {
    return NextResponse.json(
      { type: "https://wac.dddigital.net/errors/azione-non-valida", title: "Azione non valida", status: 400, detail: `action deve essere una di: ${[...ACTIONS].join(", ")}` },
      { status: 400, headers: { "Content-Type": "application/problem+json" } },
    );
  }
  if (action === "autopilota" || action === "followup") {
    if (attiva === undefined) {
      return NextResponse.json(
        { type: "https://wac.dddigital.net/errors/parametro-mancante", title: "Parametro mancante", status: 400, detail: `${action} richiede attiva: boolean` },
        { status: 400, headers: { "Content-Type": "application/problem+json" } },
      );
    }
    if (action === "autopilota") {
      const res = await deskSetAutopilota(id, user.email, attiva);
      if (!res.ok) {
        return NextResponse.json(
          { type: "https://wac.dddigital.net/errors/autopilota-non-applicato", title: "Auto-pilota non aggiornato", status: 503, detail: res.reason },
          { status: 503, headers: { "Content-Type": "application/problem+json" } },
        );
      }
      return NextResponse.json({ ok: true, action, takeover: res.takeover });
    }
    const res = await deskSetFollowupAuto(id, user.email, attiva);
    if (!res.ok) {
      return NextResponse.json(
        { type: "https://wac.dddigital.net/errors/followup-non-applicato", title: "Follow-up non aggiornato", status: 503, detail: res.reason },
        { status: 503, headers: { "Content-Type": "application/problem+json" } },
      );
    }
    return NextResponse.json({ ok: true, action, followupDisabled: res.followupDisabled });
  }
  if (action === "followup_now") {
    const res = await deskFollowupNow(id, user.email);
    if (!res.ok) {
      // Blocco di regola (dedup, chiuso, bot, ultima parola) = 409: la
      // richiesta era comprensibile, è il CONTENUTO che non è ammesso ora.
      // Guasto infrastrutturale = 503 come le altre azioni.
      const status = res.bloccato ? 409 : 503;
      return NextResponse.json(
        { type: "https://wac.dddigital.net/errors/followup-non-inviabile", title: "Follow-up non inviabile", status, detail: res.reason },
        { status, headers: { "Content-Type": "application/problem+json" } },
      );
    }
    return NextResponse.json({ ok: true, action, detail: res.detail });
  }
  const res = await deskAmbrosioAction(action as "riepilogo" | "risposta" | "classifica", id, user.email);
  if (!res.ok) {
    // AI spenta/assente: 503 con il motivo leggibile nel pannello (non un 500 secco).
    return NextResponse.json(
      { type: "https://wac.dddigital.net/errors/ambrosio-non-disponibile", title: "Ambrosio non disponibile", status: 503, detail: res.reason },
      { status: 503, headers: { "Content-Type": "application/problem+json" } },
    );
  }
  return NextResponse.json({ ok: true, action, text: res.text });
}
