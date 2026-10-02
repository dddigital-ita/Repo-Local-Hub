/**
 * Filtro «tipo cliente» dei lead — fonte unica condivisa da:
 *   - dashboard /admin/leads (tab segmenti),
 *   - export CSV /api/admin/leads.csv?company=…,
 *   - qualunque futuro consumatore (follow-up automatici, report).
 * La whitelist vive QUI: duplicarla tra route e pagina è esattamente la
 * deriva che le sentinelle del repo combattono altrove.
 */

export const LEAD_COMPANY_SEGMENTS = ["azienda", "professionista", "senza"] as const;

export type LeadCompanySegment = (typeof LEAD_COMPANY_SEGMENTS)[number] | "all";

/** Whitelist: qualunque altro valore (o assenza) torna alla vista completa. */
export function resolveLeadCompanySegment(param: string | undefined | null): LeadCompanySegment {
  return (LEAD_COMPANY_SEGMENTS as readonly string[]).includes(param ?? "")
    ? (param as LeadCompanySegment)
    : "all";
}

/** Clausola WHERE + parametri per il segmento. `whereSql` vuoto = nessun filtro. */
export function leadCompanyWhere(segment: LeadCompanySegment): {
  whereSql: string;
  params: unknown[];
} {
  if (segment === "azienda" || segment === "professionista") {
    return { whereSql: "where company = $1", params: [segment] };
  }
  if (segment === "senza") {
    // «Senza tipo»: lead precedenti alla domanda nello script o incomplete.
    return { whereSql: "where (company is null or company = '')", params: [] };
  }
  return { whereSql: "", params: [] };
}

/** Suffisso per i filename degli export segmentati (es. lead-2026-09-30-azienda.csv). */
export function leadCompanyFilenameSuffix(segment: LeadCompanySegment): string {
  return segment === "all" ? "" : `-${segment}`;
}

/** Dedup settimanale del report lead: numero ISO 8601 della settimana (lunedì = inizio). */
export function isoWeek(now: Date): string {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7; // dom = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** La finestra di invio del report settimanale: lunedì (1), tra le 6 e le 8:59. */
export function isWeeklyReportTime(now: Date): boolean {
  return now.getDay() === 1 && now.getHours() >= 6 && now.getHours() < 9;
}

/** Le colonne dell'export: tutte tranne le tre di bookkeeping interno
 *  (conversation_id, callback_id, notion_synced_at) — la sentinella in
 *  tests/chat-e2e.test.mjs fallisce se una colonna nuova resta fuori. */
export const LEADS_CSV_COLUMNS = [
  "created_at", "id", "name", "phone", "wa_phone", "whatsapp_opt_in", "whatsapp_opt_in_at",
  "service", "urgency", "existing_site", "budget", "company", "company_name",
  "source", "temperature", "ricontatta_il", "hot", "status", "consent", "notes",
  "initial_query", "source_page", "utm_source", "utm_medium", "utm_campaign", "callback_slot",
] as const;

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Il CSV dei lead come lo produce la route: stessa fonte colonne, stessa
 *  cella. `segmento` filtra col WHERE condiviso; usato da /api/admin/leads.csv
 *  e dal report settimanale (allegato). */
export function buildLeadsCsv(rows: Record<string, unknown>[]): string {
  const cols = LEADS_CSV_COLUMNS;
  return "\uFEFF" + [cols.join(";"), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(";"))].join("\n");
}
