"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Archive,
  ArrowUpCircle,
  Clock,
  Database,
  Download,
  LoaderCircle,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { createBackupAction, checkVersionAction, deleteBackupAction, saveBackupReminderAction } from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";
import RestoreSection from "@/components/restore-section";
import { GlassButton, GlassNotice, GlassSectionHeader } from "@/components/glass";
import type { BackupEntry } from "@/lib/maintenance";

/** Formato data compatto coerente con il resto dell'admin (it-IT). */
function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 100 || u === 0 ? 0 : 1).replace(".", ",")} ${units[u]}`;
}

interface Props {
  backups: BackupEntry[];
  dbOk: boolean;
  appVersion: string;
  nextVersion: string;
  reminderDays: number;
  /** Esito del check aggiornamenti (dalla query string, via server action). */
  versionMessage?: string;
  /** Messaggio di esito backup (query string). */
  backupMessage?: string;
  /** id del backup da scaricare subito dopo la creazione (query string). */
  downloadId?: string;
  /** Errore del restore (query string). */
  restoreError?: string;
  /** Esito del restore riuscito (JSON serializzato in query string). */
  restoreDone?: string;
}

export default function BackupPanel({
  backups,
  dbOk,
  appVersion,
  nextVersion,
  reminderDays,
  versionMessage,
  backupMessage,
  downloadId,
  restoreError,
  restoreDone,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"create" | "version" | null>(null);
  const [days, setDays] = useState(String(reminderDays));

  const working = pending || busy !== null;

  function run(action: () => Promise<void>, kind: "create" | "version") {
    setBusy(kind);
    startTransition(async () => {
      try {
        await action();
      } finally {
        setBusy(null);
      }
    });
  }

  /* Auto-download del file appena creato: la rotta rigenera il payload con
     i dati più freschi (la voce dello storico è il riferimento, non una
     copia congelata). Pulita la query string per evitare ri-download al
     refresh — storica operazione URL. In useEffect: mai side-effect nel
     render (StrictMode lo eseguirebbe due volte). */
  useEffect(() => {
    if (!downloadId) return;
    const a = document.createElement("a");
    a.href = `/api/admin/backup/${downloadId}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.history.replaceState(null, "", "/admin/tools/backup");
  }, [downloadId]);

  const last = backups[0];
  const lastLabel = last ? `${fmtDate(last.createdAt)} · ${fmtBytes(last.sizeBytes)}` : null;

  return (
    <div className="space-y-4">
      {/* Messaggi di esito (da query string) */}
      {backupMessage && (
        <GlassNotice tone={backupMessage.startsWith("ERRORE") || backupMessage.startsWith("Backup non riuscito") ? "warning" : "success"}>
          {backupMessage}
        </GlassNotice>
      )}
      {versionMessage && <GlassNotice>{versionMessage}</GlassNotice>}

      {/* ── Backup ───────────────────────────────────────────────── */}
      <GlassSectionHeader
        icon={Archive}
        title="Backup e Aggiornamenti Versione"
        subtitle="Export JSON completo del database (schema + dati) e stato delle versioni. Il codice si aggiorna da Git/Vercel, non da qui."
        right={
          dbOk ? (
            <GlassButton type="button" disabled={working} onClick={() => run(createBackupAction, "create")}>
              {busy === "create" || pending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Download className="h-4 w-4" aria-hidden />
              )}
              Scarica backup ora
            </GlassButton>
          ) : undefined
        }
      />

      {!dbOk && (
        <p className="rounded-xl bg-amber-50/90 px-3 py-2 text-xs font-medium text-amber-800 ring-1 ring-amber-200/60">
          Database non configurato: backup e storico non disponibili.
        </p>
      )}

      {dbOk && (
        <p className="text-xs text-slate-500">
          {lastLabel ? (
            <>
              Ultimo backup: <strong className="font-semibold text-slate-700">{lastLabel}</strong> — il file JSON include schema e tutte le tabelle di business (lead, ticket, messaggi, FAQ, impostazioni, audit).
            </>
          ) : (
            <>Nessun backup ancora: il primo export scaricherà l&apos;intero database in JSON.</>
          )}
        </p>
      )}

      {/* ── Versione ─────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-white/60 bg-white/45 p-4 ring-1 ring-white/40 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm">
              <ArrowUpCircle className="h-4 w-4" aria-hidden />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Versione corrente</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                App v{appVersion}
                {nextVersion ? <> · Next.js {nextVersion}</> : null} · la versione dell&apos;app segue i commit su Git (il deploy aggiorna il pannello, non viceversa).
              </p>
            </div>
          </div>
          {dbOk && (
            <GlassButton type="button" variant="glass" size="sm" disabled={working} onClick={() => run(checkVersionAction, "version")}>
              {busy === "version" ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              )}
              Verifica aggiornamenti
            </GlassButton>
          )}
        </div>
      </div>

      {/* ── Promemoria ───────────────────────────────────────────── */}
      {dbOk && (
        <form
          action={saveBackupReminderAction}
          onSubmit={() => toastSaved("backup_reminder")}
          className="rounded-3xl border border-white/60 bg-white/45 p-4 ring-1 ring-white/40 backdrop-blur-xl"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70 text-slate-700 ring-1 ring-white/70">
              <Clock className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-slate-900">Promemoria backup</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Se l&apos;ultimo backup è più vecchio di questi giorni, il cron avvisa il team (email + Telegram). 0 = disattivato.
              </p>
            </div>
            <input
              name="days"
              type="number"
              min={0}
              max={180}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-20 shrink-0 rounded-2xl border border-white/70 bg-white/65 px-3 py-2 text-center text-sm text-slate-800 outline-none focus:border-brand-400 focus:bg-white"
              aria-label="Giorni tra i promemoria backup"
            />
            <GlassButton type="submit" variant="glass" size="sm">
              Salva
            </GlassButton>
          </div>
        </form>
      )}

      {/* ── Storico ──────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-white/60 bg-white/45 p-4 ring-1 ring-white/40 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-slate-500" aria-hidden />
          <h3 className="font-semibold text-slate-900">Storico backup</h3>
        </div>
        {backups.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            Ancora nessun backup registrato: il primo export apparirà qui con data, autore e dimensione.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-white/60">
            {backups.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{fmtDate(b.createdAt)}</p>
                  <p className="truncate text-xs text-slate-500">
                    {b.createdBy} · {fmtBytes(b.sizeBytes)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={`/api/admin/backup/${b.id}`}
                    className="rounded-full p-2 text-slate-400 transition hover:bg-white hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                    aria-label={`Riscarica il backup del ${fmtDate(b.createdAt)}`}
                    title="Riscarica (rigenerato con i dati di adesso)"
                  >
                    <Download className="h-4 w-4" aria-hidden />
                  </a>
                  <form
                    action={deleteBackupAction}
                    onSubmit={(e) => {
                      if (!confirm("Eliminare questa voce dallo storico? Il file già scaricato resta valido.")) {
                        e.preventDefault();
                      }
                    }}
                  >
                    <input type="hidden" name="id" value={b.id} />
                    <button
                      type="submit"
                      className="rounded-full p-2 text-slate-400 transition hover:bg-white hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                      aria-label={`Elimina dallo storico il backup del ${fmtDate(b.createdAt)}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-slate-400">
          L&apos;eliminazione nasconde la voce dall&apos;elenco: la traccia resta nel database (append-only, come l&apos;audit).
        </p>
      </div>

      {/* ── Restore da backup ────────────────────────────────────── */}
      {dbOk && (
        <div className="rounded-3xl border border-white/60 bg-white/45 p-4 ring-1 ring-white/40 backdrop-blur-xl">
          <RestoreSection restoreError={restoreError} restoreDone={restoreDone} />
        </div>
      )}
    </div>
  );
}
