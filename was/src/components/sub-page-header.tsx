import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * Header standard delle pagine-scheda di Impostazioni e Ambrosio: back-link
 * verso l'hub + titolo con icona + sottotitolo operativo. Un solo pattern,
 * come già per le schede di Tools: si capisce SEMPRE da dove si è arrivati
 * e come si torna.
 */
export function SubPageHeader({
  backHref,
  backLabel,
  Icon,
  tone = "text-brand-600",
  title,
  subtitle,
  right,
}: {
  backHref: string;
  backLabel: string;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  tone?: string;
  title: string;
  subtitle: React.ReactNode;
  /** CTA opzionale allineata a destra (es. bottone salva). */
  right?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {backLabel}
        </Link>
        <h1 className="mt-2 flex items-center gap-2.5 text-2xl font-bold text-slate-900">
          <Icon className={`h-6 w-6 ${tone}`} aria-hidden />
          {title}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </header>
  );
}
