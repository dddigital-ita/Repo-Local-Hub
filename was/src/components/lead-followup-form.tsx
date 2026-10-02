"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { saveLeadFollowupHours } from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";

/**
 * Configurazione del follow-up ai lead spariti (Ambrosio Fase 2, default ON 48h):
 * ore di silenzio del visitatore prima che il cron lasci UN messaggio di
 * Ambrosio nel thread. Vuoto/0 = disattivata. Il dedup è su DB
 * (conversations.followup_sent_at): mai due follow-up sullo stesso lead.
 */
export default function LeadFollowupForm({ initialHours }: { initialHours: number | null }) {
  const [hours, setHours] = useState(initialHours != null ? String(initialHours) : "48");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    const fd = new FormData();
    fd.set("hours", hours.trim());
    setSaving(true);
    try {
      await saveLeadFollowupHours(fd);
      toastSaved("followup");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const active = hours.trim() !== "" && Number(hours) > 0;

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="inline-flex min-h-11 items-center gap-2 text-sm text-slate-700">
        Segui dopo
        <input
          type="number"
          min={1}
          max={336}
          value={hours}
          onChange={(e) => setHours(e.target.value.slice(0, 3))}
          placeholder="es. 48"
          aria-label="Ore di silenzio del visitatore prima del follow-up (0 o vuoto = disattivato)"
          className="w-20 rounded-lg border border-white/60 bg-white/80 px-2 py-1.5 text-right text-sm font-semibold text-slate-800 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600"
        />
        ore di silenzio
      </label>
      <button
        type="submit"
        disabled={saving}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-600/90 px-5 py-2 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-brand-500/90 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
      >
        {saving && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
        {active ? "Attiva follow-up" : "Salva (disattivato)"}
      </button>
      <p className="w-full text-xs text-slate-400">
        {active
          ? `Attivo: se il lead non scrive per ${Math.round(Number(hours))} ore, Ambrosio lascia UN messaggio nella chat. Massimo uno per lead, per sempre.`
          : "Disattivato: nessun follow-up automatico."}
      </p>
    </form>
  );
}
