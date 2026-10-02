"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { trackEvent } from "@/lib/ga";
import { SEARCH_CHIPS } from "@/lib/site";
import { cn } from "./ui";
import { useHeroVariant } from "@/components/hero-ab-gate";

/**
 * L'hook del sito: una barra di ricerca gigante che conduce alla chat.
 * Ogni invio = evento GA4 search_start con la query.
 *
 * Gemello-pari nei due repo (dieta bundle): focus scale/lift e entrata
 * chips sono transizioni CSS native (classi `search-*` in globals.css) —
 * framer-motion (≈70 kB gzip nel first load) fuori da qui.
 */
export default function SearchBar({
  autoFocus = false,
  heroVariant,
  beckoning = true,
  showChips = true,
}: {
  autoFocus?: boolean;
  /** Variante A/B dell'hero: se presente, ogni search_start la riporta a GA4.
      Se assente, legge il contesto del cancellò dell'hero (home). */
  heroVariant?: string;
  /** Invito animato (glow + shake): attivo di default, DA SPENERE quando
   *  nella stessa pagina c'è già la barra dell'hero (due barre che tremano
   *  insieme sembrano un bug, non un invito). */
  beckoning?: boolean;
  /** I 4 chip suggerimenti: sensati solo per la barra PRINCIPALE della pagina. */
  showChips?: boolean;
}) {
  const router = useRouter();
  // Variante A/B: dalla prop (chiamante che la conosce) o dal
  // contesto del cancellò (home: la decide il browser).
  const gateVariant = useHeroVariant();
  const abVariant = heroVariant ?? gateVariant;
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [typing, setTyping] = useState(false);
  /** Invito attivo: la barra "chiama" finché il visitatore non la tocca/digita. */
  const [calling, setCalling] = useState(beckoning);
  const ref = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // L'invito si spegne alla prima interazione REALE: tocco (pointerdown) o digitazione.
  // Il focus programmatico (autoFocus) non conta: non è il visitatore che agisce.
  useEffect(() => {
    if (!calling) return;
    const stop = () => setCalling(false);
    const el = ref.current;
    el?.addEventListener("pointerdown", stop, { once: true });
    return () => el?.removeEventListener("pointerdown", stop);
  }, [calling]);

  useEffect(() => {
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, []);

  /** Glow vivo mentre si digita: parte a ogni tasto, si spegne dopo 1,2s di pausa. */
  function onType(value: string) {
    setQ(value);
    setCalling(false);
    setTyping(value.length > 0);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 1200);
  }

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  function go(query: string) {
    const clean = query.trim();
    if (!clean) {
      ref.current?.focus();
      return;
    }
    trackEvent("search_start", {
      search_term: clean,
      source: typeof window !== "undefined" ? window.location.pathname : "/",
      ...(abVariant ? { hero_variant: abVariant } : {}),
    });
    router.push(`/consulenza?q=${encodeURIComponent(clean)}`);
  }

  return (
    <div className="w-full">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(q);
        }}
        role="search"
        className={cn(
          "glass search-glow search-bar flex items-center gap-2 rounded-full p-2 pl-5",
          focused && "shadow-glass-hover",
          typing && "is-typing",
          focused && !typing && "is-focused",
          calling && "is-beckoning",
        )}
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-5 w-5 shrink-0 text-slate-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          ref={ref}
          type="search"
          name="q"
          value={q}
          onChange={(e) => onType(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Cosa stai cercando? Es. «sito web per il mio ristorante»"
          aria-label="Cerca servizi digitali"
          className="w-full bg-transparent py-3 text-base text-slate-900 outline-none placeholder:text-slate-500"
        />
        <button
          type="submit"
          className="shrink-0 rounded-full bg-brand-600/90 px-6 py-3 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-brand-500/90"
        >
          Cerca
        </button>
      </form>

      {showChips && (
        <div className="search-chips mt-4 flex flex-wrap items-center justify-center gap-2">
          {SEARCH_CHIPS.map((chip) => (
            <button
              key={chip.label}
              onClick={() => go(chip.query)}
              className="search-chip rounded-full border border-white/50 bg-white/50 px-4 py-1.5 text-sm text-slate-600 backdrop-blur-xl transition-colors hover:bg-white/80 hover:text-brand-700"
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
