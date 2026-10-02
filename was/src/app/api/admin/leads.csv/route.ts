import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { db } from "@/lib/db";
import {
  resolveLeadCompanySegment,
  leadCompanyWhere,
  leadCompanyFilenameSuffix,
  buildLeadsCsv,
} from "@/lib/lead-company";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pool = db();
  if (!pool) return NextResponse.json({ error: "database_not_configured" }, { status: 500 });

  // Il segmento della querystring rispetta la STESSA whitelist della
  // dashboard (helper condiviso): /api/admin/leads.csv?company=azienda esporta
  // solo le aziende, col segmento nel filename.
  const company = resolveLeadCompanySegment(new URL(req.url).searchParams.get("company"));
  const { whereSql, params } = leadCompanyWhere(company);

  const { rows } = await pool.query(
    `select * from leads ${whereSql} order by created_at desc`,
    params,
  );
  // Fonte unica delle colonne e della conformazione (condivisa col report
  // settimanale): la sentinella schema→CSV punta all'helper, non alla route.
  const csv = buildLeadsCsv(rows as Record<string, unknown>[]);

  const filename = `lead-${new Date().toISOString().slice(0, 10)}${leadCompanyFilenameSuffix(company)}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
