import { getHubConfig, buildIcsFeed, buildExportJson } from "@/lib/calendar-hub";

/**
 * EXPORT per WAC — i feed del Calendar Hub, protetti da token
 * (calendar_hub_config.export_token). Chi ha il token può:
 *  - ?format=ics  → aggiungere il calendario del team ovunque (Google,
 *    Apple, Fastmail: «calendario abbonato da URL»);
 *  - ?format=json → snapshot completo per il re-import programmatico in
 *    WebAgencyCrema (WAC) o in altri strumenti.
 *
 * Privacy by default: nel feed ICS gli impegni esterni (privati dei
 * colleghi) escono come «Occupato», senza titoli. Il JSON completo resta
 * per il re-import operativo: contiene gli stessi dati dell'admin.
 *
 * I feed sono READ-ONLY per chi li riceve: nessuna scrittura via URL.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? req.headers.get("x-export-token") ?? "";
  const format = url.searchParams.get("format") ?? "ics";
  const cfg = await getHubConfig();
  if (!cfg.export_token || token !== cfg.export_token) {
    return new Response("token non valido", { status: 401 });
  }
  if (format === "json") {
    const data = await buildExportJson();
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'inline; filename="was-calendar-export.json"',
        "Cache-Control": "no-store",
      },
    });
  }
  const ics = await buildIcsFeed();
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="was-team.ics"',
      "Cache-Control": "no-store",
    },
  });
}
