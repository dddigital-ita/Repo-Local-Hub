"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StickyNote } from "lucide-react";
import { updateLeadNotes } from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";

/**
 * Form nota del lead con invio in coda: il campo si svuota subito,
 * un doppio click non duplica, e alla conferma arriva il toast iOS.
 */

/** Chiave sessionStorage dello stato aperto del <details> Note, per lead:
 * la lista si riordina a ogni dato nuovo (order by created_at) e un
 * <details> non controllato si richiude da solo al refresh — l'utente che
 * stava scrivendo una nota la perdeva di vista (euristica 3: controllo
 * e libertà). Chiave per lead: niente stato condiviso tra righe. */
export function detailsOpenKey(leadId: string): string {
  return `lead-notes-open:${leadId}`;
}

/** Il <details> Note con stato APERTO/CHIUSO persistito in sessionStorage.
 * NON controllato: il ripristino avviene manipolando il DOM via ref in
 * useLayoutEffect (prima del paint, nessun flash) — niente setState in
 * effect, che la purity del repo vieta; React non ha bisogno di sapere se
 * è aperto, il toggle persiste da solo nell'evento onToggle. */
export function LeadNotesDetails({
  leadId,
  initialNotes,
}: {
  leadId: string;
  initialNotes: string | null;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  // Ripristino una volta sola al mount, prima del primo paint: se l'utente
  // aveva lasciato le note aperte su QUESTO lead, il <details> si riapre
  // senza scatti (il server renderizza chiuso, il DOM viene corretto prima
  // di essere visto — niente hydration mismatch, è manipolazione diretta).
  useLayoutEffect(() => {
    try {
      if (sessionStorage.getItem(detailsOpenKey(leadId)) === "1") {
        if (detailsRef.current) detailsRef.current.open = true;
      }
    } catch {
      // storage bloccato: il <details> resta semplicemente effimero
    }
  }, [leadId]);

  function handleToggle(e: React.ToggleEvent<HTMLDetailsElement>) {
    // L'evento scatta anche per l'apertura programmatica qui sopra: riscrive
    // la stessa chiave, innocuo. Per il toggle dell'utente è la persistenza.
    try {
      if (e.currentTarget.open) sessionStorage.setItem(detailsOpenKey(leadId), "1");
      else sessionStorage.removeItem(detailsOpenKey(leadId));
    } catch {}
  }

  /* La nota è UN campo di testo (updateLeadNotes la sostituisce): il vecchio
     «Note (1)» suggeriva un contatore di note che non esiste. Al suo posto
     un'ANTEPRIMA dal vivo — riconosci la nota senza aprirla (euristica 6). */
  const label = initialNotes
    ? `Note: ${initialNotes.length > 36 ? `${initialNotes.slice(0, 36)}…` : initialNotes}`
    : "Note";

  return (
    <details ref={detailsRef} onToggle={handleToggle} className="w-full md:w-72">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-brand-700">
        <StickyNote className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </summary>
      <LeadNoteForm leadId={leadId} initialNotes={initialNotes} />
    </details>
  );
}

export default function LeadNoteForm({
  leadId,
  initialNotes,
}: {
  leadId: string;
  initialNotes: string | null;
}) {
  const [saving, setSaving] = useState(false);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const router = useRouter();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const ta = form.elements.namedItem("notes") as HTMLTextAreaElement;
    const notes = ta.value.trim().slice(0, 2000);
    const hadContent = notes.length > 0;
    if (!hadContent) return;
    const fd = new FormData();
    fd.set("id", leadId);
    fd.set("notes", notes);
    ta.value = "";
    setSaving(true);
    chain.current = chain.current
      .then(() => updateLeadNotes(fd))
      .then(() => toastSaved("lead_notes"))
      .catch(() => {
        ta.value = notes; // ripristino onesto se l'invio fallisce
        router.refresh();
      })
      .finally(() => setSaving(false));
  }

  return (
    <form onSubmit={submit} className="mt-2 space-y-2">
      <textarea
        name="notes"
        rows={3}
        defaultValue={initialNotes ?? ""}
        placeholder="Es. richiama martedì dopo le 15, interessato a e-commerce + SEO…"
        className="w-full resize-none rounded-2xl border border-white/60 bg-white/70 px-3 py-2 text-xs text-slate-700 shadow-inner backdrop-blur-xl outline-none placeholder:text-slate-500 focus:border-brand-300"
      />
      <button
        disabled={saving}
        className="rounded-full bg-brand-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
      >
        Salva nota
      </button>
    </form>
  );
}
