"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CalendarClock, Flame, Snowflake, Trash2 } from "lucide-react";
import {
  deleteLead,
  scheduleLeadRecall,
  setLeadTemperature,
  updateLeadCompanyName,
} from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";

const TEMPERAMENTS = [
  { key: "caldo", label: "Caldo", Icon: Flame, activeBg: "bg-orange-500 text-white" },
  { key: "tiepido", label: "Tiepido", Icon: null, activeBg: "bg-slate-500 text-white" },
  { key: "freddo", label: "Freddo", Icon: Snowflake, activeBg: "bg-sky-500 text-white" },
] as const;

/** Segment caldo/tiepido/freddo con optimistic + coda (l'ultimo click vince). */
export function LeadTemperature({ leadId, initial }: { leadId: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const latest = useRef(initial);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const router = useRouter();

  function pick(next: string) {
    if (next === latest.current) return;
    latest.current = next;
    setValue(next);
    const fd = new FormData();
    fd.set("id", leadId);
    fd.set("temperature", next);
    const me = next;
    chain.current = chain.current
      .then(() => setLeadTemperature(fd))
      .then(() => {
        if (latest.current === me) toastSaved("lead_temperature");
      })
      .catch(() => {
        if (latest.current === me) router.refresh();
      });
  }

  return (
    <div role="group" aria-label="Temperatura del lead" className="inline-flex rounded-full bg-slate-200/70 p-0.5">
      {TEMPERAMENTS.map((t) => {
        const active = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            aria-pressed={active}
            onClick={() => pick(t.key)}
            className={`relative rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
              active ? t.activeBg : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <span className="inline-flex items-center gap-1">
              {t.Icon && <t.Icon className="h-3 w-3" aria-hidden />}
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Timestamp del promemoria: a livello modulo (fuori dal render, regola react-hooks/purity). */
function recallTimestamp(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString();
}

/** "Ricontatta tra X giorni" + badge data + elimina con conferma. */
export function LeadRowTools({ leadId, ricontattaIl }: { leadId: string; ricontattaIl: string | null }) {
  const [recall, setRecall] = useState<string | null>(ricontattaIl);
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  function recallIn(days: number) {
    const fd = new FormData();
    fd.set("id", leadId);
    fd.set("days", String(days));
    setRecall(recallTimestamp(days)); // UI immediata
    scheduleLeadRecall(fd)
      .then(() => toastSaved("lead_recall"))
      .catch(() => {
        setRecall(null);
        router.refresh();
      });
  }

  function remove() {
    const fd = new FormData();
    fd.set("id", leadId);
    deleteLead(fd)
      .then(() => toastSaved("lead_deleted"))
      .catch(() => router.refresh());
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {recall ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50/90 px-2 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200/70">
          <CalendarClock className="h-3 w-3" aria-hidden />
          richiama il {new Date(recall).toLocaleDateString("it-IT", { day: "numeric", month: "short" })}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-200/70 p-0.5 text-[11px] font-medium text-slate-500">
          <CalendarClock className="ml-1.5 h-3 w-3" aria-hidden />
          richiama tra
          {[3, 7, 14].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => recallIn(d)}
              className="rounded-full px-1.5 py-0.5 transition hover:bg-white hover:text-slate-900"
            >
              {d}g
            </button>
          ))}
        </span>
      )}
      {confirming ? (
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={remove}
            className="rounded-full bg-red-500 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-red-600"
          >
            Elimina davvero
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-full px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-900"
          >
            Annulla
          </button>
        </span>
      ) : (
        <button
          type="button"
          aria-label="Elimina lead"
          onClick={() => setConfirming(true)}
          className="rounded-full p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * Controllo di completezza: il lead è «azienda» ma il nome ditta manca
 * (lead pre-migration 038 o inbound senza ditta). Pulsante che apre un
 * input inline; il salvataggio passa da updateLeadCompanyName (audit con
 * prima/dopo) e la card si aggiorna col chip completo.
 */
export function CompanyNameFix({ leadId, companyName }: { leadId: string; companyName: string | null }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(companyName ?? "");
  const [pending, setPending] = useState(false);
  const router = useRouter();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full bg-amber-100/90 px-2 py-0.5 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-200/90"
        title="Aggiungi il nome della ditta: il segmento aziende e l'export escono completi"
      >
        <Building2 className="h-3 w-3" aria-hidden /> ditta mancante
      </button>
    );
  }

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const name = value.trim();
        if (!name) return;
        setPending(true);
        const fd = new FormData();
        fd.set("id", leadId);
        fd.set("company_name", name);
        updateLeadCompanyName(fd)
          .then(() => {
            toastSaved("lead_company_name");
            setOpen(false);
            router.refresh();
          })
          .catch(() => {})
          .finally(() => setPending(false));
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Nome della ditta"
        aria-label="Nome della ditta"
        maxLength={80}
        autoFocus
        className="w-44 rounded-full border border-amber-300 bg-white px-3 py-1 text-xs text-slate-800 outline-none focus:border-brand-500"
      />
      <button
        type="submit"
        disabled={pending || !value.trim()}
        className="rounded-full bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
      >
        Salva
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded-full px-1.5 py-1 text-xs text-slate-400 hover:text-slate-600"
        aria-label="Annulla"
      >
        ✕
      </button>
    </form>
  );
}
