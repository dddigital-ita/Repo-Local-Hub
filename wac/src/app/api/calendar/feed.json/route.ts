import { NextResponse } from "next/server";
import { exportTokenMatches, itemsForExport } from "@/lib/calendar-hub";

export const dynamic = "force-dynamic";

/**
 * Feed JSON del Calendar Hub (per re-import futuri e integrazioni esterne).
 * Stesso token del feed ICS; GET senza side-effect.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!(await exportTokenMatches(token))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const items = await itemsForExport();
  return NextResponse.json(
    {
      ok: true,
      generatedAt: new Date().toISOString(),
      count: items.length,
      items: items.map((i) => ({
        kind: i.kind,
        origin: i.origin,
        title: i.title,
        startsAt: i.startsAt.toISOString(),
        endsAt: i.endsAt.toISOString(),
        operatorId: i.operatorId,
        notes: i.notes,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
