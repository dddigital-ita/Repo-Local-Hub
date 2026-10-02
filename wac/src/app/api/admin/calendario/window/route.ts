import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getAppUser } from "@/lib/users";
import { getBoardWindow } from "@/lib/calendar-hub";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/calendario/window?from=ISO&to=ISO — proiezione unificata
 * per la board settimanale (adattatore sullo schema 037 locale). La privacy
 * segue il ruolo: il super admin vede i titoli veri, gli admin i busy come
 * «Occupato» e gli impegni personali altrui come «Impegno personale».
 */
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
  const user = await getAppUser();
  const isSuper = user?.role === "super_admin";
  const items = await getBoardWindow(new Date(from), new Date(to), isSuper, user?.operatorId ?? null);
  return NextResponse.json({ ok: true, items });
}
