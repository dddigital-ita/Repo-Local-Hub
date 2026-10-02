import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { getAppUser } from "@/lib/users";
import { createBoardItem, assignBoardItem, pullBoard, getBoardConfig, saveBoardConfig } from "@/lib/calendar-hub";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/calendario/actions — azioni della board del Calendar Hub.
 * body: { action: "create" | "assign" | "pull" | "config", ... }
 * Le scritture rispettano i ruoli come la pagina RSC: config solo super
 * admin; l'assegnazione tocca SOLO item manuali e callback (il busy viene
 * dai provider, read-only). Ogni gesto lascia traccia in audit (nella lib).
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
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "create") {
    const starts = new Date(String(body.starts_at ?? ""));
    if (Number.isNaN(starts.getTime())) return NextResponse.json({ ok: false, error: "data_non_valida" }, { status: 400 });
    const endsRaw = typeof body.ends_at === "string" && body.ends_at ? new Date(body.ends_at) : null;
    const r = await createBoardItem(
      {
        title: String(body.title ?? ""),
        starts_at: starts,
        ends_at: endsRaw && !Number.isNaN(endsRaw.getTime()) ? endsRaw : null,
        operatorId: typeof body.operator_id === "string" ? body.operator_id : null,
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
    // Gli id sintetici cb-… (callback non proiettate) sono gestiti dalla
    // lib: scrive sulla callback reale, la proiezione la seguirà al pull.
    const r = await assignBoardItem(id, { operatorId: typeof body.operator_id === "string" && body.operator_id ? body.operator_id : null }, user.email);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    revalidatePath("/admin/calendario");
    return NextResponse.json({ ok: true });
  }

  if (action === "pull") {
    const r = await pullBoard(user.email);
    revalidatePath("/admin/calendario");
    return NextResponse.json({ ok: true, ...r });
  }

  if (action === "config") {
    if (user.role !== "super_admin") return NextResponse.json({ ok: false, error: "solo_super_admin" }, { status: 403 });
    const cfg = await saveBoardConfig(
      {
        busy_private: typeof body.busy_private === "boolean" ? body.busy_private : undefined,
        work_start: typeof body.work_start === "number" ? body.work_start : undefined,
        work_end: typeof body.work_end === "number" ? body.work_end : undefined,
        work_days: Array.isArray(body.work_days) ? (body.work_days as unknown[]).map(Number) : undefined,
        slot_minutes: typeof body.slot_minutes === "number" ? body.slot_minutes : undefined,
        rotateToken: body.rotate_token === true,
      },
      user.email,
    );
    revalidatePath("/admin/calendario");
    return NextResponse.json({ ok: true, config: { ...cfg, export_token: cfg.export_token ? "salvato" : null } });
  }

  void getBoardConfig; // (la config si legge lato server nella pagina)
  return NextResponse.json({ ok: false, error: "azione_sconosciuta" }, { status: 400 });
}
