"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, LoaderCircle, RotateCcw } from "lucide-react";
import { restoreTicket } from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";

/**
 * Banner dei ticket archiviati come spam/vuoti: collassato di default (zero
 * rumore), si apre su click e permette il ripristino singolo. Il conteggio
 * arriva dal server (counts.archived), gli item dalla lista caricata lì.
 */

export interface ArchivedItem {
  id: string;
  number: number;
  initial_query: string | null;
  message_count: string;
}

export default function ArchivedTicketsBanner({
  items,
  total,
}: {
  items: ArchivedItem[];
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const router = useRouter();

  if (!total) return null;

  async function restore(id: string, _number: number) {
    setRestoring(id);
    try {
      const fd = new FormData();
      fd.set("id", id);
      await restoreTicket(fd);
      toastSaved("ticket_restored");
      router.refresh();
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div className="glass-solid rounded-2xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="archived-list"
        className="flex min-h-11 w-full items-center gap-2 rounded-2xl px-3.5 py-2.5 text-left text-sm font-medium text-slate-600 transition hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        <Archive className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        <span>
          {total} {total === 1 ? "ticket nascosto" : "ticket nascosti"} (vuoti o spam)
        </span>
        <span
          className={`ml-auto text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          ▾
        </span>
      </button>
      {open && (
        <ul id="archived-list" className="space-y-1 border-t border-white/60 px-2 py-2">
          {items.map((t) => (
            <li key={t.id} className="flex items-center gap-2 rounded-xl px-1.5 py-1 text-xs">
              <span className="font-mono font-semibold text-slate-500">#{t.number}</span>
              <span className="min-w-0 flex-1 truncate text-slate-600">
                «{t.initial_query || "senza query"}» · {t.message_count} msg
              </span>
              <button
                type="button"
                onClick={() => restore(t.id, t.number)}
                disabled={restoring === t.id}
                className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-white/50 bg-white/60 px-3 py-1.5 font-semibold text-slate-700 transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50"
              >
                {restoring === t.id ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                )}
                Ripristina
              </button>
            </li>
          ))}
          {items.length < total && (
            <li className="px-1.5 py-1 text-[11px] text-slate-400">
              Altri {total - items.length} non mostrati: ripristinali dalla ricerca.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
