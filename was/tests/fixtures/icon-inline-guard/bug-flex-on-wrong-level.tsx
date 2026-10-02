/**
 * Il flex c'è, ma sul contenitore SBAGLIATO: avvolge solo l'icona, il
 * testo resta fuori. L'accoppiata icona+testo non è sulla stessa riga
 * garantita. DEVE essere segnalato.
 */
import { MessageCircle } from "lucide-react";

export function FlexOnIconOnlyBug() {
  return (
    <a
      href="https://wa.me/393202792782"
      target="_blank"
      rel="noopener noreferrer"
      className="glass rounded-full px-5 py-3 text-center text-sm font-semibold text-slate-700"
    >
      <span className="inline-flex items-center justify-center">
        <MessageCircle className="h-4 w-4" aria-hidden />
      </span>
      Scrivici su WhatsApp
    </a>
  );
}
