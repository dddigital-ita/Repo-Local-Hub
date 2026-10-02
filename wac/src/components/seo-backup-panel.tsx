"use client";

import { useRef, useState, useTransition } from "react";
import { CalendarClock, Download, FileDiff, LoaderCircle, Upload } from "lucide-react";
import { GlassButton } from "@/components/glass";
import { toastSaved } from "@/components/admin-toaster";
import { seoBackupDiffAction } from "@/app/admin/actions";

interface DiffRow {
  page: string;
  section: string;
  change: string;
}

const CHANGE_LABEL: Record<string, string> = {
  added: "verrà AGGIUNTO",
  removed: "verrà RIMOSSO",
  changed: "verrà MODIFICATO",
};
const CHANGE_CLS: Record<string, string> = {
  added: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  removed: "bg-red-50 text-red-700 ring-red-200",
  changed: "bg-amber-50 text-amber-700 ring-amber-200",
};

/**
 * Backup della config SEO: download JSON dell'intera config (meta,
 * contenuti, redirect, storico, avvisi), DIFF VISUALE prima di importare
 * e ripristino da file con conferma — l'import SOVRASCRIVE la config.
 */
export default function SeoBackupPanel({
  backups,
}: {
  /** Snapshot automatici del cron (il più recente in testa). */
  backups: { takenAt: string; takenBy: string }[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [busy, setBusy] = useState<"export" | "import" | "diff" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [diff, setDiff] = useState<{ rows: DiffRow[]; exportedAt: string | null; exportedBy: string | null } | null>(null);
  const [, startTransition] = useTransition();

  function doExport() {
    if (busy) return;
    setBusy("export");
    // Il download è una GET protetta da sessione: un link basta, il cookie
    // parte con la navigazione. Il filename è impostato dal server.
    const a = document.createElement("a");
    a.href = "/api/admin/seo/config.json";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setMessage({ tone: "ok", text: "Backup scaricato: conservalo prima di grossi cambiamenti." });
    setBusy(null);
  }

  function pickFile(f: File | null) {
    setMessage(null);
    setDiff(null);
    const ok = f !== null && f.type === "application/json";
    setSelected(ok ? f : null);
    if (f && !ok) {
      setMessage({ tone: "warn", text: "Il file deve essere JSON (quello scaricato dall'export)." });
      return;
    }
    if (!f) return;
    // Diff automatico appena selezionato il file: cosa cambiarebbe l'import.
    setBusy("diff");
    startTransition(async () => {
      try {
        const text = await f.text();
        const res = await seoBackupDiffAction(text);
        if (res.ok) {
          setDiff({ rows: res.rows as DiffRow[], exportedAt: res.exportedAt, exportedBy: res.exportedBy });
        } else {
          setMessage({ tone: "warn", text: res.error });
          setSelected(null);
          if (fileRef.current) fileRef.current.value = "";
        }
      } catch {
        setMessage({ tone: "warn", text: "Errore leggendo il file: riprova." });
        setSelected(null);
      } finally {
        setBusy(null);
      }
    });
  }

  function doImport() {
    if (!selected || busy || !diff) return;
    setBusy("import");
    startTransition(async () => {
      try {
        const text = await selected.text();
        const res = await fetch("/api/admin/seo/config.json", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: text,
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (res.ok && data.ok) {
          toastSaved("seo_backup");
          setMessage({ tone: "ok", text: "Config ripristinata dal backup: tutte le pagine sono già aggiornate." });
        } else {
          setMessage({ tone: "warn", text: data.error ?? "Import non riuscito: controlla il file e riprova." });
        }
        setSelected(null);
        if (fileRef.current) fileRef.current.value = "";
      } catch {
        setMessage({ tone: "warn", text: "Errore di rete durante l'import: riprova tra poco." });
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-900">Backup della configurazione</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
            Scarica un JSON con tutto quello che è personalizzato nello strumento SEO — meta globali e
            per pagina, contenuti, slug, redirect, storici e avvisi — da conservare prima di grossi
            cambiamenti. L&apos;import sostituisce l&apos;intera config con quella del file.
          </p>
        </div>
        <GlassButton type="button" variant="glass" size="sm" disabled={busy !== null} onClick={doExport}>
          {busy === "export" ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Download className="h-3.5 w-3.5" aria-hidden />
          )}
          Scarica backup JSON
        </GlassButton>
      </div>

      {/* ── Snapshot automatici (cron settimanale, max 4) ────────── */}
      <div className="mt-3 rounded-2xl bg-white/55 p-3 ring-1 ring-white/60">
        <p className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <CalendarClock className="h-3.5 w-3.5 text-brand-600" aria-hidden />
          Snapshot automatici (settimanali)
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
            {backups.length}/4
          </span>
        </p>
        {backups.length === 0 ? (
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            Il cron archivia la config una volta a settimana (se è cambiata): il primo snapshot
            apparirà qui dopo il prossimo tick ({""}
            <span className="font-mono text-[10px]">/api/cron/tick</span>).
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {backups.map((b) => (
              <li
                key={b.takenAt}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/70 px-3 py-2 ring-1 ring-white/60"
              >
                <span className="text-[11px] text-slate-600">
                  {new Date(b.takenAt).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" })}
                </span>
                <a
                  href={`/api/admin/seo/backups/${encodeURIComponent(b.takenAt)}`}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                >
                  <Download className="h-3 w-3" aria-hidden />
                  Scarica
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
          Gli snapshot restano nel database (i più vecchi cadono oltre 4) e si scaricano nello stesso
          formato dell&apos;export manuale: si possono ri-importare nel pannello qui sopra, col diff
          prima del ripristino.
        </p>
      </div>

      <div className="mt-3 rounded-2xl bg-white/55 p-3 ring-1 ring-white/60">
        <label className="block text-xs font-semibold text-slate-600">
          Ripristina da file
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full cursor-pointer rounded-2xl border border-white/70 bg-white/65 px-3 py-2.5 text-xs text-slate-600 outline-none focus:border-brand-400 focus:bg-white"
          />
        </label>
        {/* Diff pre-import: cosa cambiarebbe il ripristino. Obbligatorio
            prima del bottone — niente import alla cieca. */}
        {busy === "diff" && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
            <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden />
            Confronto con la config attuale…
          </p>
        )}
        {diff && (
          <div className="mt-2 rounded-xl bg-white/70 px-3 py-2.5 ring-1 ring-white/70">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
              <FileDiff className="h-3.5 w-3.5 text-brand-600" aria-hidden />
              Cosa cambiarebbe l&apos;import
              {diff.exportedAt && (
                <span className="font-normal text-slate-400">
                  · backup del {new Date(diff.exportedAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}
                  {diff.exportedBy ? ` da ${diff.exportedBy}` : ""}
                </span>
              )}
            </p>
            {diff.rows.length === 0 ? (
              <p className="mt-1 text-[11px] text-slate-500">
                Nessuna differenza: la config attuale è già identica al backup.
              </p>
            ) : (
              <ul className="mt-1.5 max-h-52 space-y-1 overflow-y-auto">
                {diff.rows.map((r, i) => (
                  <li key={`${r.page}-${r.section}-${i}`} className="flex items-center gap-2 text-[11px]">
                    <span
                      className={`inline-block w-28 shrink-0 rounded-full px-2 py-0.5 text-center text-[10px] font-semibold ring-1 ${CHANGE_CLS[r.change] ?? "bg-slate-100 text-slate-600 ring-slate-200"}`}
                    >
                      {CHANGE_LABEL[r.change] ?? r.change}
                    </span>
                    <span className="shrink-0 font-semibold text-slate-600">{r.section}</span>
                    <span className="truncate text-slate-700" title={r.page}>
                      {r.page}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!selected || !diff || busy !== null}
            onClick={() => {
              if (confirm(`Ripristinare «${selected?.name}»? L'intera config SEO verrà SOVRASCRITTA con quella del backup.`)) {
                doImport();
              }
            }}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-brand-600/90 px-3.5 py-1.5 text-[11px] font-semibold text-white shadow-glass-btn transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-40"
          >
            {busy === "import" ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Upload className="h-3.5 w-3.5" aria-hidden />
            )}
            Ripristina config
          </button>
          {selected && <span className="text-[11px] text-slate-500">{selected.name}</span>}
        </div>
        {message && (
          <p
            role={message.tone === "warn" ? "alert" : "status"}
            className={`mt-2 text-[11px] font-medium ${message.tone === "ok" ? "text-emerald-700" : "text-amber-700"}`}
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
