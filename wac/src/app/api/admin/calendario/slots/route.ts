import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getBoardFreeSlots } from "@/lib/calendar-hub";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/calendario/slots — slot liberi reali (turni + impegni del
 * hub) per la prenotazione guidata della board. Matematica pura in
 * calendar-hub-shared, impegni reali da calendar_items: niente slot finti.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const url = new URL(req.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 5), 1), 7);
  const durationMin = Math.min(Math.max(Number(url.searchParams.get("minuti") ?? 30), 15), 120);
  const slots = await getBoardFreeSlots({ days, durationMin, limit: 12 });
  return NextResponse.json({ ok: true, slots });
}
