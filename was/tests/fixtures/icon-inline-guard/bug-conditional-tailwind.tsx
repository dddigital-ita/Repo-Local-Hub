/**
 * FALSO-SICURO da condizionali Tailwind: le classi condizionali finiscono
 * sugli SPAN interni, non sull'ospite che contiene icona+testo. L'ospite
 * resta block: l'icona va a capo. DEVE essere segnalato (è esattamente
 * il bug visto nel vivo su Next.js).
 */
import { Phone } from "lucide-react";

export function TailwindConditionalsBug() {
  return (
    <a
      href="tel:+393202792782"
      className="rounded-full bg-brand-600/90 px-5 py-3 text-center text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl"
    >
      <span className="sm:flex sm:items-center sm:gap-2">
        <Phone className="h-4 w-4" aria-hidden />
      </span>
      <span className="hidden sm:flex sm:items-center">Ti chiamo adesso</span>
    </a>
  );
}
