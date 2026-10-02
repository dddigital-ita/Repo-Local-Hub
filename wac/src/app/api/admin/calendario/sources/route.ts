import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getAppUser } from "@/lib/users";
import { addBoardSource, deleteBoardSource, getHubConfig, boardSources } from "@/lib/calendar-hub";

export const dynamic = "force-dynamic";

/**
 * Sorgenti esterne della board: lista (GET, tutti gli admin), crea o
 * elimina (solo super admin). Sullo schema locale la lista vive nelle
 * icalUrls della config del hub — niente tabella calendar_sources, che
 * qui non esiste. DELETE arriva come POST {action:'delete'} per comodità
 * di fetch, come nel gemello.
 */
export async function POST(req: Request) {
  let user: { email: string; role?: string };
  try {
    const admin = await requireAdmin();
    const appUser = await getAppUser();
    user = { email: admin.email, role: appUser?.role };
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.action === "delete") {
    if (user.role !== "super_admin") return NextResponse.json({ ok: false, error: "solo_super_admin" }, { status: 403 });
    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ ok: false, error: "id_mancante" }, { status: 400 });
    const r = await deleteBoardSource(id, user.email);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (user.role !== "super_admin") return NextResponse.json({ ok: false, error: "solo_super_admin" }, { status: 403 });
  const r = await addBoardSource(
    {
      // Solo iCal: su questo schema Google arriva dal service account unico
      // (pullGoogle legge il calendario configurato in gcal_config).
      kind: "ics",
      label: String(body.label ?? "Calendario"),
      url: typeof body.url === "string" ? body.url : null,
    },
    user.email,
  );
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, id: r.id });
}

/** GET: la lista sorgenti per la board (nessun segreto: url/label/stato). */
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const cfg = await getHubConfig();
  return NextResponse.json({ ok: true, sources: boardSources(cfg) });
}
