import type { Metadata } from "next";
import { DatabaseBackup, Download, ScrollText, X } from "lucide-react";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { BACKUP_AUDIT_ACTIONS } from "@/lib/backup-audit";
import { Container, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Log di audit", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Etichette leggibili delle azioni, raggruppate per colore. */
const ACTION_LABEL: Record<string, string> = {
  "lead.stato": "Stato lead",
  "lead.nota": "Nota lead",
  "lead.temperatura": "Temperatura lead",
  "lead.ricontatta": "Ricontatta tra",
  "lead.eliminato": "Lead eliminato",
  "client.sync": "Sync portafoglio clienti",
  "client.nota": "Nota cliente",
  "ticket.risposta": "Risposta ticket",
  "ticket.priorita": "Priorità ticket",
  "ticket.stato": "Stato ticket",
  "ticket.nota": "Nota interna",
  "pacchetto.creato": "Pacchetto creato",
  "pacchetto.modificato": "Pacchetto modificato",
  "pacchetto.toggle": "Pacchetto attivo/spento",
  "pacchetto.eliminato": "Pacchetto eliminato",
  "pacchetto.duplicato": "Pacchetto duplicato",
  "operatore.disponibilita": "Disponibilità operatore",
  "operatore.turni": "Turni operatore",
  "callback.done": "Callback completata",
  "callback.missed": "Callback mancata",
  "callback.eliminata": "Callback eliminata",
  "callback.richiama-ora": "Richiama subito",
  "ai.impostazioni": "Impostazioni Ambrosio",
  "admin.login": "Login admin",
  "admin.render": "Tempo di rendering pagina",
  "admin.password-cambiata": "Password admin cambiata",
  "ai.reset-prompt": "Reset prompt Ambrosio",
  "notion.impostazioni": "Impostazioni Notion",
  "notion.sync": "Sync Notion riuscito",
  "notion.sync-fallito": "Sync Notion fallito",
  "drive.impostazioni": "Impostazioni Google Drive",
  "drive.test": "Test Google Drive",
  "shield.sblocca-ip": "IP sbloccato",
  // Ciclo backup (voce per ogni azione: il log resta in inglese tecnico,
  // la UI parla italiano)
  "backup.creato": "Backup creato",
  "backup.eliminato": "Backup eliminato da storico",
  "backup.errore": "Backup in errore",
  "backup.promemoria": "Promemoria backup inviato",
  "digest.inviato": "Digest mattutino inviato",
  "digest.errore": "Digest mattutino in errore",
  "versione.check": "Verifica aggiornamenti",
  "restore.eseguito": "Restore eseguito",
  "restore.errore": "Restore annullato",
};

function tone(action: string): string {
  if (action.includes("eliminato") || action.includes("eliminata")) return "bg-red-50 text-red-700";
  if (action.startsWith("restore.errore")) return "bg-red-50 text-red-700";
  if (action.startsWith("restore.eseguito")) return "bg-emerald-50 text-emerald-700";
  if (action.startsWith("lead.")) return "bg-blue-50 text-blue-700";
  if (action.startsWith("client.")) return "bg-teal-50 text-teal-700";
  if (action.startsWith("ticket.")) return "bg-violet-50 text-violet-700";
  if (action.startsWith("pacchetto.")) return "bg-amber-50 text-amber-700";
  if (action.startsWith("operatore.")) return "bg-emerald-50 text-emerald-700";
  if (action.startsWith("callback.")) return "bg-cyan-50 text-cyan-700";
  if (action.startsWith("backup.") || action.startsWith("restore.") || action.startsWith("versione.")) return "bg-fuchsia-50 text-fuchsia-700";
  return "bg-slate-100 text-slate-600";
}

interface AuditRow {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  detail: string | null;
  created_at: string;
}

/** Distinct delle azioni PRESENTI NEL LOG (il filtro non propone voci vuote). */
async function loadKnownActions(pool: NonNullable<ReturnType<typeof db>>): Promise<string[]> {
  const { rows } = await pool.query<{ action: string }>(
    "select distinct action from audit_log order by action",
  );
  return rows.map((r) => r.action);
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ azione?: string }>;
}) {
  await requireAdmin();
  const { azione } = await searchParams;
  const filter = azione?.trim() ?? "";
  const pool = db();

  // Join per costruire le opzioni del filtro mentre interroga i dati: una
  // sola round-trip quando non c'è filtro (caso comune), due quando c'è.
  const knownActions = pool ? await loadKnownActions(pool) : [];
  const { rows } = (await pool?.query<AuditRow>(
    filter
      ? "select id, actor, action, target, detail, created_at from audit_log where action = $1 order by created_at desc limit 200"
      : "select id, actor, action, target, detail, created_at from audit_log order by created_at desc limit 200",
    filter ? [filter] : [],
  )) ?? { rows: [] as AuditRow[] };

  const hasBackupEntries = knownActions.some((a) => (BACKUP_AUDIT_ACTIONS as readonly string[]).includes(a));

  return (
    <Container className="py-10">
      {/* flex-wrap: su mobile i due CTA (shrink-0) vanno sotto il titolo
          invece di comprimerlo a larghezza zero (una parola per riga). */}
      <div className="flex flex-wrap items-center gap-3 gap-y-2">
        <div className="grid size-11 place-items-center rounded-2xl bg-gradient-to-b from-white to-slate-50 shadow-sm ring-1 ring-slate-900/5">
          <ScrollText className="size-5 text-slate-600" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Log di audit</h1>
          <p className="text-sm text-slate-500">
            Chi ha fatto cosa, negli ultimi 200 eventi. Registro append-only: non si può modificare né cancellare.
          </p>
        </div>
        <a
          href="/api/admin/audit.csv"
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white/70 px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-900/10 transition hover:bg-white"
        >
          <Download className="size-4" aria-hidden />
          Esporta CSV
        </a>
        {hasBackupEntries && (
          <a
            href="/api/admin/audit-backup.csv"
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700"
          >
            <DatabaseBackup className="size-4" aria-hidden />
            CSV backup
          </a>
        )}
      </div>

      {/* Filtro per azione: form GET nativo (funziona senza JS), select
          popolato dalle azioni davvero presenti nel log. */}
      <form method="get" className="mt-6 flex flex-wrap items-center gap-2">
        <label htmlFor="filtro-azione" className="text-sm font-medium text-slate-600">
          Azione
        </label>
        <select
          id="filtro-azione"
          name="azione"
          defaultValue={filter}
          className="min-h-10 rounded-full border border-slate-900/10 bg-white/70 px-3.5 py-2 text-sm text-slate-700 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          <option value="">Tutte le azioni</option>
          {knownActions.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABEL[a] ?? a}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="inline-flex min-h-10 items-center rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700"
        >
          Filtra
        </button>
        {filter && (
          <Link
            href="/admin/audit"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white/70 px-3.5 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-900/10 transition hover:bg-white"
          >
            <X className="size-3.5" aria-hidden />
            Rimuovi filtro
          </Link>
        )}
        {filter && (
          <span className="text-sm text-slate-500">
            {rows.length} {rows.length === 1 ? "evento" : "eventi"} di «{ACTION_LABEL[filter] ?? filter}»
          </span>
        )}
      </form>

      {rows.length === 0 ? (
        <Card className="mt-8 p-10 text-center text-sm text-slate-500">
          {filter
            ? `Nessun evento per questa azione.`
            : "Nessun evento ancora. Appena tocchi un lead, un ticket o un pacchetto, l'azione compare qui con il tuo nome e il timestamp."}
        </Card>
      ) : (
        <Card className="mt-8 overflow-hidden p-0">
          <ul className="divide-y divide-slate-900/5">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
                <span className="w-40 shrink-0 tabular-nums text-slate-400">
                  {new Date(r.created_at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "medium" })}
                </span>
                <span className="font-medium text-slate-800">{r.actor}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone(r.action)}`}>
                  {ACTION_LABEL[r.action] ?? r.action}
                </span>
                {r.detail && <span className="text-slate-600">{r.detail}</span>}
                {r.target && (
                  <span className="ml-auto max-w-40 truncate font-mono text-xs text-slate-300" title={r.target}>
                    {r.target.slice(0, 8)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Container>
  );
}
