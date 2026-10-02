import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { BACKUP_AUDIT_ACTIONS } from "@/lib/backup-audit";

export const dynamic = "force-dynamic";

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Export CSV DEDICATO alle voci di backup: ciclo di vita del backup
 * (backup.*, restore.*, versione.* — costanti condivise in
 * lib/backup-audit.ts, stessa lista del filtro). Le date mantengono il
 * formato ISO: un export di conformità si ordina e si filtra meglio così.
 */
export async function GET() {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pool = db();
  if (!pool) return NextResponse.json({ error: "database_not_configured" }, { status: 500 });

  const { rows } = await pool.query<{
    created_at: Date;
    actor: string;
    action: string;
    target: string | null;
    detail: string | null;
  }>(
    `select created_at, actor, action, target, detail from audit_log
     where action = any($1) order by created_at desc`,
    [BACKUP_AUDIT_ACTIONS],
  );

  const header = "data_iso;utente;azione;oggetto;dettaglio";
  const body = rows
    .map((r) =>
      [new Date(r.created_at).toISOString(), r.actor, r.action, r.target, r.detail]
        .map(csvCell)
        .join(";"),
    )
    .join("\n");
  // BOM per Excel italiano: apre i punti e virgola come separatore corretto
  const csv = "\uFEFF" + header + "\n" + body;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-backup-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
