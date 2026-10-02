/**
 * Eventi GA4 custom con UTM passthrough.
 * dataLayer funziona sia con GA4 diretto sia con GTM; gli eventi partono solo
 * se il banner cookie ha già dato il consenso (vedi CookieBanner).
 */

export type GaEvent =
  | "search_start"
  | "hero_animated_view"
  | "chat_start"
  | "lead_captured"
  | "call_click"
  | "whatsapp_click"
  | "callback_booked"
  | "operator_handoff";

interface GaParams {
  [key: string]: string | number | boolean | undefined;
}

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** Legge utm_* e referrer document per il passthrough. */
export function getUtmParams(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const q = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const v = q.get(k);
    if (v) out[k] = v;
  }
  if (!out.utm_source && document.referrer) {
    try {
      out.utm_source = new URL(document.referrer).hostname;
    } catch {
      /* referrer opaco */
    }
  }
  return out;
}

export function trackEvent(event: GaEvent, params: GaParams = {}) {
  if (typeof window === "undefined") return;
  const payload = { ...getUtmParams(), ...params };
  // GTM
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event, ...payload });
  // GA4 diretto (se presente gtag.js)
  window.gtag?.("event", event, payload);
}
