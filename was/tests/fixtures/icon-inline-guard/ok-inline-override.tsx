/**
 * Override esplicito di Preflight: la classe `inline` sull'ICONA stessa
 * sostituisce il display:block e la tiene sulla riga di testo (pattern
 * del reset password admin e delle frecce inline). LEGALE, non segnalare.
 */
import { KeyRound } from "lucide-react";

export function InlineOverrideOk() {
  return (
    <button
      type="submit"
      className="w-full rounded-full bg-brand-600/90 px-5 py-3 text-sm font-semibold text-white shadow-glass-btn"
    >
      <KeyRound className="mr-1.5 inline size-4" aria-hidden />
      Imposta password
    </button>
  );
}
