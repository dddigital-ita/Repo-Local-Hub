import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { addSource } from "@/lib/calendar-hub";

export const dynamic = "force-dynamic";

/**
 * Sorgenti esterne (super admin): crea o elimina. Solo il super admin
 * configura: gli admin leggono la disponibilità e prenotano.
 * DELETE arriva come POST {action:'delete'} per comodità di fetch.
 */
async function isSuperAdmin(email: string): Promise<boolean> {
  const pool = db();
  if (!pool) return false;
  const { rows } = await pool.query<{ role: string }>("select role from admin_users where email = $1 and active = true", [email]);
  return rows[0]?.role === "super_admin";
}

export async function POST(req: Request) {
  let user: { email: string };
  try {
    user = await requireAdmin();
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.action === "delete") {
    if (!(await isSuperAdmin(user.email))) return NextResponse.json({ ok: false, error: "solo_super_admin" }, { status: 403 });
    const pool = db();
    const id = String(body.id ?? "");
    if (!pool || !id) return NextResponse.json({ ok: false, error: "id_mancante" }, { status: 400 });
    // La cascade (037) porta via anche gli item esterni della sorgente.
    await pool.query("delete from calendar_sources where id = $1", [id]);
    await logAudit(user.email, "calendar_hub.source_delete", id, "");
    return NextResponse.json({ ok: true });
  }

  if (!(await isSuperAdmin(user.email))) return NextResponse.json({ ok: false, error: "solo_super_admin" }, { status: 403 });
  const kind = body.kind === "gcal" ? "gcal" : "ics";
  const r = await addSource(
    {
      kind,
      label: String(body.label ?? "Calendario"),
      url: typeof body.url === "string" ? body.url : null,
      calendarId: typeof body.calendar_id === "string" ? body.calendar_id : null,
      operatorId: typeof body.operator_id === "string" && body.operator_id ? body.operator_id : null,
      color: typeof body.color === "string" ? body.color : "#2F6BFF",
    },
    user.email,
  );
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, id: r.id });
}
