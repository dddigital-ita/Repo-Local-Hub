import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pool = db();
  if (!pool) return NextResponse.json({ error: "database_not_configured" }, { status: 500 });

  const { rows } = await pool.query("select * from leads order by created_at desc");
  const cols = [
    "created_at", "name", "phone", "service", "urgency", "existing_site", "budget",
    "hot", "status", "initial_query", "source_page", "utm_source", "utm_medium",
    "utm_campaign", "callback_slot",
  ];
  const csv = "\uFEFF" + [cols.join(";"), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(";"))].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lead-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
