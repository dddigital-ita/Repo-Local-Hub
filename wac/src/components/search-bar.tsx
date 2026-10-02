"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { trackEvent } from "@/lib/ga";
import { SEARCH_CHIPS } from "@/lib/site";
import { cn } from "./ui";

/**
 * L'hook del sito: una barra di ricerca gigante che conduce alla chat.
 * Ogni invio = evento GA4 search_start con la query.
 */
export default function SearchBar({
  autoFocus = false,
  heroVariant,
  beckoning = true,
  showChips = true,
}: {
  autoFocus?: boolean;
  /** Variante A/B dell'hero: se presente, ogni search_start la riporta a GA4. */
  heroVariant?: string;
  /** Invito animato (glow + shake): attivo di default, DA SPENERE quando
   *  nella stessa pagina c'è già la barra dell'hero (due barre che tremano
   *  insieme sembrano un bug, non un invito). */
  beckoning?: boolean;
  /** I 4 chip suggerimenti: sensati solo per la barra PRINCIPALE della pagina. */
  showChips?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [typing, setTyping] = useState(false);
  /** Invito attivo: la barra "chiama" finché il visitatore non la tocca/digita. */
  const [calling, setCalling] = useState(beckoning);
  const reduce = useReducedMotion();
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
    if (reduce) return;
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
      ...(heroVariant ? { hero_variant: heroVariant } : {}),
    });
    router.push(`/consulenza?q=${encodeURIComponent(clean)}`);
  }

  return (
    <div className="w-full">
      <motion.form
        onSubmit={(e) => {
          e.preventDefault();
          go(q);
        }}
        role="search"
        initial={false}
        animate={{ scale: focused ? 1.015 : 1, y: focused && !beckoning ? -2 : 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        className={cn(
          "glass search-glow flex items-center gap-2 rounded-full p-2 pl-5",
          focused && "shadow-glass-hover",
          typing && "is-typing",
          focused && !typing && "is-focused",
          calling && !reduce && "is-beckoning",
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
      </motion.form>

      {showChips && (
      <motion.div
        className="mt-4 flex flex-wrap items-center justify-center gap-2"
        initial="hidden"
        animate="shown"
        variants={{ hidden: {}, shown: { transition: { staggerChildren: 0.06, delayChildren: 0.35 } } }}
      >
        {SEARCH_CHIPS.map((chip) => (
          <motion.button
            key={chip.label}
            variants={{
              hidden: { opacity: 0, y: 10, scale: 0.96 },
              shown: {
                opacity: 1, y: 0, scale: 1,
                transition: { type: "spring", stiffness: 320, damping: 24 },
              },
            }}
            whileTap={reduce ? undefined : { scale: 0.94 }}
            onClick={() => go(chip.query)}
            className="rounded-full border border-white/50 bg-white/50 px-4 py-1.5 text-sm text-slate-600 backdrop-blur-xl transition-colors hover:bg-white/80 hover:text-brand-700"
          >
            {chip.label}
          </motion.button>
        ))}
      </motion.div>
      )}
    </div>
  );
}
