"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, CheckCircle2, UserCheck, X } from "lucide-react";
import { bulkTicketsAction } from "@/app/admin/actions";

/**
 * BULK ACTIONS sulla coda (parità col gemello WebAgencyCrema): checkbox per
 * card + barra azioni contestuale. Client-only, zero migration, le azioni
 * ESISTONO già lato server in loop (validazione + audit per ticket).
 *
 * Il file espone DUE pezzi che parlano con eventi window — lo stesso
 * pattern di admin-toaster (wac:saved) — perché la checkbox vive DENTRO
 * la riga di ogni ticket (RSC) mentre la barra vive UNA volta per pagina:
 * niente prop drilling attraverso il server component.
 *
 *   <TicketBulkToggle id={tk.id} />   → checkbox nella griglia della riga
 *   <TicketBulkBar ids={...} ... />   → la barra fissa, un'istanza sola
 *
 * La selezione si SVUOTA quando cambia la coda (pagina/filtro/ricerca):
 * non si agisce su ciò che non si vede più.
 */

const EVT_SELECT = "wac:bulk-select";
const EVT_ALL = "wac:bulk-all";

/** Checkbox della singola riga: segnala la selezione via evento. */
export function TicketBulkToggle({ id }: { id: string }) {
  // «Tutti» nell'header deve ACCENDERE anche le checkbox delle righe: solo
  // con l'evento la barra contava giusto ma le righe restavano spente —
  // disallineamento visivo che il gemello viveva e qui l'E2E non vuole più
  // (miglioramento consapevole sul gemello, stesso protocollo di eventi).
  // L'input resta non controllato: l'evento comanda SOLO il flag visivo,
  // la selezione vera vive nella barra.
  const boxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function onAll(e: Event) {
      const { ids, on } = (e as CustomEvent<{ ids: string[]; on: boolean }>).detail;
      if (boxRef.current) boxRef.current.checked = on && ids.includes(id);
    }
    window.addEventListener(EVT_ALL, onAll);
    return () => window.removeEventListener(EVT_ALL, onAll);
  }, [id]);
  return (
    <label
      // min-h-11 su mobile (target ≥44px, regola del repo), compatto su sm+.
      className="flex min-h-11 w-full cursor-pointer items-center justify-center self-center sm:min-h-9"
      title="Seleziona per azioni multiple"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={boxRef}
        type="checkbox"
        aria-label="Seleziona ticket per azioni multiple"
        className="h-4 w-4 cursor-pointer accent-brand-600"
        onChange={(e) => {
          window.dispatchEvent(new CustomEvent(EVT_SELECT, { detail: { id, on: e.target.checked } }));
        }}
      />
    </label>
  );
}

/** La barra contestuale: fissa in fondo quando c'è una selezione.
 *  `onlySelector` = versione compatta per l'header della coda (solo il
 *  toggle «tutti»; la barra vera è montata una volta per pagina). */
export default function TicketBulkBar({
  ids,
  canClaim,
  onlySelector = false,
}: {
  /** Gli id della coda CORRENTE (pagina + filtro). */
  ids: string[];
  /** Il claim richiede un operatore collegato all'admin (come l'azione singola). */
  canClaim: boolean;
  onlySelector?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Il selettore «tutti» (istanza onlySelector nell'header) parla con la
  // barra via evento: DUE istanze del componente NON condividono lo state —
  // senza questo, «tutti» nell'header non accende la barra in fondo
  // (beccato in E2E sul gemello: la barra aspettava una selezione che non
  // arrivava).
  useEffect(() => {
    function onAll(e: Event) {
      const { ids: tutti, on } = (e as CustomEvent<{ ids: string[]; on: boolean }>).detail;
      setSelected(on ? new Set(tutti) : new Set());
    }
    window.addEventListener(EVT_ALL, onAll);
    return () => window.removeEventListener(EVT_ALL, onAll);
  }, []);
  // Cambio pagina/filtro/ricerca = nuova coda: la selezione non sopravvive
  // a ciò che non si vede più. DERIVATO, non state-effect: la selezione
  // visibile è l'intersezione con la coda corrente.
  const selectedInCoda = useMemo(() => {
    const coda = new Set(ids);
    return new Set([...selected].filter((id) => coda.has(id)));
  }, [ids, selected]);
  const n = selectedInCoda.size;
  const allSelected = ids.length > 0 && n === ids.length;

  // Le checkbox (nelle righe RSC) aggiornano la selezione via evento.
  useEffect(() => {
    function onSelect(e: Event) {
      const { id, on } = (e as CustomEvent<{ id: string; on: boolean }>).detail;
      setSelected((s) => {
        const next = new Set(s);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      });
    }
    window.addEventListener(EVT_SELECT, onSelect);
    return () => window.removeEventListener(EVT_SELECT, onSelect);
  }, []);

  // Il feedback del bulk è una GlassNotice della PAGINA (?bulk=op:n nel
  // redirect), non un toast: il testo dinamico col conteggio non sta nel
  // dizionario del toaster e la notizia merita di durare più di 2 secondi.

  function toggleAll(selectAll: boolean) {
    // La selezione è UNA ma vive in DUE istanze (header + barra): il
    // cambio passa dall'evento che entrambe ascoltano, così si allineano
    // senza prop drilling attraverso il server component.
    window.dispatchEvent(new CustomEvent(EVT_ALL, { detail: { ids, on: selectAll } }));
  }

  const selettore =
    ids.length > 0 && (
      <label
        className="ml-2 inline-flex cursor-pointer items-center gap-1.5 align-middle text-xs font-medium text-slate-500"
        title="Seleziona/deseleziona tutta la coda"
      >
        <input
          type="checkbox"
          aria-label="Seleziona tutta la coda per azioni multiple"
          checked={allSelected}
          onChange={(e) => toggleAll(e.target.checked)}
          className="h-4 w-4 cursor-pointer accent-brand-600"
        />
        tutti
      </label>
    );

  // Versione compatta per l'header della coda: solo il toggle «tutti» —
  // la barra vera è montata UNA volta per pagina, sotto la coda.
  if (onlySelector) return selettore;

  return (
    <>
      {/* Il selettore «tutti» vive nell'HEADER della coda (onlySelector):
          la barra in fondo non lo ripete — due checkbox «tutti» si accusano
          a vicenda di essere l'origine (strict mode, beccato in E2E). */}

      {n > 0 && (
        // z-[95]: sopra il banner cookie (z-90) — la barra è azione esplicita
        // dell'operatore autenticato, un banner non la seppellisce (beccato
        // in E2E sul gemello: «subtree intercepts pointer events»).
        // Mobile-first: full-width sotto 640px (le tre azioni si impilano
        // leggibili), poi pill centrata con lo spazio che avanza.
        <div className="fixed inset-x-2 bottom-3 z-[95] flex flex-col items-stretch gap-2.5 rounded-3xl border border-white/60 bg-white/90 px-4 py-3 shadow-glass-btn backdrop-blur-xl sm:inset-x-0 sm:bottom-4 sm:mx-auto sm:w-[min(94%,560px)] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p className="flex items-center justify-between text-sm font-semibold tabular-nums text-slate-900 sm:justify-start">
            <span>
              {n} {n === 1 ? "ticket selezionato" : "ticket selezionati"}
            </span>
            <button
              type="button"
              onClick={() => toggleAll(false)}
              className="inline-flex min-h-11 items-center text-xs font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-900 sm:min-h-9"
            >
              <X className="mr-0.5 inline h-3 w-3" aria-hidden />
              deseleziona
            </button>
          </p>
          {/* Mobile: le azioni si IMPILANO full-width (leggibili a pollice);
              desktop: pill compatte a destra. */}
          <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            {(
              [
                { op: "archive", label: "Archivia", Icon: Archive },
                { op: "close", label: "Chiudi", Icon: CheckCircle2 },
                ...(canClaim ? [{ op: "claim", label: "Prendi in carico", Icon: UserCheck }] : []),
              ] as const
            ).map(({ op, label, Icon }) => (
              <form
                key={op}
                action={bulkTicketsAction}
                onSubmit={() => setBusy(true)}
                className="sm:flex-none"
              >
                <input type="hidden" name="op" value={op} />
                <input type="hidden" name="ids" value={[...selectedInCoda].join(",")} />
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-slate-900/90 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 sm:min-h-9 sm:w-auto"
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {label}
                </button>
              </form>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
