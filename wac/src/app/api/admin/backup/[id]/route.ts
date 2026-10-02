import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { buildBackupPayload } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

/**
 * Download del backup JSON generato da createBackupAction. Protetto dalla
 * stessa sessione admin: nessun token di lunga durata nei redirect, solo
 * un id che non espone nulla (il contenuto si rigenera qui, con i dati
 * più freschi al momento dello scaricamento).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  try {
    const payload = await buildBackupPayload(user.email);
    const filename = `backup-webagencycrema-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    return new NextResponse(payload.json, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "backup_failed", detail: e instanceof Error ? e.message : "errore sconosciuto" },
      { status: 500 },
    );
  }
}
