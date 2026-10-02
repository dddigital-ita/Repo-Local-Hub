"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, SendHorizonal } from "lucide-react";
import { addTicketNote, replyToTicket } from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";

/**
 * Composer risposta + nota interna con coda di invio: ogni submit parte in
 * catena nell'ordine, il doppio click non duplica, il campo si svuota subito
 * (UI reattiva) e si ripristina solo se l'invio fallisce.
 */

function useEnqueue() {
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const router = useRouter();
  return (task: () => Promise<unknown>, toastKey?: string) => {
    chain.current = chain.current
      .then(task)
      .then(() => {
        if (toastKey) toastSaved(toastKey);
      })
      .catch(() => router.refresh());
  };
}

/**
 * Risposte rapide: configurabili dall'agente in /admin/settings e salvate su
 * DB (content_settings). La pagina ticket le passa già pronte al composer.
 */
const REPLY_MAX = 4000;

/** Auto-resize del textarea: cresce col contenuto fino a un tetto (12 righe). */
function autoResize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 288)}px`; // ~12 righe
}

export function ReplyComposer({
  conversationId,
  quickReplies = [],
}: {
  conversationId: string;
  quickReplies?: string[];
}) {
  const [sending, setSending] = useState(false);
  const [len, setLen] = useState(0);
  const enqueue = useEnqueue();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const input = form.elements.namedItem("body") as HTMLTextAreaElement;
    const body = input.value.trim();
    if (!body) return;
    const fd = new FormData();
    fd.set("conversationId", conversationId);
    fd.set("body", body);
    input.value = ""; // svuota subito: l'invio parte in coda
    input.style.height = ""; // e il textarea torna compatto
    setLen(0);
    setSending(true);
    enqueue(
      () => replyToTicket(fd).finally(() => setSending(false)),
      "ticket_reply",
    );
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Invio invia; Shift+Invio va a capo (convenzione delle chat moderne);
    // ⌘/Ctrl+Invio invia anche da qualunque posizione del cursore.
    if (e.key === "Enter" && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <div className="space-y-1.5">
      <form onSubmit={submit} className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor={`reply-${conversationId}`} className="sr-only">
            Risposta al cliente
          </label>
          <textarea
            id={`reply-${conversationId}`}
            name="body"
            rows={2}
            required
            maxLength={REPLY_MAX}
            autoComplete="off"
            onKeyDown={onKeyDown}
            onInput={(e) => {
              autoResize(e.currentTarget);
              setLen(e.currentTarget.value.length);
            }}
            placeholder="Rispondi al cliente…"
            className="w-full resize-none rounded-2xl border border-white/60 bg-white/80 px-4 py-2.5 text-sm leading-relaxed outline-none backdrop-blur-xl transition placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          />
        </div>
        <button
          type="submit"
          disabled={sending}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-brand-600/90 px-5 py-2.5 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-brand-500/90 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
        >
          {sending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <SendHorizonal className="h-4 w-4" aria-hidden />
          )}
          Invia
        </button>
      </form>
      {/* Barra strumenti: risposte rapide a sinistra, hint tastiera + contatore a destra */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="flex flex-wrap gap-1.5">
          {quickReplies.map((r) => (
            <button
              key={r}
              type="button"
              title="Inserisci la risposta rapida nel composer"
              onClick={() => {
                const ta = document.getElementById(`reply-${conversationId}`) as HTMLTextAreaElement | null;
                if (ta) {
                  ta.value = r;
                  ta.focus();
                  autoResize(ta);
                  setLen(r.length);
                }
              }}
              className="min-h-11 rounded-full border border-white/50 bg-white/50 px-3 py-1.5 text-[11px] font-medium text-slate-600 transition hover:bg-white/90 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              {r}
            </button>
          ))}
        </div>
        <p className="ml-auto inline-flex items-center gap-2 text-[11px] text-slate-500">
          <span className="hidden sm:inline">
            <kbd className="rounded border border-slate-200/80 bg-white/70 px-1 font-sans text-[10px] font-semibold">Invio</kbd> invia ·{" "}
            <kbd className="rounded border border-slate-200/80 bg-white/70 px-1 font-sans text-[10px] font-semibold">Shift+Invio</kbd> a capo
          </span>
          <span className={`tabular-nums ${len > REPLY_MAX * 0.9 ? "font-semibold text-amber-700" : ""}`}>
            {len}/{REPLY_MAX}
          </span>
        </p>
      </div>
    </div>
  );
}

export function TicketNoteComposer({ conversationId }: { conversationId: string }) {
  const [sending, setSending] = useState(false);
  const enqueue = useEnqueue();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const ta = form.elements.namedItem("body") as HTMLTextAreaElement;
    const body = ta.value.trim();
    if (!body) return;
    const fd = new FormData();
    fd.set("conversationId", conversationId);
    fd.set("body", body);
    ta.value = "";
    setSending(true);
    enqueue(
      () => addTicketNote(fd).finally(() => setSending(false)),
      "ticket_note",
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <label htmlFor={`note-${conversationId}`} className="sr-only">
        Nota interna
      </label>
      <textarea
        id={`note-${conversationId}`}
        name="body"
        rows={2}
        required
        placeholder="Nota visibile solo al team…"
        className="w-full resize-none rounded-2xl border border-white/60 bg-white/70 px-3 py-2 text-xs outline-none backdrop-blur-xl transition placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      />
      <button
        type="submit"
        disabled={sending}
        className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full border border-white/50 bg-white/60 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
      >
        {sending && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />}
        Aggiungi nota
      </button>
    </form>
  );
}
