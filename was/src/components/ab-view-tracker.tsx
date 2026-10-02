"use client";

import { useEffect, useRef } from "react";
import { trackEvent } from "@/lib/ga";

/**
 * IMPRESSION DEL TEST A/B (GA4) — evento `hero_animated_view` spedito UNA
 * volta per caricamento di pagina, dall'ALTRA faccia del test (quella che
 * NON decide il rendering): così la dimensione hero_variant dell'impression
 * e quella del search_start (mandata da SearchBar/HeroAnimated) misurano la
 * STESSA variante, senza dipendere l'una dall'altra.
 *
 * Serve per misurare anche chi NON interagisce: le due varianti partono
 * con lo stesso numero di impression 50/50, quindi il confronto sui
 * search_start è un rapporto pulito.
 */

export default function AbViewTracker({
  variant,
  template,
}: {
  variant: string;
  template?: string;
}) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    trackEvent("hero_animated_view", {
      hero_variant: variant,
      hero_template: template ?? "",
      source: typeof window !== "undefined" ? window.location.pathname : "/",
    });
  }, [variant, template]);
  return null;
}
