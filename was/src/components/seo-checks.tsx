import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

/**
 * Checklist on-page condivisa: usata dall'editor meta (title/description/
 * cannibalizzazione) e dall'editor contenuti (H1 e FAQ effettivi). Stessa
 * primitiva, così entrambi i pannelli mostrano i controlli allo stesso modo
 * e si aggiornano live mentre l'operatore digita.
 */

export type CheckState = "ok" | "warn" | "fail";

export interface Check {
  state: CheckState;
  label: string;
  hint?: string;
}

/** Normalizza testo per i confronti: minuscole, niente accenti/punteggiatura. */
export function normText(v: string): string {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "full" = keyword intera (o tutte le sue parole), "partial" = qualche parola, "none" = assente. */
export function keywordCoverage(keyword: string, hay: string): "full" | "partial" | "none" {
  const kwN = normText(keyword);
  const hayN = normText(hay);
  if (!kwN) return "none";
  if (hayN.includes(kwN)) return "full";
  const tokens = kwN.split(" ").filter((t) => t.length >= 4);
  if (tokens.length === 0) return "none";
  const present = tokens.filter((t) => hayN.includes(t)).length;
  if (present === tokens.length) return "full";
  if (present > 0) return "partial";
  return "none";
}

/** Verifica FAQ: quante domande toccano la keyword (intera o per token). */
export function faqKeywordCount(keyword: string, questions: string[]): number {
  const kwN = normText(keyword);
  const tokens = kwN.split(" ").filter((t) => t.length >= 4);
  if (!kwN) return 0;
  return questions.filter((q) => {
    const qn = normText(q);
    return qn.includes(kwN) || tokens.some((t) => qn.includes(t));
  }).length;
}

export function SeoChecklist({ checks, title = "Checklist on-page" }: { checks: Check[]; title?: string }) {
  const icons: Record<CheckState, typeof CheckCircle2> = { ok: CheckCircle2, warn: AlertTriangle, fail: XCircle };
  const colors: Record<CheckState, string> = { ok: "text-emerald-600", warn: "text-amber-600", fail: "text-red-600" };
  const toFix = checks.filter((c) => c.state !== "ok").length;
  return (
    <div className="rounded-2xl bg-white/70 px-4 py-3 ring-1 ring-white/70">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">
        {title}
        {toFix > 0 ? ` · ${toFix} da sistemare` : " · tutto ok"}
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {checks.map((c) => {
          const Icon = icons[c.state];
          return (
            <li key={c.label} className="flex items-start gap-2 text-xs">
              <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${colors[c.state]}`} aria-hidden />
              <span className="text-slate-700">
                {c.label}
                {c.hint && <span className="block text-[11px] leading-relaxed text-slate-400">{c.hint}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
