/**
 * FIXTURE del bug reale (chat, 2026-09): icona lucide + testo dentro un
 * `<a>` non-flex a text-center. Con Preflight l'svg diventa display:block:
 * icona su riga propria, testo sotto. DEVE essere segnalato.
 */
import { Phone } from "lucide-react";

export function ChatCtaBug() {
  return (
    <a
      href="tel:+393202792782"
      className="rounded-full bg-brand-600/90 px-5 py-3 text-center text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-brand-500/90"
    >
      <Phone className="h-4 w-4" aria-hidden /> Ti chiamo adesso — Daniele
    </a>
  );
}
