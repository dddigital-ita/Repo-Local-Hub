"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { saveTicketTagVocabulary } from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";
import {
  TICKET_TAG_MAX_LEN,
  TICKET_TAG_VOCAB_MAX,
} from "@/lib/tickets-shared";

/**
 * Editor del vocabolario canonico dei tag (Impostazioni → Vocabolario
 * dei tag): una riga per tag, aggiungi/togli e salvataggio su DB via
 * server action. Dopo il salvataggio router.refresh() riallinea la
 * lista al canonico del server. È ciò che la datalist dell'editor dei
 * tag suggerisce: vuoto = nessun suggerimento (i tag non hanno
 * default, a differenza delle risposte rapide).
 */

export default function TicketTagVocabularyEditor({
  initial,
}: {
  initial: string[];
}) {
  const [rows, setRows] = useState<string[]>(initial.length ? initial : [""]);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  function setRow(i: number, v: string) {
    setRows((r) => r.map((x, j) => (j === i ? v.slice(0, TICKET_TAG_MAX_LEN) : x)));
  }

  function addRow() {
    setRows((r) => (r.length < TICKET_TAG_VOCAB_MAX ? [...r, ""] : r));
  }

  function removeRow(i: number) {
    setRows((r) => r.filter((_, j) => j !== i));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    const fd = new FormData();
    fd.set("tags", rows.map((r) => r.trim()).filter(Boolean).join("\n"));
    setSaving(true);
    try {
      await saveTicketTagVocabulary(fd);
      toastSaved("ticket_tag_vocabulary");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const filled = rows.map((r) => r.trim()).filter(Boolean).length;

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex-1">
              <label htmlFor={`tv-${i}`} className="sr-only">
                Tag {i + 1}
              </label>
              <input
                id={`tv-${i}`}
                type="text"
                value={row}
                onChange={(e) => setRow(i, e.target.value)}
                placeholder={`Tag ${i + 1}… (es. preventivo-immediato)`}
                maxLength={TICKET_TAG_MAX_LEN}
                autoComplete="off"
                className="w-full rounded-2xl border border-white/60 bg-white/70 px-3 py-2 text-sm outline-none backdrop-blur-xl transition placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              />
            </div>
            <button
              type="button"
              onClick={() => removeRow(i)}
              aria-label={`Elimina il tag ${i + 1}`}
              className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/50 bg-white/60 text-slate-500 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={addRow}
          disabled={rows.length >= TICKET_TAG_VOCAB_MAX}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-white/50 bg-white/60 px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Aggiungi
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            {filled}/{TICKET_TAG_VOCAB_MAX} tag
          </span>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-600/90 px-5 py-2 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-brand-500/90 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
          >
            {saving && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
            Salva tag
          </button>
        </div>
      </div>

      {!filled && (
        <p className="rounded-xl bg-amber-50/80 p-2.5 text-xs text-amber-900 ring-1 ring-amber-200/60">
          Con zero tag salvati la datalist non suggerisce nulla: gli agenti
          scrivono i tag liberamente.
        </p>
      )}
    </form>
  );
}
