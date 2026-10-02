import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { createCalendarItem, assignCalendarItem, pullAllSources, getHubConfig, saveHubConfig } from "@/lib/calendar-hub";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/calendario/actions — azioni del Calendar Hub.
 * body: { action: "create" | "assign" | "pull" | "config", ... }
 * L'assegnazione rispetta i ruoli: chi è admin vede l'audit del suo gesto,
 * il super admin inoltre configura sorgenti e token (vedi UI).
 */
export async function POST(req: Request) {
  let user: { email: string };
  try {
    user = await requireAdmin();
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "create") {
    const starts = new Date(String(body.starts_at ?? ""));
    if (Number.isNaN(starts.getTime())) return NextResponse.json({ ok: false, error: "data_non_valida" }, { status: 400 });
    const endsRaw = typeof body.ends_at === "string" && body.ends_at ? new Date(body.ends_at) : null;
    const r = await createCalendarItem(
      {
        kind: (body.kind as "appointment" | "personal" | "block") ?? "appointment",
        title: String(body.title ?? ""),
        starts_at: starts,
        ends_at: endsRaw && !Number.isNaN(endsRaw.getTime()) ? endsRaw : null,
        operatorId: typeof body.operator_id === "string" ? body.operator_id : null,
        notes: typeof body.notes === "string" ? body.notes : null,
        location: typeof body.location === "string" ? body.location : null,
      },
      user.email,
    );
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    revalidatePath("/admin/calendario");
    return NextResponse.json({ ok: true, id: r.id });
  }

  if (action === "assign") {
    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ ok: false, error: "id_mancante" }, { status: 400 });
    const to = {
      operatorId: typeof body.operator_id === "string" && body.operator_id ? body.operator_id : null,
      assignedAi: body.assigned_ai === true,
    };
    const r = await assignCalendarItem(id, to, user.email);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    revalidatePath("/admin/calendario");
    return NextResponse.json({ ok: true });
  }

  if (action === "pull") {
    const r = await pullAllSources(user.email);
    revalidatePath("/admin/calendario");
    return NextResponse.json({ ok: true, ...r });
  }

  if (action === "config") {
    const cfg = await saveHubConfig(
      {
        busy_private: typeof body.busy_private === "boolean" ? body.busy_private : undefined,
        work_start: typeof body.work_start === "number" ? body.work_start : undefined,
        work_end: typeof body.work_end === "number" ? body.work_end : undefined,
        slot_minutes: typeof body.slot_minutes === "number" ? body.slot_minutes : undefined,
        rotateToken: body.rotate_token === true,
      },
      user.email,
    );
    revalidatePath("/admin/calendario");
    return NextResponse.json({ ok: true, config: { ...cfg, export_token: cfg.export_token ? "salvato" : null } });
  }

  void getHubConfig; // (la config si legge lato server nella pagina)
  return NextResponse.json({ ok: false, error: "azione_sconosciuta" }, { status: 400 });
}
