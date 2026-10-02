import { getBoardConfig, buildBoardExportJson } from "@/lib/calendar-hub";

export const dynamic = "force-dynamic";

const ICS_DT = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/**
 * EXPORT della board — due formati, protetti dal token della VISTA
 * (calendar_hub_config.export_token, in chiaro perché lo mostra la board):
 *  - ?format=ics  → i futuri impegni ASSEGNATI del team (callback,
 *    appuntamenti, personali): per «calendario abbonato da URL»;
 *  - ?format=json → snapshot completo (config, items, sorgenti) per il
 *    re-import programmatico nel gemello WAS.
 *
 * I feed sono READ-ONLY per chi li riceve: nessuna scrittura via URL.
 * I busy esterni NON esportano titoli (privacy: escono come «Occupato» —
 * nel JSON escono senza il titolo vero, nel ICS non escono affatto).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? req.headers.get("x-export-token") ?? "";
  const format = url.searchParams.get("format") ?? "ics";
  const cfg = await getBoardConfig();
  if (!cfg.export_token || token !== cfg.export_token) {
    return new Response("token non valido", { status: 401 });
  }

  if (format === "json") {
    const data = await buildBoardExportJson();
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'inline; filename="wac-calendar-export.json"',
        "Cache-Control": "no-store",
      },
    });
  }

  const now = new Date();
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const to = new Date(now.getTime() + 60 * 86_400_000);
  const items = (await buildBoardExportJson()).items.filter(
    (it) => it.source === "internal" && it.operator_id && it.starts_at >= from.toISOString() && it.starts_at < to.toISOString(),
  );
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Web Agency Crema//Calendar Hub//IT",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Web Agency Crema — Team",
    "X-WR-TIMEZONE:Europe/Rome",
  ];
  for (const it of items) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${it.id}@calendar.webagencycrema`,
      `DTSTAMP:${ICS_DT(now)}`,
      `DTSTART:${ICS_DT(new Date(it.starts_at))}`,
      ...(it.ends_at ? [`DTEND:${ICS_DT(new Date(it.ends_at))}`] : []),
      `SUMMARY:${it.title.replace(/\n/g, " ")}`,
      `CATEGORIES:${it.kind.toUpperCase()}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="wac-team.ics"',
      "Cache-Control": "no-store",
    },
  });
}
