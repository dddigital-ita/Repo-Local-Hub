"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";

/**
 * Ricerca A RICHIESTA (progressive disclosure): collassata è un bottone
 * «Cerca» — sulla inbox il gesto più frequente è scansionare, la casella
 * vuota era un'inutile promessa permanente. Si espande al click (focus
 * automatico), si richiude con Escape o blur senza testo; se una ricerca
 * è attiva resta aperta con il bottone «Annulla» accanto.
 */

export default function TicketSearch({
  q,
  filter,
  channel,
}: {
  q?: string;
  filter?: string;
  channel?: string;
}) {
  const [open, setOpen] = useState(Boolean(q));
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Con query attiva la casella resta aperta: il valore è DERIVATO da `q`,
  // quindi non serve sincronizzarlo in effect (l'utente può sempre riaprire).
  const openDerived = open || Boolean(q);

  function collapseIfEmpty() {
    const value = inputRef.current?.value ?? "";
    if (!value && !q) setOpen(false);
  }

  return (
    <>
      {!openDerived ? (
        <button
          type="button"
          className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/50 bg-white/70 px-4 text-sm font-medium text-slate-600 transition hover:bg-white hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          onClick={() => {
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          <Search className="h-4 w-4" aria-hidden />
          Cerca
        </button>
      ) : (
        <form
          ref={formRef}
          action="/admin/tickets"
          method="get"
          className="flex items-center gap-2"
          role="search"
          onSubmit={() => collapseIfEmpty}
        >
          {/* I filtri attivi attraversano la ricerca: cercare dentro «Miei»
              non deve azzerare il contesto (già nella vecchia form inline). */}
          {filter && filter !== "aperti" && <input type="hidden" name="f" value={filter} />}
          {channel && channel !== "all" && <input type="hidden" name="channel" value={channel} />}
          <div className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <label htmlFor="ticket-search" className="sr-only">Cerca ticket</label>
            <input
              ref={inputRef}
              id="ticket-search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Cerca: «sito ristorante», nome, 340…, #8"
              autoFocus={!q}
              className="w-full rounded-full border border-white/50 bg-white/70 py-2 pl-10 pr-4 text-sm outline-none backdrop-blur-xl transition placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
              onBlur={collapseIfEmpty}
            />
          </div>
          {q && (
            <Link
              href="/admin/tickets"
              className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Annulla
            </Link>
          )}
        </form>
      )}
    </>
  );
}
