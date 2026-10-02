/**
 * Bottone glass del design system: la classe vive in una COSTANTE stringa
 * del modulo (glassButtonBase = "inline-flex items-center …") unita via
 * cn(). LEGALE: il guard deve risolvere la costante.
 */
import { Download } from "lucide-react";

const glassButtonBase =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition";

export function GlassButtonOk() {
  return (
    <button
      type="button"
      className={`${glassButtonBase} bg-brand-600/90 text-white shadow-glass-btn`}
    >
      <Download className="h-3.5 w-3.5" aria-hidden />
      Scarica backup
    </button>
  );
}

/** Variante con cn(): anche qui la costante deve bastare. */
export function GlassButtonCnOk() {
  return (
    <button
      type="button"
      className={`${glassButtonBase} bg-white/60 text-slate-700`}
    >
      <Download className="h-3.5 w-3.5" aria-hidden />
      Salva
    </button>
  );
}
