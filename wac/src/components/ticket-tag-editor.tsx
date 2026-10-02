"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, Plus, X } from "lucide-react";
import { setTicketTags } from "@/app/admin/actions";
import {
  sanitizeTags,
  TAG_TONE,
  TICKET_TAGS_MAX,
} from "@/lib/tickets-shared";
import { toastSaved } from "@/components/admin-toaster";

/**
 * Editor dei tag del ticket (migration 046): chip rimovibili +
 * input con datalist dal vocabolario canonico (impostazioni →
 * tag). La normalizzazione è sanitizeTags — la STESSA regola
 * pura dell'azione server: ciò che l'agente vede come chip è
 * esattamente ciò che finisce nel DB (nessuna divergenza
 * client/server su kebab-case, dedup o lunghezza). Il
 * salvataggio è esplicito (non a ogni chip): l'agente compone
 * la lista e conferma, come i campi di un form classico.
 */
export function TicketTagEditor({
  conversationId,
  initialTags,
  vocabulary,
}: {
  conversationId: string;
  initialTags: string[];
  /** Vocabolario canonico: suggerimenti, non vincoli —
   *  l'agente può scrivere tag nuovi (sanitizeTags li
   *  normalizza all'istante). */
  vocabulary: string[];
}) {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const dirty = tags.join("|") !== initialTags.join("|");

  function commit(raw: string) {
    // Stessa normalizzazione dell'azione server: l'anteprima
    // della chip coincide con il tag che verrà salvato.
    const [tag] = sanitizeTags([raw], TICKET_TAGS_MAX);
    setDraft("");
    if (!tag || tags.includes(tag) || tags.length >= TICKET_TAGS_MAX) return;
    setTags((cur) => [...cur, tag]);
  }

  function remove(tag: string) {
    setTags((cur) => cur.filter((t) => t !== tag));
  }

  async function save() {
    setPending(true);
    try {
      const fd = new FormData();
      fd.set("conversationId", conversationId);
      // Campi ripetuti: l'azione li legge con getAll("tags")
      // e accetta anche CSV — un solo canale, due forme.
      for (const t of tags) fd.append("tags", t);
      await setTicketTags(fd);
      toastSaved("ticket_tags");
      router.refresh();
    } catch {
      router.refresh(); // riallinea ai dati reali del DB
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-slate-500">Tag</span>
      {tags.map((t) => (
        <span
          key={t}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TAG_TONE}`}
        >
          {t}
          <button
            type="button"
            onClick={() => remove(t)}
            aria-label={`Rimuovi il tag ${t}`}
            className="rounded-full text-slate-400 transition hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      {tags.length < TICKET_TAGS_MAX && (
        <input
          value={draft}
          list="ticket-tag-vocabulary"
          placeholder="aggiungi tag…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit(draft);
            }
          }}
          aria-label="Nuovo tag"
          className="min-h-9 w-32 rounded-full border border-white/50 bg-white/60 px-3 py-1 text-xs text-slate-700 outline-none backdrop-blur-xl transition placeholder:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        />
      )}
      {dirty && (
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-brand-600/90 px-3 py-1 text-[11px] font-semibold text-white shadow-glass-btn transition hover:bg-brand-500/90 active:scale-[0.98] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {pending ? (
            <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <Plus className="h-3 w-3" aria-hidden />
          )}
          Salva tag
        </button>
      )}
      {!dirty && tags.length > 0 && (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400">
          <Check className="h-3 w-3" aria-hidden />
          salvati
        </span>
      )}
      {/* Vocabolario canonico (impostazioni → tag): datalist
          nativa — suggerisce ma non vincola, zero JS extra. */}
      <datalist id="ticket-tag-vocabulary">
        {vocabulary.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <span className="sr-only" role="status">
        {pending ? "Salvataggio in corso" : ""}
      </span>
    </div>
  );
}
