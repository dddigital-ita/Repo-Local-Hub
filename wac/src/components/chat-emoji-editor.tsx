"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { saveChatEmojis } from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";
import { CHAT_EMOJI_CATALOG } from "@/components/chat/chat-emoji-data";

/**
 * Editor delle emoji del picker della chat pubblica: oltre alle righe
 * libere (una emoji per riga, come prima) l'admin ha un catalogo visivo
 * con ricerca in italiano — le stesse etichette e tag che poi guidano la
 * ricerca nel picker pubblico, stessa fonte (chat-emoji-data.ts).
 * Le righe si riordinano: l'ordine è il menu che vedono i visitatori.
 * Salvataggio su DB via server action; dopo il salvataggio router.refresh()
 * riallinea la lista al canonico del server. Il set vuoto è ammesso: il
 * client della chat torna allora sul set predefinito.
 */

const MAX_LEN_CODEPOINTS = 8;

/** Ricerca case/accent-insensitive sul testo normalizzato. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export default function ChatEmojiEditor({
  initial,
  max,
  defaultCount,
}: {
  initial: string[];
  max: number;
  defaultCount: number;
}) {
  const [rows, setRows] = useState<string[]>(initial.length ? initial : [""]);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const currentSet = useMemo(
    () => new Set(rows.map((r) => r.trim()).filter(Boolean)),
    [rows],
  );

  const catalogResults = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return CHAT_EMOJI_CATALOG;
    return CHAT_EMOJI_CATALOG.filter(
      (c) => normalize(c.label).includes(q) || c.tags.some((t) => normalize(t).includes(q)),
    );
  }, [query]);

  function setRow(i: number, v: string) {
    // Il cap è in code point (una emoji composta conta 2-4): Array.from, non .slice.
    setRows((r) => r.map((x, j) => (j === i ? [...v].slice(0, MAX_LEN_CODEPOINTS).join("") : x)));
  }

  function addRow() {
    setRows((r) => (r.length < max ? [...r, ""] : r));
  }

  function addEmoji(emoji: string) {
    setRows((r) => {
      const filled = r.map((x) => x.trim()).filter(Boolean);
      if (filled.includes(emoji) || filled.length >= max) return r;
      const withoutEmpty = r.filter((x) => x.trim() !== "");
      const next = [...withoutEmpty, emoji];
      return next.length < max ? [...next, ""] : next;
    });
  }

  function removeRow(i: number) {
    setRows((r) => r.filter((_, j) => j !== i));
  }

  function move(i: number, dir: -1 | 1) {
    setRows((r) => {
      const j = i + dir;
      if (j < 0 || j >= r.length) return r;
      const next = [...r];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    const fd = new FormData();
    fd.set("emojis", rows.map((r) => r.trim()).filter(Boolean).join("\n"));
    setSaving(true);
    try {
      await saveChatEmojis(fd);
      toastSaved("chat_emoji");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const filled = rows.map((r) => r.trim()).filter(Boolean).length;
  const canAdd = filled < max;

  return (
    <form onSubmit={submit} className="space-y-5">
      {/* ── Catalogo: cerca e clicca per aggiungere/togliere ── */}
      <div className="rounded-2xl border border-white/50 bg-white/50 p-3 backdrop-blur-xl">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <label htmlFor="ce-catalog-search" className="sr-only">
            Cerca nel catalogo (in italiano)
          </label>
          <input
            id="ce-catalog-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca: fuoco, idea, grazie, ok…"
            className="w-full rounded-full border border-white/60 bg-white/70 py-2 pl-9 pr-3 text-sm outline-none backdrop-blur-xl transition placeholder:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          />
        </div>
        <div
          role="listbox"
          aria-label="Catalogo emoji"
          aria-multiselectable
          className="mt-3 grid max-h-44 grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] gap-1 overflow-y-auto"
        >
          {catalogResults.map((c) => {
            const selected = currentSet.has(c.emoji);
            return (
              <button
                key={c.emoji}
                type="button"
                role="option"
                aria-selected={selected}
                title={selected ? `${c.label} — già nel set` : c.label}
                onClick={() => addEmoji(c.emoji)}
                disabled={selected || !canAdd}
                className={`flex h-12 w-12 items-center justify-center rounded-xl text-2xl transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
                  selected
                    ? "bg-brand-600/15 ring-1 ring-brand-600/40"
                    : "hover:bg-white/90 active:scale-95 disabled:opacity-40"
                }`}
              >
                <span aria-hidden>{c.emoji}</span>
                <span className="sr-only">{c.label}</span>
              </button>
            );
          })}
          {catalogResults.length === 0 && (
            <p className="col-span-full py-2 text-center text-xs text-slate-400">
              Nessun risultato per «{query}»: puoi comunque digitarla come riga libera qui sotto.
            </p>
          )}
        </div>
      </div>

      {/* ── Righe del set: ordine = menu dei visitatori ── */}
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`Sposta su l'emoji ${i + 1}`}
                className="inline-flex h-5 w-6 items-center justify-center rounded text-slate-400 transition hover:text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-25"
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === rows.length - 1}
                aria-label={`Sposta giù l'emoji ${i + 1}`}
                className="inline-flex h-5 w-6 items-center justify-center rounded text-slate-400 transition hover:text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-25"
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <div className="flex-1">
              <label htmlFor={`ce-${i}`} className="sr-only">
                Emoji {i + 1}
              </label>
              <input
                id={`ce-${i}`}
                value={row}
                onChange={(e) => setRow(i, e.target.value)}
                placeholder={`Emoji ${i + 1}…`}
                maxLength={MAX_LEN_CODEPOINTS * 4} // tetto laxo sull'attributo: la validazione vera è in submit
                className="w-full rounded-2xl border border-white/60 bg-white/70 px-3 py-2 text-base outline-none backdrop-blur-xl transition placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              />
            </div>
            <button
              type="button"
              onClick={() => removeRow(i)}
              aria-label={`Elimina l'emoji ${i + 1}`}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/50 bg-white/60 text-slate-500 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
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
          disabled={rows.length >= max}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-white/50 bg-white/60 px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Riga libera
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            {filled}/{max} emoji
          </span>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-600/90 px-5 py-2 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-brand-500/90 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
          >
            {saving && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
            Salva emoji
          </button>
        </div>
      </div>

      {/* ── Anteprima live: il menu nell'ordine che vedrà la chat ── */}
      {filled > 0 && (
        <div className="rounded-2xl border border-white/50 bg-white/50 p-3 backdrop-blur-xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Anteprima del picker
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {rows
              .map((r) => r.trim())
              .filter(Boolean)
              .map((emoji, i) => (
                <span
                  key={`${emoji}-${i}`}
                  title={`Posizione ${i + 1}`}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/60 bg-white/80 text-xl"
                >
                  <span aria-hidden>{emoji}</span>
                  <span className="sr-only">posizione {i + 1}</span>
                </span>
              ))}
          </div>
        </div>
      )}

      {filled === 0 && (
        <p className="rounded-xl bg-amber-50/80 p-2.5 text-xs text-amber-900 ring-1 ring-amber-200/60">
          Con zero emoji salvate il picker torna sulle {defaultCount} predefinite.
        </p>
      )}
    </form>
  );
}
