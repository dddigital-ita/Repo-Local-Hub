import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Export CSV del log di audit (append-only): stessi guard dell'export lead. */
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
  }>("select created_at, actor, action, target, detail from audit_log order by created_at desc");

  const header = "data;utente;azione;oggetto;dettaglio";
  const body = rows
    .map((r) =>
      [
        new Date(r.created_at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "medium" }),
        r.actor,
        r.action,
        r.target,
        r.detail,
      ]
        .map(csvCell)
        .join(";"),
    )
    .join("\n");
  // BOM per Excel italiano: apre i punti e virgola come separatore corretto
  const csv = "\uFEFF" + header + "\n" + body;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
