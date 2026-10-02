"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { saveSlaPolicy } from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";

/**
 * Editor delle policy SLA per priorità (Fase 1.3): per ogni priorità le ore
 * di [prossima risposta, risoluzione]. Campi numerici con validazione lato
 * server (la action scarta le righe non valide) e lato client (min/max).
 */

const ROWS = [
  { key: "urgente", label: "Urgente" },
  { key: "alta", label: "Alta" },
  { key: "normale", label: "Normale" },
  { key: "bassa", label: "Bassa" },
] as const;

type Policy = Record<string, { nextReplyH: number; resolveH: number }>;

export default function SlaPolicyEditor({ initial }: { initial: Policy }) {
  const [rows, setRows] = useState<Policy>(initial);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  function set(key: string, field: "nextReplyH" | "resolveH", raw: string) {
    const n = Number(raw);
    setRows((r) => ({
      ...r,
      [key]: { ...r[key], [field]: Number.isFinite(n) && n > 0 ? n : r[key]?.[field] ?? 1 },
    }));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    const fd = new FormData();
    fd.set(
      "policy",
      ROWS.map((r) => `${r.key},${rows[r.key]?.nextReplyH ?? 1},${rows[r.key]?.resolveH ?? 1}`).join("\n"),
    );
    setSaving(true);
    try {
      await saveSlaPolicy(fd);
      toastSaved("sla_policy");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {ROWS.map(({ key, label }) => (
          <div
            key={key}
            className="flex items-center justify-between gap-3 rounded-2xl border border-white/50 bg-white/60 px-3.5 py-2.5"
          >
            <span className="text-sm font-semibold text-slate-700">{label}</span>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <label className="inline-flex items-center gap-1">
                risposta
                <input
                  type="number"
                  min={1}
                  max={336}
                  value={rows[key]?.nextReplyH ?? 1}
                  onChange={(e) => set(key, "nextReplyH", e.target.value)}
                  aria-label={`Ore prossima risposta, priorità ${label}`}
                  className="w-16 rounded-lg border border-white/60 bg-white/80 px-2 py-1.5 text-right text-sm font-semibold text-slate-800 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600"
                />
                h
              </label>
              <label className="inline-flex items-center gap-1">
                risoluzione
                <input
                  type="number"
                  min={1}
                  max={336}
                  value={rows[key]?.resolveH ?? 1}
                  onChange={(e) => set(key, "resolveH", e.target.value)}
                  aria-label={`Ore risoluzione, priorità ${label}`}
                  className="w-16 rounded-lg border border-white/60 bg-white/80 px-2 py-1.5 text-right text-sm font-semibold text-slate-800 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600"
                />
                h
              </label>
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-600/90 px-5 py-2 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-brand-500/90 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
        >
          {saving && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
          Salva SLA
        </button>
      </div>
    </form>
  );
}
