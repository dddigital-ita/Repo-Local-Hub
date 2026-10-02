"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { saveAutoCloseDays } from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";

/**
 * Configurazione della chiusura automatica (Fase 2, default OFF): giorni di
 * silenzio del cliente prima della chiusura. 0/vuoto = disattivata — la
 * roadmap chiede esplicitamente che parta spenta.
 */
export default function AutoCloseForm({ initialDays }: { initialDays: number }) {
  const [days, setDays] = useState(initialDays > 0 ? String(initialDays) : "");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    const fd = new FormData();
    fd.set("days", days.trim());
    setSaving(true);
    try {
      await saveAutoCloseDays(fd);
      toastSaved("autoclose");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="inline-flex min-h-11 items-center gap-2 text-sm text-slate-700">
        Chiudi dopo
        <input
          type="number"
          min={0}
          max={60}
          value={days}
          onChange={(e) => setDays(e.target.value.slice(0, 3))}
          placeholder="es. 7"
          aria-label="Giorni di attesa prima della chiusura automatica (vuoto = disattivata)"
          className="w-20 rounded-lg border border-white/60 bg-white/80 px-2 py-1.5 text-right text-sm font-semibold text-slate-800 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600"
        />
        giorni di silenzio
      </label>
      <button
        type="submit"
        disabled={saving}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-600/90 px-5 py-2 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-brand-500/90 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
      >
        {saving && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
        {days.trim() && Number(days) > 0 ? "Attiva chiusura automatica" : "Salva (disattivata)"}
      </button>
      <p className="w-full text-xs text-slate-400">
        {initialDays > 0
          ? `Attiva: i ticket «In attesa cliente» da ${initialDays} giorni vengono chiusi dal cron.`
          : "Disattivata: nessun ticket viene chiuso automaticamente (predefinito)."}
      </p>
    </form>
  );
}
