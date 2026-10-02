import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getHubWindow } from "@/lib/calendar-hub";

export const dynamic = "force-dynamic";

/** GET /api/admin/calendario/window?from=ISO&to=ISO — proiezione unificata. */
export async function GET(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) return NextResponse.json({ ok: false, error: "range_mancante" }, { status: 400 });
  const items = await getHubWindow(new Date(from), new Date(to), true);
  return NextResponse.json({ ok: true, items });
}
