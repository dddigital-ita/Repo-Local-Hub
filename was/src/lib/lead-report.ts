import { db } from "@/lib/db";
import { sendEmailViaTools } from "@/lib/email-tools";
import { logAudit } from "@/lib/audit";
import { nowInRome } from "@/lib/operators";
import {
  leadCompanyWhere,
  leadCompanyFilenameSuffix,
  buildLeadsCsv,
  isoWeek,
  isWeeklyReportTime,
} from "@/lib/lead-company";

/**
 * REPORT SETTIMANALE LEAD (server-only): una email a settimana all'operatore
 * con il CSV del segmento «azienda» allegato e i conteggi che dicono dove
 * l'elenco va completato:
 *   - aziende totali (quante righe ha il CSV allegato);
 *   - aziende SENZA nome ditta → il badge «ditta mancante» della dashboard;
 *   - lead SENZA tipo cliente → il segmento che non si può ancora segmentare.
 *
 * Finestra: LUNEDÌ 6–9 Roma (prima che cominci il turno). Dedup settimanale
 * su content_settings key `lead_report_sent` = {"week": "2026-W40"}: il cron
 * passa ogni 15 minuti, solo il primo tick utile nella finestra del lunedì
 * invia. Flag scritto SOLO se almeno un invio è riuscito (un fallimento SMTP
 * riprova al prossimo tick, ancora in finestra).
 *
 * Invio best-effort come tutto il cron: un fallimento non tocca gli altri
 * automatismi; l'esito va in audit (`lead_report.inviato` / `lead_report.errore`).
 */

const REPORT_FLAG_KEY = "lead_report_sent";

// isoWeek e isWeeklyReportTime vivono in lead-company.ts (funzioni pure,
// senza import di DB: verificabili da smoke e sentinelle senza backend).

/** Destinatari: gli account admin esistenti (la email è l'identità di login). */
async function adminRecipients(): Promise<string[]> {
  const pool = db();
  if (!pool) return [];
  try {
    const { rows } = await pool.query<{ email: string }>(
      "select email from admin_users order by email",
    );
    return rows.map((r) => r.email).filter(Boolean);
  } catch {
    return [];
  }
}

export async function sendWeeklyLeadReport(
  opts: { now?: Date } = {},
): Promise<{ outcome: "sent" | "skipped" | "failed" | "empty"; detail: string }> {
  const now = opts.now ?? nowInRome();
  if (!isWeeklyReportTime(now)) {
    return { outcome: "skipped", detail: `fuori finestra (lun 6–9 Roma; ora: ${now.getDay()} ${now.getHours()}:00)` };
  }

  const pool = db();
  if (!pool) return { outcome: "skipped", detail: "db non configurato" };

  // Dedup settimanale: la prima chiamata utile nella finestra vince.
  const week = isoWeek(now);
  try {
    const { rows } = await pool.query<{ value: { week?: string } | null }>(
      "select value from content_settings where key = $1",
      [REPORT_FLAG_KEY],
    );
    if (rows[0]?.value?.week === week) {
      return { outcome: "skipped", detail: `già inviato per ${week}` };
    }
  } catch {
    // flag non leggibile: si procede (meglio un doppione che un silenzio)
  }

  const recipients = await adminRecipients();
  if (recipients.length === 0) {
    return { outcome: "skipped", detail: "nessun admin destinatario" };
  }

  // Conteggi + righe del CSV: due query, una per i numeri del body, una per
  // le righe del segmento allegato (stesso WHERE dell'helper condiviso).
  const { rows: counts } = await pool.query<{
    aziende_totali: number;
    aziende_senza_ditta: number;
    senza_tipo: number;
  }>(
    `select
       (select count(*) from leads where company = 'azienda')::int as aziende_totali,
       (select count(*) from leads where company = 'azienda' and (company_name is null or company_name = ''))::int as aziende_senza_ditta,
       (select count(*) from leads where company is null or company = '')::int as senza_tipo`,
  );
  const c = counts[0] ?? { aziende_totali: 0, aziende_senza_ditta: 0, senza_tipo: 0 };

  const { whereSql, params } = leadCompanyWhere("azienda");
  const { rows: aziende } = await pool.query(
    `select * from leads ${whereSql} order by created_at desc`,
    params,
  );
  const csv = buildLeadsCsv(aziende as Record<string, unknown>[]);
  const filename = `lead-${now.toISOString().slice(0, 10)}${leadCompanyFilenameSuffix("azienda")}.csv`;

  const subject = `📊 Report settimanale lead: ${c.aziende_totali} aziende` +
    (c.aziende_senza_ditta > 0 ? `, ${c.aziende_senza_ditta} senza ditta` : "") +
    (c.senza_tipo > 0 ? `, ${c.senza_tipo} senza tipo` : "");
  const text = [
    "Report settimanale lead — Web Agency Salento",
    "",
    `🏢 Aziende nel CSV allegato: ${c.aziende_totali}`,
    c.aziende_senza_ditta > 0
      ? `⚠️ Aziende SENZA nome ditta: ${c.aziende_senza_ditta} — integralo dalla dashboard (badge «ditta mancante») così l'elenco esce completo`
      : "✅ Ogni azienda ha il nome della ditta",
    `❓ Lead SENZA tipo cliente: ${c.senza_tipo}` +
      (c.senza_tipo > 0 ? " — non segmentabili: completali dalla dashboard" : ""),
    "",
    "Il CSV allegato è lo stesso di Admin → Lead → «Export CSV (Aziende)».",
    "",
    "Apri la dashboard: /admin/leads",
  ].join("\n");

  let sent = 0;
  const errors: string[] = [];
  for (const to of recipients) {
    const r = await sendEmailViaTools({
      to,
      subject,
      text,
      attachments: [
        {
          filename,
          content: Buffer.from(csv, "utf8"),
          contentType: "text/csv; charset=utf-8",
        },
      ],
    });
    if (r.ok) sent++;
    else errors.push(`${to}: ${r.error}`);
  }

  if (sent > 0) {
    await pool
      .query(
        "insert into content_settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = $2::jsonb",
        [REPORT_FLAG_KEY, JSON.stringify({ week, sent, aziende: aziende.length })],
      )
      .catch(() => {});
    await logAudit("system", "lead_report.inviato", `${sent}/${recipients.length}`, `${subject} · allegato ${filename}`);
  }
  if (errors.length) {
    await logAudit("system", "lead_report.errore", null, errors.join("; ").slice(0, 500));
  }

  if (sent === 0 && errors.length > 0) {
    return { outcome: "failed", detail: errors.join("; ").slice(0, 200) };
  }
  if (sent === 0) {
    return { outcome: "skipped", detail: "email non configurata (SMTP assente)" };
  }
  return { outcome: "sent", detail: `${sent}/${recipients.length} · ${filename}` };
}
