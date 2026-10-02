"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, LoaderCircle, Merge, Search } from "lucide-react";
import {
  escalateTicket,
  lookupTicketForMerge,
  mergeTickets,
} from "@/app/admin/actions";
import {
  ESCALATION_TONE,
  escalationLabel,
  nextEscalationLevel,
} from "@/lib/tickets-shared";
import { useChain } from "@/components/ticket-actions";
import { toastSaved } from "@/components/admin-toaster";

/* ── Escalation ─────────────────────────────────────────── */

/**
 * Pannello escalation (migration 046): livello corrente +
 * pulsante di passaggio al livello superiore (max 3). Il livello
 * sale di UN gradino per click — l'escalation è una decisione
 * dell'agente, non un turbo: ogni passaggio è timbrato
 * (escalation_at) e auditato nella timeline. Disabilitato sui
 * ticket chiusi (escalare un ticket chiuso non ha senso) e al
 * livello massimo (non esiste un «oltre»: il pulsante scompare,
 * la action difende lo stesso).
 */
export function TicketEscalationPanel({
  ticketId,
  initialLevel,
  escalationAt,
  status,
}: {
  ticketId: string;
  initialLevel: number;
  escalationAt: string | null;
  status: string;
}) {
  const [level, setLevel] = useState(initialLevel);
  const [pending, setPending] = useState(false);
  const latest = useRef(initialLevel);
  const enqueue = useChain();
  const next = nextEscalationLevel(level);
  const closed = status === "closed";

  function escalate() {
    if (next === null || closed || pending) return;
    latest.current = next;
    setLevel(next); // UI immediata: il chip cambia al click
    setPending(true);
    const fd = new FormData();
    fd.set("id", ticketId);
    enqueue(
      () => escalateTicket(fd),
      `esc-${next}`,
      () => `esc-${latest.current}`,
      "ticket_escalation",
    );
    setTimeout(() => setPending(false), 600);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
          ESCALATION_TONE[level] ?? ESCALATION_TONE[0]
        }`}
        title={
          level > 0
            ? "Passato a competenze di supporto superiori"
            : "Livello base: nessuna escalation"
        }
      >
        <ArrowUpRight className="h-3 w-3" aria-hidden />
        {escalationLabel(level)}
      </span>
      {level > 0 && escalationAt && (
        <span className="text-[11px] text-slate-400">
          escalation il{" "}
          {new Date(escalationAt).toLocaleString("it-IT", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      )}
      {next !== null && !closed && (
        <button
          type="button"
          onClick={escalate}
          disabled={pending}
          title="Passa al livello di supporto superiore"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-violet-200/80 bg-violet-50/80 px-3 py-2 text-xs font-semibold text-violet-700 transition hover:bg-violet-100/90 active:scale-[0.98] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          Escalate a {escalationLabel(next)}
        </button>
      )}
      {pending && (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin text-brand-600" aria-hidden />
      )}
      <span className="sr-only" role="status">
        {pending ? "Escalation in corso" : ""}
      </span>
    </div>
  );
}

/* ── Merge duplicati ────────────────────────────────────── */

interface MergePreview {
  number: number;
  query: string | null;
  status: string;
  priority: string;
  assigned_name: string | null;
}

/**
 * Pannello merge (migration 046): fonde un duplicato (il
 * secondo ticket aperto per lo stesso identico problema) nel
 * ticket destino. L'agente digita il NUMERO del destino — è
 * ciò che si legge in inbox e si condivide a voce — ne vede
 * l'anteprima (numero, query, stato, priorità: tutto ciò che
 * serve a decidere se il problema è davvero identico) e
 * conferma. Il sorgente resta leggibile (cronologia e note
 * intatte) ma esce da ogni lista: dopo il merge la pagina si
 * trasforma nel banner «fuso in #N».
 */
export function TicketMergePanel({
  ticketId,
  ticketNumber,
  statusLabels,
  priorityLabels,
}: {
  ticketId: string;
  ticketNumber: number;
  /** Etichette italiane passate dalla pagina (server):
   *  così il pannello client non duplica le mappe. */
  statusLabels: Record<string, string>;
  priorityLabels: Record<string, string>;
}) {
  const [into, setInto] = useState("");
  const [preview, setPreview] = useState<
    MergePreview | "invalid" | "notfound" | null
  >(null);
  const [pending, setPending] = useState(false);
  const [merging, setMerging] = useState(false);
  const router = useRouter();

  async function lookup() {
    const value = into.trim();
    if (!/^\d+$/.test(value)) {
      setPreview("invalid");
      return;
    }
    setPending(true);
    try {
      const fd = new FormData();
      fd.set("into", value);
      const found = await lookupTicketForMerge(fd);
      setPreview(found ?? "notfound");
    } finally {
      setPending(false);
    }
  }

  async function merge() {
    if (!preview || preview === "invalid" || preview === "notfound" || merging)
      return;
    setMerging(true);
    try {
      const fd = new FormData();
      fd.set("id", ticketId);
      fd.set("into", String(preview.number));
      await mergeTickets(fd);
      toastSaved("ticket_merge");
      // Il dettaglio rilegge il ticket ORA FUSO: la pagina
      // mostra il banner «fuso in #N» con il link al destino.
      router.refresh();
    } catch {
      router.refresh();
    } finally {
      setMerging(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          lookup();
        }}
        className="flex items-center gap-1.5"
      >
        <input
          value={into}
          onChange={(e) => {
            setInto(e.target.value.replace(/[^\d]/g, ""));
            setPreview(null);
          }}
          inputMode="numeric"
          placeholder="n. ticket destino"
          aria-label="Numero del ticket in cui fondere"
          className="min-h-11 w-28 rounded-full border border-white/50 bg-white/70 px-3 py-2 font-mono text-xs tabular-nums text-slate-700 outline-none backdrop-blur-xl transition placeholder:font-sans placeholder:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        />
        <button
          type="submit"
          disabled={pending || !into.trim()}
          title="Mostra il ticket che assorbirà il duplicato"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-white/50 bg-white/60 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white/90 active:scale-[0.98] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {pending ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Search className="h-3.5 w-3.5" aria-hidden />
          )}
          Anteprima
        </button>
      </form>

      {preview === "invalid" && (
        <p className="rounded-xl bg-amber-50/80 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200/60">
          Serve il NUMERO del ticket (solo cifre): lo trovi nella inbox.
        </p>
      )}
      {preview === "notfound" && (
        <p className="rounded-xl bg-amber-50/80 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200/60">
          Nessun ticket vivo con questo numero (inesistente o già fuso).
        </p>
      )}
      {preview && preview !== "invalid" && preview !== "notfound" && (
        <div className="rounded-2xl bg-white/60 p-3 ring-1 ring-white/60">
          <p className="flex flex-wrap items-center gap-x-2 text-xs">
            <span className="font-mono font-semibold tabular-nums text-brand-700">
              #{preview.number}
            </span>
            <span className="min-w-0 truncate font-medium text-slate-700">
              «{preview.query ?? "senza query"}»
            </span>
          </p>
          <p className="mt-1 flex flex-wrap gap-1.5 text-[10px] font-semibold text-slate-500">
            <span className="rounded-full bg-white/80 px-2 py-0.5 ring-1 ring-white/70">
              {statusLabels[preview.status] ?? preview.status}
            </span>
            <span className="rounded-full bg-white/80 px-2 py-0.5 ring-1 ring-white/70">
              {priorityLabels[preview.priority] ?? preview.priority}
            </span>
            {preview.assigned_name && (
              <span className="rounded-full bg-white/80 px-2 py-0.5 ring-1 ring-white/70">
                {preview.assigned_name}
              </span>
            )}
          </p>
          <p className="mt-1.5 text-[10px] leading-snug text-slate-400">
            Il ticket #{ticketNumber} verrà fuso qui: chat e note restano
            leggibili, ma scompare dalle liste. Il destino non cambia.
          </p>
          <button
            type="button"
            onClick={merge}
            disabled={merging}
            className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-brand-600/90 px-3 py-2 text-xs font-semibold text-white shadow-glass-btn transition hover:bg-brand-500/90 active:scale-[0.98] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            {merging ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Merge className="h-3.5 w-3.5" aria-hidden />
            )}
            Conferma merge in #{preview.number}
          </button>
        </div>
      )}
      {!preview && (
        <p className="text-[11px] leading-snug text-slate-400">
          Duplicato aperto per errore dallo stesso utente? Fondilo nel ticket
          originale: una sola conversazione, nessuna risposta ridondante.
        </p>
      )}
      <span className="sr-only" role="status">
        {pending || merging ? "Operazione in corso" : ""}
      </span>
    </div>
  );
}
