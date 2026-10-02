/**
 * Dizionario di varianti (pattern glassVariants): se OGNI valore della
 * const oggetto porta il token di layout, l'accesso `dict[variant]` è
 * legale qualunque sia la chiave. NON segnalare.
 */
import { Save } from "lucide-react";

const glassVariants = {
  primary: "inline-flex items-center justify-center gap-2 bg-brand-600 text-white",
  glass: "inline-flex items-center justify-center gap-2 glass text-slate-800",
  ghost: "inline-flex items-center justify-center gap-2 text-slate-600",
};

export function VariantButtonOk({ variant }: { variant: keyof typeof glassVariants }) {
  return (
    <button type="button" className={glassVariants[variant]}>
      <Save className="h-3.5 w-3.5" aria-hidden />
      Salva configurazione
    </button>
  );
}
