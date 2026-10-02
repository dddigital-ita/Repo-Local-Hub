/**
 * Icona SENZA testo accanto (bottone tondo di cancellazione) e icona di
 * ricerca posizionata absolute dentro un contenitore relative con input:
 * LEGALI, non segnalare.
 */
import { Trash2, Search } from "lucide-react";

export function DeleteIconOnlyOk() {
  return (
    <button
      type="button"
      aria-label="Elimina lead"
      className="rounded-full p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

export function SearchInputOk() {
  return (
    <div className="relative max-w-md flex-1">
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        aria-hidden
      />
      <input
        id="q"
        name="q"
        placeholder="Cerca…"
        className="w-full rounded-full bg-white/60 px-10 py-2.5 text-sm"
      />
    </div>
  );
}
