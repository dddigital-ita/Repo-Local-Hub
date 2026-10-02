"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { updateLeadStatus } from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";

const STATUSES = ["nuovo", "contattato", "chiuso"] as const;

/**
 * Pills di stato (nuovo/contattato/chiuso) con stato ottimistico.
 * Il click aggiorna subito la UI e le richieste partono IN CATENA
 * nell'ordine dei click: cliccando a raffica l'ULTIMO click vince
 * sempre — niente più click "persi" né scritture fuori ordine.
 * Se una richiesta fallisce, la pagina si riallinea ai dati del DB.
 */
export default function StatusPills({
  leadId,
  initial,
}: {
  leadId: string;
  initial: string;
}) {
  const [status, setStatus] = useState(initial);
  const [pending, setPending] = useState(false);
  const latest = useRef<string>(initial);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const router = useRouter();

  function pick(next: string) {
    if (next === latest.current) return;
    latest.current = next;
    setStatus(next); // UI immediata
    const fd = new FormData();
    fd.set("id", leadId);
    fd.set("status", next);
    setPending(true);
    const me = next;
    chain.current = chain.current
      .then(() => updateLeadStatus(fd))
      .then(() => {
        if (latest.current === me) toastSaved("lead_status");
      })
      .catch(() => {
        // Scrittura fallita: riallineo la UI alla verità del DB
        if (latest.current === me) router.refresh();
      })
      .finally(() => {
        if (latest.current === me) setPending(false);
      });
  }

  return (
    <div
      role="group"
      aria-label="Stato del lead"
      className="inline-flex rounded-full bg-slate-200/70 p-1 backdrop-blur-xl"
    >
      {STATUSES.map((s) => {
        const active = status === s;
        return (
          <button
            key={s}
            type="button"
            aria-pressed={active}
            onClick={() => pick(s)}
            className={`relative rounded-full px-3.5 py-1.5 text-xs font-medium capitalize transition ${
              active ? "text-slate-900" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {active && (
              <motion.span
                layoutId={`pill-${leadId}`}
                className="absolute inset-0 rounded-full bg-white shadow-sm"
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
            <span className="relative z-10">{s}</span>
          </button>
        );
      })}
      {pending && (
        <span className="sr-only" role="status">
          Salvataggio…
        </span>
      )}
    </div>
  );
}
