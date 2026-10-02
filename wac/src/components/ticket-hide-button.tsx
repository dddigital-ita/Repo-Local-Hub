"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, LoaderCircle } from "lucide-react";
import { archiveTicket } from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";

/**
 * Pulsante «Nascondi» sulla card del ticket: archiviazione soft, il ticket
 * sparisce dalla lista e finisce nel banner di ripristino. State di
 * transizione Next (useTransition): la card resta cliccabile durante l'update.
 */
export default function TicketHideButton({ ticketId }: { ticketId: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const router = useRouter();

  if (done) return null;

  return (
    <button
      type="button"
      aria-label="Nascondi il ticket dalla inbox (puoi ripristinarlo dal banner)"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault(); // dentro un <Link>: non aprire il dettaglio
        e.stopPropagation();
        const fd = new FormData();
        fd.set("id", ticketId);
        startTransition(async () => {
          await archiveTicket(fd);
          toastSaved("ticket_archived");
          setDone(true);
          router.refresh();
        });
      }}
      className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-400 opacity-0 transition group-hover/ticket:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50 max-sm:pointer-events-none max-sm:opacity-0"
    >
      {pending ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <Archive className="h-3.5 w-3.5" aria-hidden />
      )}
    </button>
  );
}
