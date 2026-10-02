import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { getHubConfig } from "@/lib/calendar-hub";
import { getSiteTheme } from "@/lib/theme";
import CalendarBoard from "@/components/calendar-board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendario — Admin", robots: { index: false } };

/**
 * CALENDAR HUB — il tempo dell'agenzia in una vista: callback, appuntamenti,
 * impegni dei calendari esterni (Google/Apple, read-only), blocchi e finestre
 * SLA. Assegnazione a un collega o ad Ambrosio AI, prenotazione su slot
 * liberi reali, export ICS/JSON per il re-import in WAC.
 */
export default async function CalendarioPage() {
  const user = await requireAdmin();
  const pool = db();
  const cfg = await getHubConfig();

  // Ruolo: il super admin vede i titoli privati e configura le sorgenti.
  const roleRes = pool ? await pool.query<{ role: string }>("select role from admin_users where email = $1 and active = true", [user.email]) : { rows: [] as { role: string }[] };
  const isSuper = roleRes.rows[0]?.role === "super_admin";

  const operators = pool
    ? await pool.query<{ id: string; first_name: string; shift_start: number; shift_end: number }>(
        "select id, first_name, shift_start, shift_end from operators where active = true order by id",
      )
    : { rows: [] as { id: string; first_name: string; shift_start: number; shift_end: number }[] };
  // last_pull_at è serializzato in ISO: il componente è client e riceve props
  // serializzabili (Date di pg non attraversa il confine server→client). —
  const sourcesRows = pool
    ? await pool.query<{
        id: string;
        kind: string;
        label: string;
        operator_id: string | null;
        color: string;
        last_status: string | null;
        last_pull_at: Date | null;
        url: string | null;
        calendar_id: string | null;
      }>("select id, kind, label, operator_id, color, last_status, last_pull_at, url, calendar_id from calendar_sources order by created_at")
    : { rows: [] as { id: string; kind: string; label: string; operator_id: string | null; color: string; last_status: string | null; last_pull_at: Date | null; url: string | null; calendar_id: string | null }[] };
  const sources = sourcesRows.rows.map((s) => ({ ...s, last_pull_at: s.last_pull_at ? s.last_pull_at.toISOString() : null }));
  const theme = await getSiteTheme().catch(() => null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Calendario</h1>
          <p className="text-sm text-slate-500">
            Una sola vista del tempo: callback, appuntamenti, impegni del team (Google/Apple) e finestre critiche SLA.
          </p>
        </div>
        <div className="text-xs text-slate-400">
          Turni Lun–Ven {cfg.work_start}–{cfg.work_end} · slot {cfg.slot_minutes} min
        </div>
      </div>

      <CalendarBoard
        operators={operators.rows}
        sources={sources}
        isSuper={isSuper}
        busyPrivate={cfg.busy_private}
        exportToken={cfg.export_token}
        primary={theme?.primary ?? "#67ff00"}
      />
    </div>
  );
}
