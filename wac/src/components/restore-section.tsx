"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { CircleAlert, FileUp, LoaderCircle, ShieldAlert, TriangleAlert, Undo2 } from "lucide-react";
import { restoreConfirmAction } from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";
import { GlassButton, GlassNotice } from "@/components/glass";
import { RESTORE_DEPS, missingCascadeChildren } from "@/lib/restore-shared";

/**
 * Sezione RESTORE del pannello Backup: upload del file → piano leggibile
 * (righe nel file vs righe attuali, tabelle saltate con motivo) → conferma
 * esplicita con testo digitato («RIPRISTINA») → esecuzione transazionale.
 *
 * Fase 1 via fetch sulla rotta API autenticata (il piano torna in JSON e il
 * file resta SOLO in memoria del browser: un JSON da ~117 KB non può passare
 * da una query string di redirect). Fase 2 via server action: il JSON viaggia
 * nel body del POST del form — mai nell'URL. Nessun file salvato sul server.
 */

interface PlanItem {
  table: string;
  backupRows: number;
  liveRows: number;
  restore: boolean;
  reason: string;
}

interface PlanMeta {
  createdAt: string | null;
  createdBy: string | null;
  appVersion: string | null;
  fileTables: number;
}

interface RestoreDone {
  restored: Record<string, number>;
  skipped: { table: string; reason: string }[];
  sequences: string[];
}

const CONFIRM_WORD = "RIPRISTINA";

/** Bottone di submit del form di conferma: pending nativo della server action. */
function ConfirmSubmit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <GlassButton type="submit" variant="danger" disabled={disabled || pending}>
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Undo2 className="h-4 w-4" aria-hidden />}
      Ripristina le tabelle selezionate
    </GlassButton>
  );
}

function fmtDate(d: string | null): string {
  if (!d) return "data sconosciuta";
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? d : parsed.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
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

export default function RestoreSection({
  restoreError,
  restoreDone,
}: {
  restoreError?: string;
  restoreDone?: string;
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [json, setJson] = useState("");
  const [plan, setPlan] = useState<{ plan: PlanItem[]; meta: PlanMeta } | null>(null);
  /** Stato controllato delle checkbox (default: come da piano). */
  const [checkedState, setCheckedState] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const done: RestoreDone | null = restoreDone
    ? (() => {
        try {
          return JSON.parse(restoreDone) as RestoreDone;
        } catch {
          return null;
        }
      })()
    : null;

  const totalBackup = plan?.plan.reduce((s, p) => s + p.backupRows, 0) ?? 0;
  const totalLive = plan?.plan.reduce((s, p) => s + p.liveRows, 0) ?? 0;

  /**
   * Dipendenze FK: ripristinare messages senza conversations fallirebbe.
   * L'avviso è locale e immediato (checkbox → stato); la server action
   * riverifica comunque prima di toccare il database (difesa in profondità).
   */
  const selected = new Set(
    (plan?.plan ?? [])
      .filter((p) => p.restore && checkedState[p.table] !== false)
      .map((p) => p.table),
  );
  const missingDeps: string[] = [];
  for (const t of selected) {
    for (const dep of RESTORE_DEPS[t] ?? []) {
      if (!selected.has(dep)) missingDeps.push(`${t} richiede anche ${dep}`);
    }
  }
  // Cascade: ripristinare una parent cancella anche i figli non selezionati
  // (ON DELETE CASCADE) — avviso bloccante, stessa severità delle dipendenze.
  const missingCascades = missingCascadeChildren(selected);
  const canConfirm =
    plan !== null && json !== "" && confirmText === CONFIRM_WORD && selected.size > 0 && missingDeps.length === 0 && missingCascades.length === 0;

  /**
   * Fase 1: analisi del file via rotta API autenticata. Il JSON del backup
   * resta in memoria (state) e rientra nel form di conferma come campo
   * nascosto del POST — mai nella query string di un redirect.
   */
  async function onAnalyze() {
    const input = fileInputRef.current;
    const file = input?.files?.[0];
    setLoadError(null);
    setPlan(null);
    setJson("");
    if (!file) {
      setLoadError("Scegli un file di backup (.json) da ripristinare.");
      return;
    }
    setFileName(file.name);
    setFileSize(file.size);
    setAnalyzing(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/admin/restore/plan", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        plan?: PlanItem[];
        meta?: PlanMeta;
        json?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.plan || !data.json) {
        setLoadError(data.error ?? "Analisi non riuscita: controlla il file e riprova.");
        return;
      }
      if (!data.plan.some((p) => p.restore)) {
        setLoadError("Il backup non contiene tabelle ripristinabili (solo log append-only o tabelle sconosciute).");
        return;
      }
      setPlan({ plan: data.plan, meta: data.meta ?? { createdAt: null, createdBy: null, appVersion: null, fileTables: 0 } });
      setJson(data.json);
    } catch {
      setLoadError("Upload non riuscito: controlla la connessione e riprova.");
    } finally {
      setAnalyzing(false);
    }
  }

  function resetPlan() {
    setConfirmText("");
    setFileName("");
    setFileSize(0);
    setLoadError(null);
    setPlan(null);
    setJson("");
    setCheckedState({});
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function toggleTable(table: string, next: boolean) {
    setCheckedState((s) => ({ ...s, [table]: next }));
  }

  return (
    <div className="space-y-4">
      {/* Esito restore precedente (query string) */}
      {done && (
        <GlassNotice tone="success">
          <p className="font-semibold">Restore completato</p>
          <p className="mt-1 text-xs font-normal leading-relaxed">
            {Object.entries(done.restored)
              .map(([t, n]) => `${t}: ${n} righe`)
              .join(" · ")}
            {done.sequences.length ? ` · ${done.sequences.join(", ")}` : ""}
            {done.skipped.length
              ? ` · saltate: ${done.skipped.map((s) => `${s.table} (${s.reason})`).join(", ")}`
              : ""}
          </p>
        </GlassNotice>
      )}

      {restoreError && <GlassNotice tone="warning">{restoreError}</GlassNotice>}

      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/70 text-slate-700 ring-1 ring-white/70 shadow-sm">
          <Undo2 className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-900">Ripristina da backup</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
            Carica un file di backup: vedi il piano (righe nel file vs attuali), scegli le tabelle e conferma scrivendo «RIPRISTINA».
            L&apos;operazione sostituisce il contenuto delle tabelle scelte dentro una transazione: o tutto, o niente.
          </p>
        </div>
      </div>

      {/* ── Fase 1: upload + piano ──────────────────────────────────── */}
      {!plan && (
        <div className="rounded-3xl border border-white/60 bg-white/45 p-4 ring-1 ring-white/40 backdrop-blur-xl">
          <label className="block text-xs font-semibold text-slate-600" htmlFor="restore-file">
            File di backup (.json)
          </label>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              id="restore-file"
              type="file"
              accept="application/json,.json"
              className="w-full max-w-md cursor-pointer rounded-2xl border border-white/70 bg-white/65 px-3 py-2 text-sm text-slate-700 file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-slate-900 file:px-3.5 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-slate-800"
            />
            <GlassButton type="button" variant="glass" size="sm" onClick={onAnalyze} disabled={analyzing}>
              {analyzing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FileUp className="h-3.5 w-3.5" aria-hidden />}
              Analizza il backup
            </GlassButton>
          </div>
          {loadError && (
            <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-red-700" role="alert">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {loadError}
            </p>
          )}
          <p className="mt-2 text-[11px] text-slate-400">
            Il file non viene salvato da nessuna parte: viene analizzato e resta in questa pagina fino alla conferma.
          </p>
        </div>
      )}

      {/* ── Fase 2: piano + conferma esplicita ──────────────────────── */}
      {plan && json && (
        <div className="rounded-3xl border border-amber-300/60 bg-amber-50/60 p-4 ring-1 ring-amber-200/60 backdrop-blur-xl">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-900">
                Backup del {fmtDate(plan.meta.createdAt)} · {totalBackup} righe nel file vs {totalLive} attuali
              </p>
              <p className="mt-0.5 text-xs text-amber-800/80">
                {plan.meta.createdBy ? `creato da ${plan.meta.createdBy} · ` : ""}app v{plan.meta.appVersion ?? "?"} · {plan.meta.fileTables} tabelle nel file
                {fileName ? ` · ${fileName} (${fmtBytes(fileSize)})` : ""}
              </p>
            </div>
          </div>

          {/* Le checkbox stanno DENTRO il form: sono il payload «tables»
              dell'azione (fuori dal form l'azione non le riceve — beccato
              nel test e2e: il guard ha bloccato tutto, nessun dato toccato). */}
          <form action={restoreConfirmAction} onSubmit={() => toastSaved("restore_done")} className="mt-3 space-y-3">
            <input type="hidden" name="json" value={json} />
            <ul className="divide-y divide-amber-200/70">
              {plan.plan.map((p) => (
                <li key={p.table} className="flex items-center justify-between gap-3 py-2">
                  <label className="flex min-w-0 items-center gap-2.5">
                    <input
                      type="checkbox"
                      name="tables"
                      value={p.table}
                      checked={checkedState[p.table] ?? p.restore}
                      onChange={(e) => toggleTable(p.table, e.target.checked)}
                      disabled={!p.restore}
                      className="h-4 w-4 shrink-0 accent-brand-600 disabled:opacity-40"
                    />
                    <span className="min-w-0">
                      <span className={`block truncate text-sm font-medium ${p.restore ? "text-slate-800" : "text-slate-400 line-through"}`}>
                        {p.table}
                      </span>
                      {!p.restore && (
                        <span className="block text-[11px] text-slate-500">{p.reason}</span>
                      )}
                    </span>
                  </label>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-slate-600" title="righe nel file → righe attuali">
                    {p.backupRows} → {p.liveRows}
                  </span>
                </li>
              ))}
            </ul>
            <div className="rounded-2xl bg-white/70 p-3 ring-1 ring-amber-200">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
                <p className="text-xs leading-relaxed text-slate-700">
                  Le tabelle selezionate verranno <strong>svuotate e riscritte</strong> con i dati del backup: i record creati dopo il backup andranno persi.
                  I log append-only (audit) non vengono mai toccati.
                </p>
              </div>
              <label className="mt-3 block text-xs font-semibold text-slate-700" htmlFor="restore-confirm">
                Per confermare scrivi <span className="font-mono">{CONFIRM_WORD}</span>
              </label>
              <input
                id="restore-confirm"
                name="confirm"
                type="text"
                autoComplete="off"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={CONFIRM_WORD}
                className="mt-1 w-full max-w-xs rounded-2xl border border-white/80 bg-white px-3 py-2 font-mono text-sm text-slate-800 outline-none focus:border-brand-400"
              />
            </div>
            {missingDeps.length > 0 && (
              <GlassNotice tone="warning">
                <span className="text-xs">Selezione incompleta — {missingDeps.join(" · ")}. Includi anche le tabelle indicate, poi conferma.</span>
              </GlassNotice>
            )}
            {missingCascades.length > 0 && (
              <GlassNotice tone="warning">
                <span className="text-xs">
                  Perdita di dati — {missingCascades.join(" · ")}: le tabelle figlie non selezionate verrebbero svuotate (cascade). Includile nella selezione o non ripristinare la parent.
                </span>
              </GlassNotice>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <ConfirmSubmit disabled={!canConfirm} />
              <GlassButton type="button" variant="glass" onClick={resetPlan}>
                Annulla
              </GlassButton>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
