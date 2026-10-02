"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, RefreshCw, TrendingUp } from "lucide-react";
import { GlassButton } from "@/components/glass";
import { UiIcon } from "@/components/icon-registry";
import { seoGscQueriesAction } from "@/app/admin/actions";

/**
 * Pannello «Query reali» (Search Console): le ricerche con cui il sito è
 * apparso su Google davvero, affiancate alle keyword configurate. I dati
 * arrivano SOLO on-demand via server action (nessuna chiamata API a ogni
 * render dell'admin) e restano server-side: qui passano solo le righe.
 */

interface GscRow {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
}

interface GscData {
  rows: GscRow[];
  siteUrl: string;
  days: number;
}

/** Normalizza per il matching: minuscole, senza accenti e punteggiatura. */
function norm(v: string): string {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Match lasco in entrambe le direzioni: «seo salento» ↔ «consulenza seo a salento». */
function matches(query: string, keyword: string): boolean {
  const q = norm(query);
  const k = norm(keyword);
  return q.length > 0 && k.length > 0 && (q.includes(k) || k.includes(q));
}

function fmt(n: number): string {
  return n.toLocaleString("it-IT");
}

export default function SeoGscPanel({ keywords }: { keywords: string[] }) {
  const [data, setData] = useState<GscData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function load() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await seoGscQueriesAction();
        if (res.ok) setData(res.data as GscData);
        else setError(res.error);
      } catch {
        setError("Search Console non raggiungibile: riprova tra poco.");
      }
    });
  }

  const rows = data?.rows ?? [];
  const totalClicks = rows.reduce((a, r) => a + r.clicks, 0);
  const totalImpr = rows.reduce((a, r) => a + r.impressions, 0);
  const ctr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0;
  const avgPos =
    totalImpr > 0 ? rows.reduce((a, r) => a + r.position * r.impressions, 0) / totalImpr : 0;

  const covered = new Set<string>();
  for (const r of rows) {
    for (const kw of keywords) {
      if (matches(r.query, kw)) {
        covered.add(norm(kw));
        break;
      }
    }
  }
  const uniqueKeywords = Array.from(new Map(keywords.map((k) => [norm(k), k])).values());
  const uncovered = uniqueKeywords.filter((k) => !covered.has(norm(k)));

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-900">Query reali di Search Console</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
            Le ricerche con cui il sito compare davvero su Google (ultimi 28 giorni, dati Google con
            2–3 giorni di ritardo), affiancate alle keyword configurate: vedi cosa porta traffico e
            cosa invece è configurato ma mai cercato.
          </p>
        </div>
        <GlassButton type="button" variant="glass" size="sm" disabled={pending} onClick={load}>
          {pending ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          )}
          {data ? "Aggiorna" : "Carica query reali"}
        </GlassButton>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-2xl bg-amber-50 px-3.5 py-3 text-sm font-medium text-amber-800 ring-1 ring-amber-200">
          {error}
        </p>
      )}

      {!data && !error && (
        <p className="mt-3 text-xs text-slate-400">
          Il caricamento interroga Google on demand: nulla viene chiamato finché non premi il
          bottone. Serve il collegamento API in{" "}
          <span className="font-semibold text-slate-500">Admin → Tools → Search Console</span>.
        </p>
      )}

      {data && (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            {[
              { label: "Query viste", value: fmt(rows.length) },
              { label: "Click", value: fmt(totalClicks) },
              { label: "Impressioni", value: fmt(totalImpr) },
              { label: "CTR · pos. media", value: `${ctr.toFixed(1)}% · ${avgPos.toFixed(1)}` },
            ].map((k) => (
              <div key={k.label} className="rounded-2xl bg-white/55 p-3 ring-1 ring-white/60">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{k.label}</p>
                <p className="mt-0.5 flex items-center gap-1 text-lg font-bold tabular-nums text-slate-900">
                  <TrendingUp className="h-4 w-4 text-brand-600" aria-hidden />
                  {k.value}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-3 overflow-x-auto rounded-2xl ring-1 ring-white/60">
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="sr-only">Query reali da Search Console con keyword configurata affiancata</caption>
              <thead>
                <tr className="bg-white/60 text-[11px] uppercase tracking-wide text-slate-500">
                  <th scope="col" className="px-3 py-2 font-semibold">Query su Google</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Keyword configurata</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Click</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Impr.</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Pos.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/60">
                {rows.slice(0, 25).map((r) => {
                  const kw = keywords.find((k) => matches(r.query, k));
                  return (
                    <tr key={r.query} className="bg-white/40">
                      <td className="max-w-[260px] truncate px-3 py-2 font-medium text-slate-800">{r.query}</td>
                      <td className="px-3 py-2">
                        {kw ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                            {kw}
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                            non configurata
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmt(r.clicks)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmt(r.impressions)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.position.toFixed(1)}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="bg-white/40 px-3 py-4 text-center text-xs text-slate-500">
                      Nessuna query negli ultimi 28 giorni (sito nuovo o proprietà appena verificata).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {uniqueKeywords.length > 0 && (
            <div className="mt-3 rounded-2xl bg-white/45 px-3.5 py-3 ring-1 ring-white/50">
              <p className="text-xs font-semibold text-slate-800">
                Copertura keyword: {uniqueKeywords.length - uncovered.length}/{uniqueKeywords.length} cercate su Google
              </p>
              {uncovered.length > 0 ? (
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                  Configurate ma mai cercate nel periodo:{" "}
                  <span className="font-medium text-slate-600">{uncovered.slice(0, 8).join(" · ")}</span>
                  {uncovered.length > 8 ? ` — e altre ${uncovered.length - 8}.` : "."}
                </p>
              ) : (
                <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500">
                  Tutte le keyword configurate hanno generato impressioni.
                  <UiIcon name="target" size={11} />
                </p>
              )}
            </div>
          )}

          {rows.length > 25 && (
            <p className="mt-2 text-[11px] text-slate-400">
              Prime 25 query per click su {fmt(rows.length)} totali ({data.siteUrl}).
            </p>
          )}
        </>
      )}
    </div>
  );
}
