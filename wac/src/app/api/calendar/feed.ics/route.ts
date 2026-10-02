import { exportTokenMatches, itemsForExport } from "@/lib/calendar-hub";
import { buildIcs } from "@/lib/calendar-hub-shared";

export const dynamic = "force-dynamic";

/**
 * Feed iCalendar del Calendar Hub (read-only, per Apple/Google/Thunderbird).
 * Token nell'URL (hash sha256 nel DB): rigenerare il token invalida i link.
 * Come tutti i route handler GET del repo: NESSUN side-effect, solo lettura.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!(await exportTokenMatches(token))) {
    return new Response("Forbidden", { status: 403 });
  }
  const items = await itemsForExport();
  const ics = buildIcs(
    items.map((i) => ({ title: i.title, startsAt: i.startsAt, endsAt: i.endsAt, allDay: i.kind === "busy" && i.notes === null ? false : false, notes: i.notes })),
  );
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="web-agency-crema-team.ics"',
      "cache-control": "no-store",
    },
  });
}
