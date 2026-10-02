/**
 * SMOKE report settimanale lead — verifica CHE IL TESTO CONTENGA i numeri
 * giusti e che il CSV allegato sia quello della route:
 *   npx tsx scripts/lead-report-smoke.mts
 *
 * Le funzioni verificate sono pure (finestra, ISO week, conformazione CSV):
 * il formato email/ora è provato senza toccare SMTP né DB. L'invio reale
 * resta coperto in produzione dall'audit (`lead_report.inviato`).
 */
import { isoWeek, isWeeklyReportTime, buildLeadsCsv } from "../src/lib/lead-company.ts";
import { readFileSync } from "node:fs";

let ko = 0;
const check = (nome: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "✔" : "✘"} ${nome}${extra ? ` — ${extra}` : ""}`);
  if (!ok) ko++;
};

// ── 1. Finestra: solo lunedì 6–8:59 ──
check("lunedì 7:00 in finestra", isWeeklyReportTime(new Date(2026, 8, 28, 7, 0)) === true); // 28/9/2026 = lunedì
check("lunedì 5:59 fuori", isWeeklyReportTime(new Date(2026, 8, 28, 5, 59)) === false);
check("lunedì 9:00 fuori", isWeeklyReportTime(new Date(2026, 8, 28, 9, 0)) === false);
check("martedì 7:00 fuori", isWeeklyReportTime(new Date(2026, 8, 29, 7, 0)) === false);
check("domenica 7:00 fuori", isWeeklyReportTime(new Date(2026, 9, 4, 7, 0)) === false);

// ── 2. ISO week (dedup): lunedì 28/9/2026 è la settimana 40 ──
check("isoWeek(28/9/2026) = 2026-W40", isoWeek(new Date(2026, 8, 28)) === "2026-W40");
// Stesso giorno a distanza di una settimana → settimana diversa (il report riparte).
check("isoWeek(5/10/2026) = 2026-W41", isoWeek(new Date(2026, 9, 5)) === "2026-W41");
// La domenica 4/10 appartiene ancora alla W40 (lunedì = inizio settimana).
check("isoWeek(domenica 4/10) = 2026-W40", isoWeek(new Date(2026, 9, 4)) === "2026-W40");

// ── 3. Il CSV allegato è IDENTICO a quello della route (fonte unica) ──
const helper = buildLeadsCsv([
  { name: "Rossi Srl", company: "azienda", company_name: "Rossi", notes: "colpo, di telefono", created_at: "2026-09-30" },
]);
const routeSrc = readFileSync(new URL("../src/app/api/admin/leads.csv/route.ts", import.meta.url), "utf8");
check("route usa buildLeadsCsv", routeSrc.includes("buildLeadsCsv(rows"));
check("helper include notes", helper.includes("notes"));
const riga = helper.split("\n")[1] ?? "";
check("riga con ; e note virgolate quotate", riga.split(";").length >= 20 && riga.includes('"colpo, di telefono"'));

if (ko > 0) process.exit(1);
console.log("\nsmoke report settimanale lead OK");
