import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getFreeSlots } from "@/lib/calendar-hub";

export const dynamic = "force-dynamic";

/** GET /api/admin/calendario/slots — slot liberi reali (turni + impegni). */
export async function GET(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const url = new URL(req.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 5), 1), 14);
  const durationMin = Math.min(Math.max(Number(url.searchParams.get("minuti") ?? 30), 15), 120);
  const operatorId = url.searchParams.get("operatore");
  const slots = await getFreeSlots({ days, durationMin, operatorId: operatorId || null, limit: 12 });
  return NextResponse.json({ ok: true, slots });
}
