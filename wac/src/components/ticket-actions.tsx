"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  CalendarClock,
  CheckCircle2,
  LoaderCircle,
  Pin,
} from "lucide-react";
import {
  assignTicket,
  claimTicket,
  scheduleTicketCallback,
  setTicketPriority,
  setTicketStatus,
} from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";

/**
 * Stato ottimistico + coda condivisa: ogni click aggiorna subito la UI e le
 * richieste partono IN CATENA nell'ordine dei click — l'ultimo vince sempre,
 * anche a raffica. Su errore la pagina si riallinea ai dati reali del DB.
 */

/** Esportato: i pannelli upgrade (tag, escalation, merge)
 *  condividono la stessa coda concatenata. */
export function useChain() {
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const router = useRouter();
  const enqueue = (
    task: () => Promise<unknown>,
    mine: string,
    latest: () => string,
    toastKey?: string,
  ) => {
    chain.current = chain.current
      .then(task)
      .then(() => {
        if (toastKey && latest() === mine) toastSaved(toastKey);
      })
      .catch(() => {
        if (latest() === mine) router.refresh();
      });
  };
  return enqueue;
}

/* ── Prendi in carico + Assegna ─────────────────────────────────── */

/**
 * Porta il focus (e la vista) sul composer risposta: usato dal gesto
 * «Prendi in carico e rispondi» per un flusso a un solo click.
 */
function focusComposer(id: string) {
  const el = document.getElementById(id) as HTMLTextAreaElement | null;
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.focus({ preventScroll: true });
  const end = el.value.length;
  el.setSelectionRange(end, end); // cursore in fondo: si scrive subito
}

export function TicketAssignActions({
  ticketId,
  initialAssigned,
  operators,
  myOperatorId,
  replyTargetId,
}: {
  ticketId: string;
  initialAssigned: string | null;
  operators: { id: string; first_name: string }[];
  myOperatorId: string | null;
  /** Id della textarea del composer: se presente, il claim focusa anche la risposta. */
  replyTargetId?: string;
}) {
  const [assigned, setAssigned] = useState(initialAssigned);
  const [pending, setPending] = useState(false);
  const latest = useRef(initialAssigned ?? "");
  const enqueue = useChain();

  function run(fd: FormData, next: string, action: (fd: FormData) => Promise<unknown>, toastKey: string) {
    latest.current = next;
    setAssigned(next || null); // UI immediata
    setPending(true);
    enqueue(() => action(fd), next, () => latest.current, toastKey);
    setTimeout(() => setPending(false), 600);
  }

  function claim() {
    if (!myOperatorId) return;
    // Un solo gesto: il focus va sul composer subito (l'agente scrive mentre
    // il claim parte in catena), non dopo la risposta del server.
    if (replyTargetId) focusComposer(replyTargetId);
    const fd = new FormData();
    fd.set("id", ticketId);
    run(fd, myOperatorId, claimTicket, "ticket_claim");
  }

  function assign(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const next = String(fd.get("assigned_to") ?? "");
    fd.set("id", ticketId);
    run(fd, next, assignTicket, "ticket_assign");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {myOperatorId && assigned !== myOperatorId && (
        <button
          type="button"
          onClick={claim}
          title={replyTargetId ? "Ti assegna il ticket e porta il cursore sulla risposta" : undefined}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-brand-600/90 px-4 py-2 text-xs font-semibold text-white shadow-glass-btn transition hover:bg-brand-500/90 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <Pin className="h-3.5 w-3.5" aria-hidden />
          {replyTargetId ? "Prendi in carico e rispondi" : "Prendi in carico"}
        </button>
      )}
      <form onSubmit={assign} className="inline-flex items-center gap-1.5">
        <ArrowRightLeft className="h-3.5 w-3.5 text-slate-400" aria-hidden />
        <select
          name="assigned_to"
          aria-label="Assegna il ticket a"
          value={assigned ?? ""}
          onChange={(e) => {
            const fd = new FormData();
            fd.set("id", ticketId);
            fd.set("assigned_to", e.target.value);
            run(fd, e.target.value, assignTicket, "ticket_assign");
          }}
          className="min-h-11 rounded-full border border-white/50 bg-white/70 px-3 py-2 text-xs font-medium text-slate-700 outline-none backdrop-blur-xl transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <option value="">non assegnato</option>
          {operators.map((op) => (
            <option key={op.id} value={op.id}>
              {op.first_name}
            </option>
          ))}
        </select>
        {pending && (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-brand-600" aria-hidden />
        )}
        <span className="sr-only" role="status">
          {pending ? "Salvataggio in corso" : ""}
        </span>
      </form>
    </div>
  );
}

/* ── Priorità + Stato ───────────────────────────────────────────── */

export function TicketStatusActions({
  ticketId,
  initialPriority,
  initialStatus,
  priorities,
  priorityLabels,
  statusActions,
}: {
  ticketId: string;
  initialPriority: string;
  initialStatus: string;
  priorities: readonly string[];
  priorityLabels: Record<string, string>;
  statusActions: { value: string; label: string }[];
}) {
  const [priority, setPriority] = useState(initialPriority);
  const [status, setStatus] = useState(initialStatus);
  const [pending, setPending] = useState(false);
  const latest = useRef(`${initialPriority}|${initialStatus}`);
  const enqueue = useChain();

  function run(fd: FormData, nextKey: string, action: (fd: FormData) => Promise<unknown>, toastKey: string) {
    latest.current = nextKey;
    setPending(true);
    enqueue(() => action(fd), nextKey, () => latest.current, toastKey);
    setTimeout(() => setPending(false), 600);
  }

  function changePriority(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    setPriority(next); // UI immediata
    const [, cur] = latest.current.split("|");
    const fd = new FormData();
    fd.set("id", ticketId);
    fd.set("priority", next);
    run(fd, `${next}|${cur}`, setTicketPriority, "ticket_priority");
  }

  function changeStatus(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    if (next === status) return;
    setStatus(next); // UI immediata
    const [cur] = latest.current.split("|");
    const fd = new FormData();
    fd.set("id", ticketId);
    fd.set("status", next);
    run(fd, `${cur}|${next}`, setTicketStatus, "ticket_status");
  }

  const closed = status === "closed";

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <label className="inline-flex min-h-11 items-center gap-1.5">
        <span className="text-xs font-medium text-slate-500">Priorità</span>
        <select
          value={priority}
          onChange={changePriority}
          className="min-h-11 rounded-full border border-white/50 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700 outline-none backdrop-blur-xl transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {priorities.map((p) => (
            <option key={p} value={p}>
              {priorityLabels[p] ?? p}
            </option>
          ))}
        </select>
      </label>
      <label className="inline-flex min-h-11 items-center gap-1.5">
        <span className="text-xs font-medium text-slate-500">Stato</span>
        <select
          value={status}
          onChange={changeStatus}
          className="min-h-11 rounded-full border border-white/50 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700 outline-none backdrop-blur-xl transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {statusActions.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <span
        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
          closed ? "bg-slate-200/80 text-slate-600" : "bg-emerald-100/80 text-emerald-700"
        }`}
      >
        {closed ? "Chiuso" : "Aperto"}
      </span>
      {pending && <LoaderCircle className="h-3.5 w-3.5 animate-spin text-brand-600" aria-hidden />}
      <span className="sr-only" role="status">
        {pending ? "Salvataggio in corso" : ""}
      </span>
    </div>
  );
}

/* ── Fissa callback rapida ──────────────────────────────────────── */

export function TicketCallbackButton({
  conversationId,
  disabled = false,
}: {
  conversationId: string;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const enqueue = useChain();

  function schedule(hours: number) {
    if (pending) return;
    const fd = new FormData();
    fd.set("conversationId", conversationId);
    fd.set("hours", String(hours));
    setPending(true);
    enqueue(() => scheduleTicketCallback(fd), conversationId, () => conversationId, "ticket_callback");
    setTimeout(() => setPending(false), 600);
  }

  return (
    <div className="inline-flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
        <CalendarClock className="h-3.5 w-3.5" aria-hidden />
        Fissa callback:
      </span>
      {[
        { h: 1, label: "tra 1h" },
        { h: 3, label: "tra 3h" },
        { h: 24, label: "domani" },
      ].map(({ h, label }) => (
        <button
          key={h}
          type="button"
          disabled={disabled || pending}
          onClick={() => schedule(h)}
          className="min-h-11 rounded-full border border-white/50 bg-white/60 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white/90 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-40"
        >
          {label}
        </button>
      ))}
      {pending && <LoaderCircle className="h-3.5 w-3.5 animate-spin text-brand-600" aria-hidden />}
    </div>
  );
}

/** Badge "risolto" usato nella lista: marca visiva rapida dei ticket chiusi. */
export function TicketClosedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100/60 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
      <CheckCircle2 className="h-3 w-3" aria-hidden />
      Chiuso
    </span>
  );
}
