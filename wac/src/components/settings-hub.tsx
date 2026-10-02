import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";

/**
 * Scheda-link per gli hub (Impostazioni, Ambrosio): UNA scheda = UNA pagina
 * dedicata. Stesso gesto di /admin/tools: apri, regoli, chiudi — l'hub resta
 * ordinato anche quando le schede crescono.
 */
export function HubCard({
  href,
  Icon,
  tone,
  title,
  text,
  right,
}: {
  href: string;
  Icon: LucideIcon;
  /** Classi del tile-icona: «bg-white/70 text-brand-700 ring-1 ring-white/70» ecc. */
  tone: string;
  title: string;
  text: string;
  /** Badge di stato opzionale in alto a destra (es. «Attiva», «Predisposto»). */
  right?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-2xl bg-white/55 p-4 ring-1 ring-white/60 transition hover:bg-white/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl shadow-sm ring-1 ring-slate-900/5 ${tone}`}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          {title}
          <ChevronRight
            className="h-3.5 w-3.5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand-600"
            aria-hidden
          />
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{text}</span>
      </span>
      {right && <span className="shrink-0 self-center">{right}</span>}
    </Link>
  );
}

/**
 * Pill di stato per i badge «right» degli hub e per l'agenda della Panoramica.
 * - ok (verde): configurazione completa e attiva / nessun pendio operativo.
 * - warn (ambra): la scheda funziona MA la configurazione è incompleta o
 *   spenta di proposito: merita un colpo d'occhio dall'hub, non è un errore.
 * - danger (rosso): SCADENZA VIOLATA (ticket in ritardo SLA, promessa non
 *   mantenuta): si deve agire adesso — solo l'agenda operativa lo usa.
 * - neutro (grigio): default/predefinito, nessuna azione attesa.
 */
export function HubStatus({
  ok,
  warn = false,
  danger = false,
  label,
}: {
  ok: boolean;
  /** true = tono ambra anche se ok è false: «Da collegare» non è un guasto. */
  warn?: boolean;
  /** true = tono rosso: la finestra è già violata (agenda operativa). */
  danger?: boolean;
  label: string;
}) {
  const tone = ok
    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70"
    : danger
      ? "bg-red-50 text-red-700 ring-1 ring-red-200/70"
      : warn
        ? "bg-amber-50 text-amber-800 ring-1 ring-amber-300/70"
        : "bg-slate-100 text-slate-600 ring-1 ring-slate-300/70";
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}>
      <span
        className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : danger ? "bg-red-500" : warn ? "bg-amber-500" : "bg-slate-400"}`}
        aria-hidden
      />
      {label}
    </span>
  );
}

/** Pill numerica neutra per i conteggi live dell'hub (N risposte, N FAQ…). */
export function HubCount({ n, label }: { n: number; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200/70 tabular-nums">
      {n}
      {label && <span className="font-medium text-slate-500">{label}</span>}
    </span>
  );
}
