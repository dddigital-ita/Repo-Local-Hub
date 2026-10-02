/**
 * PROVA LIVE del report settimanale lead su DB di sviluppo:
 *   npx tsx --env-file=.env.local scripts/lead-report-live.mts
 *
 * Esegue sendWeeklyLeadReport con `now` simulati (mercoledì = fuori finestra,
 * lunedì 7:00 = in finestra) e legge il flag di dedup. Il SEND reale parte
 * solo se l'SMTP è configurato nel DB; altrimenti la funzione lo dichiara
 * onestamente («email non configurata»). Mai toccata la produzione.
 */
import { sendWeeklyLeadReport } from "../src/lib/lead-report.ts";
import { pool, end } from "./db-env.mts";

// Mercoledì 30/9/2026 10:00 → fuori finestra
const fuori = await sendWeeklyLeadReport({ now: new Date(2026, 8, 30, 10, 0) });
console.log("mercoledì 10:00 →", fuori.outcome, "—", fuori.detail);

// Lunedì 28/9/2026 7:00 → in finestra: dedup/invio/dichiarazione SMTP
const lun = await sendWeeklyLeadReport({ now: new Date(2026, 8, 28, 7, 0) });
console.log("lunedì 7:00   →", lun.outcome, "—", lun.detail);

const { rows } = await pool.query("select value from content_settings where key = 'lead_report_sent'");
console.log("flag dedup:", rows[0]?.value ?? "(assente — nessun invio riuscito)");
await end();
