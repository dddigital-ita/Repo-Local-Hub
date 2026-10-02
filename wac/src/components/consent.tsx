"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";

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
          già scelto e riapre deve poter CAMBIARE idea, non trovare nulla. */}
      <AnimatePresence>{showBanner && <CookieBanner />}</AnimatePresence>
    </Ctx.Provider>
  );
}

function CookieBanner() {
  const { grant, deny } = useConsent();
  return (
    // bg-white è un TOKEN (surface-white): in dark mode il motore temi lo
    // scambia da solo — mai usare dark: qui, segue l'OS e litiga col sito.
    <motion.div
      role="dialog"
      aria-label="Preferenze cookie"
      initial={{ opacity: 0, y: 80, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 60, scale: 0.97, transition: { duration: 0.2, ease: "easeIn" } }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      className="fixed inset-x-3 bottom-3 z-[90] mx-auto max-w-2xl rounded-3xl border border-white/60 bg-white/95 p-4 shadow-glass-hover backdrop-blur-2xl sm:inset-x-6"
    >
      <p className="text-sm leading-relaxed text-slate-600">
        Usiamo cookie tecnici per far funzionare il sito e, <strong>solo con il tuo consenso</strong>,
        cookie statistici (Google Analytics, Google Tag Manager) per capire quali contenuti sono utili.
        Puoi cambiare idea quando vuoi dal link «Preferenze cookie» nel footer.{" "}
        <Link href="/cookie-policy" className="text-brand-700 underline underline-offset-2">
          Cookie policy
        </Link>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <motion.button
          onClick={grant}
          whileTap={{ scale: 0.95 }}
          className="rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Accetta tutti
        </motion.button>
        <motion.button
          onClick={deny}
          whileTap={{ scale: 0.95 }}
          className="rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
        >
          Solo necessari
        </motion.button>
      </div>
    </motion.div>
  );
}

export function useConsent() {
  return useContext(Ctx);
}
