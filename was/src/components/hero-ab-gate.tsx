"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import HeroAnimated from "@/components/hero-animated";
import HeroCursorGlow from "@/components/hero-cursor-glow";
import AbViewTracker from "@/components/ab-view-tracker";
import { abDecision, type AbVariant } from "@/lib/ab-shared";
import { ensureCohortClient } from "@/lib/ab-cohort";
import { heroVars, type HeroConfig } from "@/lib/hero-shared";

/**
 * CANCELLO A/B DELL'HERO (client) — decide la variante
 * statico/animato NEL BROWSER leggendo il cookie first-party
 * `wac_ab`, così la home non tocca headers() di richiesta:
 * resta una pagina ISR (revalidate a livello di pagina),
 * prerenderizzata e servita dalla cache CDN invece che
 * renderizzata per ogni singolo visitatore.
 *
 * Disciplina (vedi lib/ab-shared.ts):
 * - con il test SPENTO la decisione dipende solo dalla
 *   config salvata, uguale per tutti: la prenderizzazione
 *   la contiene già;
 * - con il test ATTIVO il bucket è per visitatore. Il
 *   primo render usa la coorte vuota (il bucket di chi non
 *   ha cookie) — markup identico alla prerender, nessuna
 *   hydration mismatch; poi la coorte si risolve (una sola
 *   volta, e viene ricordata 180 giorni) e la pagina mostra
 *   la variante reale. Chi finisce sull'animato lo vede
 *   montare al posto dello statico: è il cambio voluto del
 *   test, non un flash.
 */

// Coorte come store esterno (pattern useSyncExternalStore,
// come useReducedMotion in hero-animated): valore client-only
// che cambia al più una volta — al primo mount del gate.
let cohortCache: string | null = null;
const cohortListeners = new Set<() => void>();

const subscribeCohort = (onChange: () => void) => {
  cohortListeners.add(onChange);
  return () => {
    cohortListeners.delete(onChange);
  };
};

const getCohort = () => cohortCache;

/** Legge/assegna la coorte (una volta) e notifica i sottoscritti. */
function resolveCohort() {
  if (cohortCache === null) {
    cohortCache = ensureCohortClient();
    cohortListeners.forEach((notify) => notify());
  }
}

/** Variante A/B decisa dal cancellò: la legge chi renderizza l'hero. */
export const HeroVariantContext = createContext<AbVariant | null>(null);

/** Variante corrente del test (null fuori dalla home). */
export function useHeroVariant(): AbVariant | null {
  return useContext(HeroVariantContext);
}

export default function HeroAbGate({
  config,
  children,
}: {
  config: HeroConfig;
  /** Hero statico: markup server (vedi app/page.tsx). */
  children: ReactNode;
}) {
  // null finché la coorte non è risolta: prerender e primo
  // render client coincidono (coorte vuota), nessuna mismatch.
  const cohort = useSyncExternalStore(
    subscribeCohort,
    getCohort,
    () => null,
  );
  const { variant, showAnimated } = abDecision(config, cohort ?? "");

  useEffect(() => {
    // Legge/assegna la coorte first-party (wac_ab): ID casuale,
    // nessun dato personale. Stabile: stesso visitatore, stessa
    // variante a ogni sua richiesta.
    resolveCohort();
  }, []);

  return (
    <HeroVariantContext.Provider value={variant}>
      {/* Impression A/B: detta dall'altra faccia del test (chi NON ha
          questo rendering) per un confronto GA4 con pari impression
          per variante. Monta dopo la decisione client: la dimensione
          hero_variant è quella VERA del visitatore, non il bucket
          provvisorio della coorte vuota. */}
      {cohort !== null && (
        <AbViewTracker
          variant={variant === "animated" ? "control" : "animated"}
          template={config.template}
        />
      )}
      {/* Scia del mouse: vive solo mentre l'hero è a schermo (data-hero).
          Tema e colore arrivano dall'admin (tools → hero → «Cursore»);
          con «Nessuno» il puntatore resta quello standard, senza portale. */}
      {showAnimated && config.cursor !== "none" && (
        <HeroCursorGlow cursor={config.cursor} cursorAccent={config.cursorAccent} />
      )}
      {/* Hero stile motore di ricerca */}
      {showAnimated ? (
        <section style={heroVars(config) as CSSProperties} data-gradient-dir={config.gradient}>
          <HeroAnimated config={config} variant={variant} />
        </section>
      ) : (
        children
      )}
    </HeroVariantContext.Provider>
  );
}
