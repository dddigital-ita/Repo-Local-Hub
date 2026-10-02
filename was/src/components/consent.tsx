"use client";

import Link from "next/link";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * GDPR: nessuno script di misurazione parte prima del consenso.
 * Il provider espone `consent` e `grant()`: Analytics (GA4/GTM/Clarity)
 * viene montato solo quando consent === "granted".
 */
type ConsentState = "unknown" | "granted" | "denied";

interface ConsentCtx {
  consent: ConsentState;
  grant: () => void;
  deny: () => void;
  openPreferences: () => void;
}

const Ctx = createContext<ConsentCtx>({
  consent: "unknown",
  grant: () => {},
  deny: () => {},
  openPreferences: () => {},
});

export const CONSENT_COOKIE = "cc_consent";

/** Valore del cookie di consenso letto in modo SSR-safe (reagisce al cambio tab). */
function useConsentSnapshot(): "unknown" | "granted" | "denied" {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener("focus", onChange);
    document.addEventListener("visibilitychange", onChange);
    return () => {
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
    };
  }, []);
  const getSnapshot = useCallback(
    () =>
      (document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=(\\w+)`))?.[1] ??
        "unknown") as "unknown" | "granted" | "denied",
    [],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => "unknown" as const);
}

export function ConsentProvider({ children }: { children: ReactNode }) {
  const consent = useConsentSnapshot();
  // Banner montato SOLO dopo il primo evento (focus/visibility) e SOLO se il
  // visitatore non ha ancora scelto (il consenso vive nel cookie: chi ha
  // risposto non deve rivedere il banner al reload — lo può riaprire dal
  // footer). `bannerTick` serve solo a riprendere il rendering dopo una
  // scrittura del cookie (grant/deny).
  const [showBanner, setShowBanner] = useState(false);
  const [, setBannerTick] = useState(0);
  useEffect(() => {
    const onFirst = () => {
      const chosen = new RegExp(`(?:^|; )${CONSENT_COOKIE}=`).test(document.cookie);
      if (!chosen) setShowBanner(true);
    };
    if (document.visibilityState === "visible") {
      const id = requestAnimationFrame(onFirst);
      return () => cancelAnimationFrame(id);
    }
    document.addEventListener("visibilitychange", onFirst, { once: true });
    return () => document.removeEventListener("visibilitychange", onFirst);
  }, []);

  const set = useCallback((value: Exclude<ConsentState, "unknown">) => {
    document.cookie = `${CONSENT_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
    // La verità è il cookie (useSyncExternalStore): dopo la scrittura serve
    // solo far ripartire il rendering — un bump di state, non un mirror.
    setBannerTick((t) => t + 1);
    setShowBanner(false);
  }, []);

  const value = useMemo<ConsentCtx>(
    () => ({
      consent,
      grant: () => set("granted"),
      deny: () => set("denied"),
      openPreferences: () => setShowBanner(true),
    }),
    [consent, set],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* `showBanner` basta: è true solo senza cookie al primo evento o su
          openPreferences() esplicito («Preferenze cookie» nel footer). Chi ha
          già scelto e riapre deve poter CAMBIARE idea, non trovare nulla.
          L'entrata/uscita è una transizione CSS (classe .banner-out su "denied"
          o "granted"): niente framer-motion in layout — sarebbe nel first load
          di OGNI pagina pubblica. */}
      {showBanner && <CookieBanner />}
    </Ctx.Provider>
  );
}

function CookieBanner() {
  const { grant, deny } = useConsent();
  const [leaving, setLeaving] = useState(false);
  // Uscita animata: la scelta parte subito (la verità è il cookie), il DOM
  // si smonta dopo la dissolvenza CSS (.banner-out, 180ms in globals.css).
  const choose = (value: "granted" | "denied") => {
    setLeaving(true);
    setTimeout(() => (value === "granted" ? grant() : deny()), 180);
  };
  return (
    // bg-white è un TOKEN (surface-white): in dark mode il motore temi lo
    // scambia da solo — mai usare dark: qui, segue l'OS e litiga col sito.
    <div
      role="dialog"
      aria-label="Preferenze cookie"
      className={`cookie-banner fixed inset-x-2 bottom-2 z-[90] flex items-center gap-2 rounded-2xl border border-white/60 bg-white/95 p-2 shadow-glass-hover backdrop-blur-2xl sm:inset-x-6 sm:bottom-3 sm:mx-auto sm:block sm:max-w-2xl sm:rounded-3xl sm:p-4 ${
        leaving ? "banner-out" : ""
      }`}
    >
      {/* MOBILE (<640px): BARRA SOTTILE — una riga fissa in basso (~52px):
          testo breve + azioni inline, tap-target ≥40px. Il banner intero
          (fixed inset-x-3 bottom-3, ≈200-280px) copriva il 25-30% del
          viewport e INTERCETTAVA i tap sulle azioni delle card della inbox
          (Prendi in carico, WhatsApp) — l'operatore doveva scegliere il
          consenso prima di lavorare. Le classi mobile sono qui, il banner
          completo riparte da sm:. */}
      <p className="hidden px-3 text-[13px] leading-tight text-slate-600 sm:block">
        Usiamo cookie tecnici per far funzionare il sito e, <strong>solo con il tuo consenso</strong>,
        cookie statistici (Google Analytics, Google Tag Manager) per capire quali contenuti sono utili.
        Puoi cambiare idea quando vuoi dal link «Preferenze cookie» nel footer.{" "}
        <Link href="/cookie-policy" className="text-brand-700 underline underline-offset-2">
          Cookie policy
        </Link>
      </p>
      <p className="min-w-0 flex-1 truncate px-1 text-xs leading-tight text-slate-600 sm:hidden">
        Cookie tecnici + statistici <strong>solo col tuo consenso</strong>.{" "}
        <Link href="/cookie-policy" className="text-brand-700 underline underline-offset-2">
          Policy
        </Link>
      </p>
      <div className="flex shrink-0 gap-1.5 sm:mt-3 sm:gap-2 sm:p-0">
        <button
          onClick={() => choose("granted")}
          className="min-h-11 active:scale-95 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-transform hover:bg-brand-700 sm:px-5 sm:py-2"
        >
          Accetta tutti
        </button>
        <button
          onClick={() => choose("denied")}
        className="min-h-11 active:scale-95 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-transform hover:border-slate-400 sm:px-5 sm:py-2"
        >
          Solo necessari
        </button>
      </div>
    </div>
  );
}

export function useConsent() {
  return useContext(Ctx);
}
