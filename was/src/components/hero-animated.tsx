"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useCallback } from "react";
import { useRouter } from "next/navigation";
import { trackEvent } from "@/lib/ga";
import { SEARCH_CHIPS } from "@/lib/site";
import { cn } from "./ui";
import {
  heroWithFallbacks,
} from "@/lib/hero-shared";
import type { HeroConfig } from "@/lib/hero-shared";
import { GlassBadge } from "./glass";
import { Container } from "./ui";
import { MapPin } from "lucide-react";
import HeroCanvasEngine from "./hero-canvas-engine";
/**
 * HERO ANIMATO «serissimo stile Apple» — sostituisce (non affianca) l'hero
 * statico della home quando è attivo da /admin/tools/hero.
 *
 * Gli 8 template condividono la stessa struttura (badge → titolo →
 * sottotitolo → barra → chips) e cambiano solo il modo in cui luce e testo
 * si muovono:
 * - spotlight: sheen che attraversa la superficie di vetro;
 * - caret: il placeholder si scrive da solo, carattere per carattere;
 * - lens: anello luminoso che ruota attorno alla barra;
 * - gradient-flow: sfumatura animata nel titolo;
 * - particles: costellazione canvas connessa al puntatore;
 * - parallax-orbit: sfere su tre strati che seguono mouse e scroll;
 * - dot-grid: griglia di puntini che si accende attorno al cursore;
 * - aurora: bande di luce lentissime, solo CSS.
 *
 * La scia del mouse vive in HeroCursorGlow (portale su body): qui c'è solo
 * il marker data-hero su <html> che la accende e la spegne.
 *
 * Dieta bundle (30/09): reveal in sequenza, focus della barra e tap dei chip
 * sono transizioni CSS (classi `hero-step` in globals.css) — framer-motion
 * (≈70 kB gzip nel first load) è fuori da qui.
 */

/** prefers-reduced-motion letto come store esterno (niente setState in effect). */
function useReducedMotion(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const getSnapshot = useCallback(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Caret: una parola alla volta, poi pausa, poi riparte. Zero se reduced. */
function useTypewriter(text: string, active: boolean, reduced: boolean) {
  const [out, setOut] = useState("");
  useEffect(() => {
    if (!active || reduced) return;
    let i = 0;
    let dir = 1;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      i += dir;
      if (i >= text.length) {
        i = text.length;
        dir = -1;
        timer = setTimeout(tick, 2200); // pausa «letta» prima di cancellare
      } else if (i <= 0) {
        i = 0;
        dir = 1;
        timer = setTimeout(tick, 600);
      } else {
        timer = setTimeout(tick, 34 + Math.random() * 38);
      }
      setOut(text.slice(0, i));
    };
    timer = setTimeout(tick, 500);
    return () => clearTimeout(timer);
  }, [text, active, reduced]);
  return active && !reduced ? out : text;
}

/** Il marker per la scia del mouse: on quando l'hero è montato e visibile. */
function useHeroMarker(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) root.setAttribute("data-hero", "1");
        else root.removeAttribute("data-hero");
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      root.removeAttribute("data-hero");
    };
  }, [ref]);
}

interface Props {
  config: HeroConfig;
  /** Variante A/B misurata: finisce in OGNI search_start dell'hero animato. */
  variant?: string;
}

export default function HeroAnimated({ config, variant = "animated" }: Props) {
  const c = useMemo(() => heroWithFallbacks(config), [config]);
  // prefers-reduced-motion via useSyncExternalStore (niente setState in effect):
  // il CSS ha la sua media query, qui serve solo per il typewriter.
  const reduce = useReducedMotion();
  const router = useRouter();
  const sectionRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const typingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [glowOn, setGlowOn] = useState(false);

  useHeroMarker(sectionRef);

  const typedPlaceholder = useTypewriter(c.placeholder, c.template === "caret", Boolean(reduce));

  useEffect(() => {
    return () => {
      if (typingRef.current) clearTimeout(typingRef.current);
    };
  }, []);

  function go(query: string) {
    const clean = query.trim();
    if (!clean) {
      inputRef.current?.focus();
      return;
    }
    trackEvent("search_start", {
      search_term: clean,
      source: typeof window !== "undefined" ? window.location.pathname : "/",
      hero_variant: variant,
    });
    // Router push: client nav coerente col resto del sito (View Transitions incluse).
    router.push(`/consulenza?q=${encodeURIComponent(clean)}`);
  }

  function onType(value: string) {
    setQ(value);
    if (reduce) return;
    setGlowOn(value.length > 0);
    if (typingRef.current) clearTimeout(typingRef.current);
    typingRef.current = setTimeout(() => setGlowOn(false), 1200);
  }

  const accentClass = c.accent ? "text-[rgb(var(--hero-accent))]" : "text-brand-600";
  const showTitle = c.template !== "gradient-flow";
  const fontClass =
    c.font === "inter"
      ? "font-[family-name:var(--font-hero-inter)]"
      : c.font === "manrope"
        ? "font-[family-name:var(--font-hero-manrope)]"
        : c.font === "playfair"
          ? "font-[family-name:var(--font-hero-playfair)]"
          : "";

  const barWrapClass =
    c.template === "lens"
      ? "hero-lens-wrap"
      : c.template === "gradient-flow"
        ? "hero-reflection-wrap"
        : c.template === "dot-grid" || c.template === "parallax-orbit"
          ? "hero-lens-wrap" // nessun effetto extra sulla barra: il fondo lavora già
          : "hero-spotlight-wrap";

  // I tre template canvas montano il motore condiviso; aurora usa solo CSS.
  const canvasVariant =
    c.template === "particles" || c.template === "parallax-orbit" || c.template === "dot-grid"
      ? c.template
      : null;

  return (
    <section ref={sectionRef} className="hero-animated relative overflow-hidden" data-template={c.template}>
      {/* Fondo decorativo: sempre dietro il contenuto, mai sul testo. */}
      {canvasVariant && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
          <HeroCanvasEngine variant={canvasVariant} />
        </div>
      )}
      {c.template === "aurora" && <div aria-hidden className="hero-aurora" />}
      <Container className="relative z-10 flex flex-col items-center pb-20 pt-16 text-center sm:pt-24">
        <div className="hero-sequence flex w-full flex-col items-center">
          {/* Eyebrow (badge) */}
          <div className="hero-step">
            <GlassBadge>
              <MapPin className="h-3.5 w-3.5 text-brand-600" aria-hidden />
              {c.eyebrow}
            </GlassBadge>
          </div>

          {/* Titolo */}
          <h1
            className={cn(
              "hero-step mt-5 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-5xl",
              fontClass,
              c.template === "gradient-flow" && "hero-gradient-title",
            )}
          >
            {showTitle && <span className="block">{c.title}</span>}
            <span className={cn("block", showTitle && accentClass, !showTitle && "hero-gradient-text")}>
              {c.titleHighlight}
            </span>
          </h1>

          {/* Sottotitolo */}
          <p className="hero-step mt-4 max-w-2xl text-lg leading-relaxed text-slate-600">
            {c.subtitle}
          </p>

          {/* Barra di ricerca */}
          <div className={cn("hero-step mt-10 w-full max-w-3xl", barWrapClass)}>
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                go(q);
              }}
              className={cn(
                "glass search-glow search-bar flex items-center gap-2 rounded-full p-2 pl-5",
                focused && "shadow-glass-hover",
                glowOn && "is-typing",
                focused && !glowOn && "is-focused",
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
                ref={inputRef}
                type="search"
                name="q"
                value={q}
                onChange={(e) => onType(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder={typedPlaceholder}
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
          </div>

          {/* Chips suggerimenti (entrata in coda al resto) */}
          <div className="hero-sequence-chips mt-4 flex flex-wrap items-center justify-center gap-2">
            {SEARCH_CHIPS.map((chip) => (
              <button
                key={chip.label}
                onClick={() => go(chip.query)}
                className="hero-chip rounded-full border border-white/50 bg-white/50 px-4 py-1.5 text-sm text-slate-600 backdrop-blur-xl transition-colors hover:bg-white/80 hover:text-brand-700"
              >
                {chip.label}
              </button>
            ))}
          </div>

        </div>
      </Container>
    </section>
  );
}
