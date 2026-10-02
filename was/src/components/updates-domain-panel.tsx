"use client";

import { useState } from "react";
import { Bot, Download, FileUp, History, RotateCcw, Save, ShieldCheck, Tag, Trash2 } from "lucide-react";
import { GlassButton, GlassNotice, GlassSectionHeader } from "@/components/glass";
import {
  importAnteprimaAction,
  importConfermaAction,
  importScartaAction,
  releaseCreaAction,
  releaseRipristinaAction,
  snapshotRipristinaAction,
  snapshotSalvaAction,
} from "@/app/admin/updates-actions";
import { DOMINI, RELEASE_MAX, SNAPSHOT_MAX, labelDominio } from "@/lib/domain-snapshots-shared";
import type { ReleaseLabel, SnapshotEntry } from "@/lib/domain-snapshots-shared";

/** Formato data compatto coerente con il resto dell'admin (it-IT). */
function fmtDate(d: string): string {
  return new Date(d).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

/** Descrizione sintetica del payload (conta le chiavi di primo livello). */
function sommario(data: unknown): string {
  if (!data || typeof data !== "object") return "vuoto";
  const chiavi = Object.keys(data as Record<string, unknown>);
  return chiavi.length === 1 ? chiavi[0] : `${chiavi.length} chiavi: ${chiavi.slice(0, 4).join(", ")}${chiavi.length > 4 ? "…" : ""}`;
}

/** Anteprima d'import (dal server, già validata e con diff calcolato). */
interface Pending {
  dominio: string;
  generato: string;
  sha256: string;
  creatoDa: string;
  creatoAt: string;
  righe: Array<{ chiave: string; stato: "uguale" | "cambiata" | "nuova"; prima: string; dopo: string }>;
}

interface Props {
  /** storico per dominio (dal server). */
  storici: Record<string, SnapshotEntry[]>;
  dbOk: boolean;
  /** Messaggio di esito (query string, via azioni). */
  updatesMessage?: string;
  /** Import in sospeso: anteprima con diff, in attesa di conferma o scarto. */
  pending?: Pending | null;
  /** Etichette di release (FASE 3, dal server). */
  release: ReleaseLabel[];
}

export default function UpdatesDomainPanel({ storici, dbOk, updatesMessage, pending, release }: Props) {
  const [nota, setNota] = useState("");
  const [dominioAperto, setDominioAperto] = useState<string | null>(null);
  const [nomeRelease, setNomeRelease] = useState("");
  const [notaRelease, setNotaRelease] = useState("");

  return (
    <div className="space-y-4">
      <GlassSectionHeader
        icon={History}
        title="Aggiornamenti per dominio"
        subtitle="Ogni area salva i propri snapshot (dedup automatico), con changelog e ripristino puntuale; le etichette di release raggruppano gli snapshot correnti di tutti i domini. L'export «per gemello» porta solo ciò che è gemello-pari: mai segreti o testi di sito."
      />

      {updatesMessage && (
        <GlassNotice tone={updatesMessage.startsWith("ERRORE") ? "warning" : "success"}>
          {updatesMessage}
        </GlassNotice>
      )}

      {!dbOk && (
        <p className="rounded-xl bg-amber-50/90 px-3 py-2 text-xs font-medium text-amber-800 ring-1 ring-amber-200/60">
          Database non configurato: snapshot e ripristino non disponibili.
        </p>
      )}

      {dbOk && (
        <>
          {/* Salva snapshot: scelta del dominio + nota */}
          <form
            action={snapshotSalvaAction}
            className="rounded-3xl border border-white/60 bg-white/45 p-4 ring-1 ring-white/40 backdrop-blur-xl"
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm">
                <Save className="h-4 w-4" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-slate-900">Salva snapshot adesso</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Congela lo stato attuale del dominio scelto. Identico al precedente → nessun duplicato.
                </p>
              </div>
              <select
                name="dominio"
                required
                className="rounded-2xl border border-white/70 bg-white/65 px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-400 focus:bg-white"
                aria-label="Dominio dello snapshot"
              >
                {DOMINI.filter((d) => d.attivo).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
              <input
                name="nota"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Nota (il perché), es. «prima della nuova palette»"
                maxLength={200}
                className="min-w-0 flex-1 rounded-2xl border border-white/70 bg-white/65 px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-400 focus:bg-white"
                aria-label="Nota dello snapshot"
              />
              <GlassButton type="submit" size="sm">
                <Save className="h-4 w-4" aria-hidden />
                Salva
              </GlassButton>
            </div>
          </form>

          {/* ── Etichette di release (FASE 3) ── */}
          <form
            action={releaseCreaAction}
            className="rounded-3xl border border-white/60 bg-white/45 p-4 ring-1 ring-white/40 backdrop-blur-xl"
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm">
                <Tag className="h-4 w-4" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-slate-900">Crea etichetta di release</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Congela gli snapshot correnti di TUTTI i domini in un punto nominato (es. tools-fix-2026-10-05).
                </p>
              </div>
              <input
                name="nome"
                value={nomeRelease}
                onChange={(e) => setNomeRelease(e.target.value)}
                placeholder="Nome: tools-fix-2026-10-05"
                required
                maxLength={60}
                className="min-w-0 flex-1 rounded-2xl border border-white/70 bg-white/65 px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-400 focus:bg-white"
                aria-label="Nome dell'etichetta di release"
              />
              <input
                name="nota"
                value={notaRelease}
                onChange={(e) => setNotaRelease(e.target.value)}
                placeholder="Nota (il perché), es. «fix prezzi chat»"
                maxLength={200}
                className="min-w-0 flex-1 rounded-2xl border border-white/70 bg-white/65 px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-400 focus:bg-white"
                aria-label="Nota dell'etichetta di release"
              />
              <GlassButton type="submit" size="sm">
                <Tag className="h-4 w-4" aria-hidden />
                Crea etichetta
              </GlassButton>
            </div>
          </form>

          {release.length > 0 && (
            <div className="rounded-3xl border border-white/60 bg-white/45 p-4 ring-1 ring-white/40 backdrop-blur-xl">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70 text-slate-700 ring-1 ring-white/70">
                  <Tag className="h-4 w-4" aria-hidden />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">Etichette di release</h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {release.length}/{RELEASE_MAX} conservate · il ripristino coordinato riporta ogni dominio allo
                    snapshot che l&apos;etichetta congela.
                  </p>
                </div>
              </div>
              <ul className="mt-3 divide-y divide-white/60">
                {release.map((r) => (
                  <li key={r.nome} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        <span className="font-mono">{r.nome}</span>{" "}<span className="font-normal text-slate-500">del {fmtDate(r.creataAt)} di {r.creataDa}</span>
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {r.nota ? `«${r.nota}» · ` : ""}
                        {Object.entries(r.punti)
                          .map(([dom, at]) => `${labelDominio(dom)} ${fmtDate(at)}`)
                          .join(" · ")}
                      </p>
                    </div>
                    <form
                      action={releaseRipristinaAction}
                      onSubmit={(e) => {
                        if (
                          !confirm(
                            `Ripristinare TUTTI i domini all'etichetta «${r.nome}»? Ogni dominio torna al suo snapshot dell'etichetta: le modifiche successive vengono sovrascritte.`,
                          )
                        ) {
                          e.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="nome" value={r.nome} />
                      <GlassButton type="submit" variant="glass" size="sm">
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                        Ripristina coordinato
                      </GlassButton>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Import dall'export «per gemello» (FASE 2) ── */}
          {pending ? (
            <div className="rounded-3xl border border-brand-300/70 bg-brand-50/60 p-4 ring-1 ring-brand-200/50 backdrop-blur-xl">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-900">
                    Anteprima import — {labelDominio(pending.dominio)}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Export del {fmtDate(pending.generato)} ({pending.creatoDa}) · {pending.righe.filter((r) => r.stato !== "uguale").length} righe cambiate. La conferma salva
                    prima uno snapshot dello stato attuale (rollback a un click).
                  </p>
                </div>
              </div>
              <div className="mt-3 overflow-x-auto rounded-2xl bg-white/70 ring-1 ring-white/70">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="px-3 py-2 font-medium">Chiave</th>
                      <th className="px-3 py-2 font-medium">Stato</th>
                      <th className="px-3 py-2 font-medium">Attuale</th>
                      <th className="px-3 py-2 font-medium">In arrivo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/70">
                    {pending.righe.map((r) => (
                      <tr key={r.chiave} className={r.stato === "uguale" ? "text-slate-400" : "font-medium text-slate-800"}>
                        <td className="px-3 py-1.5 font-mono">{r.chiave}</td>
                        <td className="px-3 py-1.5">{r.stato}</td>
                        <td className="max-w-[220px] truncate px-3 py-1.5">{r.prima || "—"}</td>
                        <td className="max-w-[220px] truncate px-3 py-1.5">{r.dopo || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <form action={importScartaAction}>
                  <GlassButton type="submit" variant="glass" size="sm">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    Scarta
                  </GlassButton>
                </form>
                <form
                  action={importConfermaAction}
                  onSubmit={(e) => {
                    if (!confirm("Applicare l'import? Prima viene salvato uno snapshot dello stato attuale.")) e.preventDefault();
                  }}
                >
                  <input type="hidden" name="sha256" value={pending.sha256} />
                  <GlassButton type="submit" size="sm">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                    Conferma import
                  </GlassButton>
                </form>
              </div>
            </div>
          ) : (
            <form
              action={importAnteprimaAction}
              encType="multipart/form-data"
              className="rounded-3xl border border-white/60 bg-white/45 p-4 ring-1 ring-white/40 backdrop-blur-xl"
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70 text-slate-700 ring-1 ring-white/70">
                  <FileUp className="h-4 w-4" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-slate-900">Import da export «per gemello»</h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Carica il JSON esportato sull&apos;altro sito: prima il diff, poi la conferma. Gli export completi (con segreti) sonorifiutati di proposito.
                  </p>
                </div>
                <input
                  type="file"
                  name="file"
                  accept="application/json,.json"
                  required
                  className="min-w-0 flex-1 rounded-2xl border border-white/70 bg-white/65 px-3 py-2 text-sm text-slate-700 outline-none file:mr-3 file:rounded-xl file:border-0 file:bg-white/80 file:px-3 file:py-1 file:text-xs file:font-medium file:text-slate-700"
                  aria-label="File export da importare"
                />
                <GlassButton type="submit" size="sm">
                  Anteprima
                </GlassButton>
              </div>
            </form>
          )}

          {/* Una sezione per dominio */}
          {DOMINI.map((d) => {
            const storico = storici[d.id] ?? [];
            const aperto = dominioAperto === d.id;
            return (
              <div key={d.id} className="rounded-3xl border border-white/60 bg-white/45 p-4 ring-1 ring-white/40 backdrop-blur-xl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70 text-slate-700 ring-1 ring-white/70">
                      {d.icona === "bot" ? <Bot className="h-4 w-4" aria-hidden /> : <History className="h-4 w-4" aria-hidden />}
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900">{d.label}</h3>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {d.attivo
                          ? storico.length === 0
                            ? "Nessuno snapshot: salvalane uno prima di una modifica rischiosa."
                            : `Ultimo: ${fmtDate(storico[0].takenAt)} di ${storico[0].takenBy}${storico[0].nota ? ` — «${storico[0].nota}»` : ""} · ${storico.length}/${SNAPSHOT_MAX} conservati`
                          : "Stub: la sezione si attiva quando il ticketing entra nello strumento."}
                      </p>
                    </div>
                  </div>
                  {d.attivo && storico.length > 0 && (
                    <div className="flex shrink-0 items-center gap-2">
                      <a
                        href={`/api/admin/updates-export/${d.id}`}
                        className="rounded-full p-2 text-slate-400 transition hover:bg-white hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                        aria-label={`Esporta ${labelDominio(d.id)} (completo)`}
                        title="Export completo (locale)"
                      >
                        <Download className="h-4 w-4" aria-hidden />
                      </a>
                      <a
                        href={`/api/admin/updates-export/${d.id}?per=gemello`}
                        className="rounded-full p-2 text-slate-400 transition hover:bg-white hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                        aria-label={`Esporta ${labelDominio(d.id)} per il gemello`}
                        title="Export per il gemello (whitelist: niente segreti, niente testi di sito)"
                      >
                        <Bot className="h-4 w-4 rotate-180" aria-hidden />
                      </a>
                      <GlassButton type="button" variant="glass" size="sm" onClick={() => setDominioAperto(aperto ? null : d.id)}>
                        {aperto ? "Chiudi" : `Storico (${storico.length})`}
                      </GlassButton>
                    </div>
                  )}
                </div>

                {d.attivo && aperto && (
                  <ul className="mt-3 divide-y divide-white/60">
                    {storico.map((s) => (
                      <li key={s.takenAt} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-800">
                            {fmtDate(s.takenAt)} <span className="font-normal text-slate-500">di {s.takenBy}</span>
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {s.nota ? `«${s.nota}» · ` : ""}
                            {sommario(s.data)} · sha {s.sha256.slice(0, 8)}
                          </p>
                        </div>
                        <form
                          action={snapshotRipristinaAction}
                          onSubmit={(e) => {
                            if (!confirm(`Ripristinare ${labelDominio(d.id)} allo snapshot del ${fmtDate(s.takenAt)}? Le modifiche successive a questo dominio vengono sovrascritte.`)) {
                              e.preventDefault();
                            }
                          }}
                        >
                          <input type="hidden" name="dominio" value={d.id} />
                          <input type="hidden" name="takenAt" value={s.takenAt} />
                          <button
                            type="submit"
                            className="rounded-full p-2 text-slate-400 transition hover:bg-white hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                            aria-label={`Ripristina ${labelDominio(d.id)} allo snapshot del ${fmtDate(s.takenAt)}`}
                          >
                            <RotateCcw className="h-4 w-4" aria-hidden />
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}

          <p className="text-[11px] text-slate-400">
            Gli snapshot vivono in content_settings (max {SNAPSHOT_MAX} per dominio, i più vecchi cadono), le etichette di release in
            una chiave unica (max {RELEASE_MAX}) e l&apos;azione resta nell&apos;audit (append-only). L&apos;export «per gemello» usa la whitelist:
            il gemello importa scegliendo lo snapshot dal suo pannello dopo il confronto dei contenuti.
          </p>
        </>
      )}
    </div>
  );
}
