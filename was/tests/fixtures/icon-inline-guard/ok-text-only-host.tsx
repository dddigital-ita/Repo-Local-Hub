/**
 * L'icona vive in un contenitore intermedio flex (spans interni con
 * utility di layout), il testo sta accanto: l'antenato intermedio tra
 * icona e ospite garantisce il layout. LEGALE, non segnalare.
 */
import { TrendingUp } from "lucide-react";

export function StatLineOk() {
  return (
    <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
      <span className="flex items-center gap-1">
        <TrendingUp className="h-4 w-4 text-brand-600" aria-hidden />
        1.234
      </span>
      impressioni
    </p>
  );
}
