"use client";

import { HelpCircle, MousePointerClick, Sparkles } from "lucide-react";

/**
 * Statistiche d'uso delle FAQ: quali risposte ufficiali Ambrosio usa davvero
 * e quante conversazioni convertono in lead o callback. Le FAQ mai usate
 * compaiono con zero, in fondo ma visibili: anche il silenzio è un dato.
 */

export interface FaqUsageRow {
  faqId: string;
  question: string;
  active: boolean;
  uses: number;
  conversations: number;
  leads: number;
  callbacks: number;
}

export default function FaqUsageTable({ rows, days }: { rows: FaqUsageRow[]; days: number }) {
  if (rows.length === 0) return null;

  const used = rows.filter((r) => r.uses > 0);
  const never = rows.filter((r) => r.uses === 0);

  return (
    <div className="mt-5 rounded-2xl bg-white/50 p-3.5 ring-1 ring-violet-100/70">
      <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <MousePointerClick className="h-3.5 w-3.5" aria-hidden />
        Risposte usate negli ultimi {days} giorni — e quante convertono
      </p>

      {used.length > 0 ? (
        <table className="mt-2.5 w-full text-left text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-slate-400">
              <th scope="col" className="py-1.5 pr-2 font-semibold">Risposta ufficiale</th>
              <th scope="col" className="py-1.5 px-1 text-right font-semibold" title="Quante volte Ambrosio l'ha usata">Usi</th>
              <th scope="col" className="py-1.5 px-1 text-right font-semibold" title="Conversazioni con almeno un uso">Chat</th>
              <th scope="col" className="py-1.5 px-1 text-right font-semibold" title="Conversazioni che hanno generato un lead">Lead</th>
              <th scope="col" className="py-1.5 px-1 text-right font-semibold" title="Conversazioni con callback prenotata">Appunt.</th>
            </tr>
          </thead>
          <tbody>
            {used.map((r) => {
              const convRate = r.conversations > 0 ? Math.round((r.callbacks / r.conversations) * 100) : 0;
              return (
                <tr key={r.faqId} className="border-t border-violet-100/70">
                  <td className="max-w-0 py-2 pr-2">
                    <span className="block truncate font-medium text-slate-800" title={r.question}>
                      «{r.question}»
                    </span>
                    {r.conversations > 0 && (
                      <span
                        className={`text-[10px] font-semibold ${convRate >= 30 ? "text-emerald-600" : convRate > 0 ? "text-slate-400" : "text-slate-300"}`}
                      >
                        {convRate > 0 ? `${convRate}% → appuntamento` : "0% → appuntamento finora"}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-1 text-right font-bold tabular-nums text-slate-900">{r.uses}</td>
                  <td className="py-2 px-1 text-right tabular-nums text-slate-500">{r.conversations}</td>
                  <td className="py-2 px-1 text-right tabular-nums text-slate-500">{r.leads}</td>
                  <td className={`py-2 px-1 text-right font-bold tabular-nums ${r.callbacks > 0 ? "text-emerald-700" : "text-slate-300"}`}>
                    {r.callbacks}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="mt-2.5 flex items-center gap-1.5 text-xs text-slate-400">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Nessun uso registrato ancora: le statistiche compaiono quando Ambrosio risponde ai clienti.
        </p>
      )}

      {never.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400">
          <HelpCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>
            Mai usate finora: {never.map((r) => `«${r.question}»`).join(", ")}. O il cliente non le chiede più,
            oppure la risposta non combacia: vale la pena rivederne la domanda.
          </span>
        </p>
      )}
    </div>
  );
}
