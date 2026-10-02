"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";

/**
 * Toast di conferma stile iOS: pillola glass compatta che scivola da sopra
 * al centro-alto, resta ~2 secondi e svanisce. Ascolta l'evento custom
 * "wac:saved" così qualsiasi componente client può notificare senza props.
 */

const LABELS: Record<string, string> = {
  lead_status: "Stato lead aggiornato",
  lead_notes: "Nota salvata",
  ticket_claim: "Ticket preso in carico",
  ticket_assign: "Assegnazione salvata",
  ticket_priority: "Priorità aggiornata",
  ticket_status: "Ticket aggiornato",
  ticket_reply: "Risposta inviata al cliente",
  ticket_note: "Nota interna aggiunta",
  ticket_callback: "Callback fissata: vedi la pagina Callback",
  operator_toggle: "Disponibilità aggiornata",
  callback_done: "Callback segnata come fatta",
  callback_missed: "Callback segnata come mancata",
  callback_now: "Callback spostata in cima: da richiamare ora",
  callback_deleted: "Callback eliminata",
  lead_temperature: "Temperatura lead aggiornata",
  lead_recall: "Promemoria ricontatto fissato",
  lead_deleted: "Lead eliminato",
  operator_shifts: "Turni aggiornati",
  package_duplicated: "Pacchetto duplicato: modifica la copia",
  ai_prompt_reset: "Prompt di Ambrosio ripristinato",
  quick_replies: "Risposte rapide salvate",
  chat_emoji: "Emoji della chat salvate",
  sla_policy: "Policy SLA aggiornata",
  autoclose: "Chiusura automatica configurata",
  ticket_archived: "Ticket nascosto dalla inbox",
  ticket_restored: "Ticket ripristinato: è di nuovo nella sua lista",
  ticket_claimed: "Ticket preso in carico: ora è nella coda «Miei»",
  ticket_closed: "Ticket chiuso",
  ai_faq_saved: "Risposta insegnata a Ambrosio",
  ai_faq_deleted: "Risposta eliminata",
  backup_reminder: "Promemoria backup salvato",
  restore_done: "Restore completato: i dati sono tornati allo stato del backup",
  ambrosio_draft: "Bozza di Ambrosio inserita: rileggila e correggila",
  ambrosio_faq: "Risposta ufficiale inserita nell'editor",
  ambrosio_seo: "Meta proposti da Ambrosio: rileggili e salva",
  ambrosio_contenuti: "Contenuti proposti da Ambrosio: rileggili e salva",
  seo_backup: "Config SEO ripristinata dal backup",
  profilo_salvato: "Dati personali salvati",
  utente_creato: "Account creato",
  utente_aggiornato: "Utente aggiornato",
};

interface Toast {
  id: number;
  key: string;
}

export function toastSaved(key: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("wac:saved", { detail: key }));
  }
}

export default function AdminToaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    let seq = 0;
    function onSaved(e: Event) {
      const key = (e as CustomEvent<string>).detail ?? "salvato";
      const id = ++seq;
      setToasts((t) => [...t.slice(-2), { id, key }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2000);
    }
    window.addEventListener("wac:saved", onSaved);
    return () => window.removeEventListener("wac:saved", onSaved);
  }, []);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2"
    >
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: -24, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 480, damping: 32 }}
            className="glass-strong flex items-center gap-2 rounded-full px-4 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#34C759]/15">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#34C759]" aria-hidden />
            </span>
            <span className="text-sm font-medium text-slate-800">
              {LABELS[t.key] ?? "Salvato"}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
