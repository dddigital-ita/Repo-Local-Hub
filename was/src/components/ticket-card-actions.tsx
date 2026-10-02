"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, CheckCheck, ChevronDown, LoaderCircle, UserCheck } from "lucide-react";
import { archiveTicket, claimTicket, setTicketStatus } from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";

/**
 * ZONA AZIONI DELLA CARD (colonna destra della griglia, FUORI dal link):
 * una sola azione primaria visibile — la decisione di triage più probabile —
 * e tutte le altre nel menu ⋯. Prima: bottoni annidati nella <Link> della
 * card (interattivi dentro interattivo, miss-click su touch, violazione
 * ARIA); ora la card linka col titolo e le azioni vivono nel loro spazio.
 *
 * Regole anti-danno (invanque cambiate):
 *  - «Chiudi» propone solo su ticket APERTI e mai in attesa del cliente;
 *    la conferma è esplicita (due click) e sta DENTRO il menu;
 *  - «Prendi in carico» solo se il ticket non è già tuo;
 *  - menu chiuso da: click fuori, Escape, navigazione.
 */

const itemCls =
  "flex w-full min-h-9 items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] font-medium text-slate-700 transition hover:bg-slate-100/80 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50";

export default function TicketCardActions({
  ticketId,
  open,
  waitingReply,
  mine,
}: {
  ticketId: string;
  open: boolean;
  waitingReply: boolean;
  mine: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmClose, setConfirmClose] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();
  const [gone, setGone] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [menuOpen]);

  function run(fn: (fd: FormData) => Promise<void>, toastKey: string, after?: () => void) {
    const fd = new FormData();
    fd.set("id", ticketId);
    setMenuOpen(false);
    startTransition(async () => {
      try {
        await fn(fd);
        toastSaved(toastKey);
        after?.();
        router.refresh();
      } catch {
        router.refresh(); // l'azione server gestisce gli errori interni
      }
    });
  }

  if (gone) return null;

  /* Azione primaria: la più probabile per QUESTO ticket. Chiudi quando il
     cliente aspetta una risposta sarebbe un errore di triage: al suo posto
     resta solo «Apri» (il gesto che la pagina raccomanda). */
  const primary = (() => {
    if (!mine) {
      return {
        label: "Prendi in carico",
        Icon: UserCheck,
        onClick: () => run(claimTicket, "ticket_claimed"),
      };
    }
    if (open && !waitingReply) {
      return {
        label: "Chiudi",
        Icon: CheckCheck,
        onClick: () => setConfirmClose(true),
      };
    }
    return null; // «Apri» è già la card intera: nessun bottone duplicato
  })();

  return (
    <div ref={rootRef} className="relative inline-flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        {primary && (
          <button
            type="button"
            disabled={pending}
            title={primary.label === "Prendi in carico" ? "Assegna il ticket a te: apparirà nella coda «Miei»" : "Chiude il ticket (chiederà conferma)"}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/80 px-3.5 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-900/10 transition hover:bg-white hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50 sm:min-h-9"
            onClick={primary.onClick}
          >
            {pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <primary.Icon className="h-3.5 w-3.5" aria-hidden />}
            {primary.label}
          </button>
        )}
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-haspopup="true"
          aria-label="Altre azioni sul ticket"
          disabled={pending}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/80 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <ChevronDown className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {menuOpen && (
        <div
          role="menu"
          aria-label="Altre azioni sul ticket"
          className="glass-strong absolute right-0 top-full z-30 mt-1 w-56 rounded-2xl p-1.5 shadow-glass"
        >
          {confirmClose ? (
            <>
              <p className="px-3 pb-1 pt-2 text-[11px] leading-snug text-slate-500">
                Chiudi il ticket? Chi può riaprirlo resta possibile, ma il cliente riceve l&apos;esito.
              </p>
              <button
                type="button"
                role="menuitem"
                disabled={pending}
                className="flex w-full min-h-9 items-center gap-2 rounded-lg bg-red-50/80 px-3 py-1.5 text-left text-[13px] font-semibold text-red-700 transition hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50"
                onClick={() => run((fd) => setTicketStatusWith(fd, "closed"), "ticket_closed", () => setConfirmClose(false))}
              >
                {pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CheckCheck className="h-3.5 w-3.5" aria-hidden />}
                Conferma chiusura
              </button>
              <button
                type="button"
                role="menuitem"
                className={itemCls}
                onClick={() => setConfirmClose(false)}
              >
                Annulla
              </button>
            </>
          ) : (
            <>
              {open && !waitingReply && (
                <button type="button" role="menuitem" disabled={pending} className={itemCls} onClick={() => setConfirmClose(true)}>
                  <CheckCheck className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                  Chiudi ticket…
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                disabled={pending}
                title="Nasconde il ticket dalla inbox (lo puoi ripristinare dal banner)"
                className={itemCls}
                onClick={() => run(archiveTicket, "ticket_archived", () => setGone(true))}
              >
                <Archive className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                Nascondi dalla inbox
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* setTicketStatus è una server action FormData: aggiunge «status» e delega. */
async function setTicketStatusWith(fd: FormData, status: string) {
  fd.set("status", status);
  await setTicketStatus(fd);
}
