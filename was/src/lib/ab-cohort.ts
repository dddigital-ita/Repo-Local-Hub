/**
 * COORTE DEL TEST A/B — ID stabile del visitatore in un cookie first-party
 * (`wac_ab`), senza dati personali: è un ID casuale, non un identificatore
 * tracciato altrove. Il valore viene LETTO dal server a ogni richiesta
 * (cookie di richiesta, non di risposta): niente set-cookie server-side,
 * niente header Vary. Con i cookie bloccati il visitatore riceve comunque
 * una variante (coorte ""), solo non persistente.
 *
 * ⚠️ Garanzia di coerenza: le due facce del test (HTML del server e click
 * dell'utente) leggono lo STESSO cookie di richiesta nella stessa richiesta
 * HTTP → stessa variante sempre, anche al primo col cookie assente.
 */

import { abBucket, AB_EXPERIMENT_ID } from "./ab-shared";

export const AB_COOKIE = "wac_ab";

/** Genera un ID coorte: casuale, nessun dato personale. */
export function newCohortId(): string {
  try {
    return crypto.randomUUID().slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

/** Lettura lato client (editor: mostra il bucket di chi sta provando). */
export function readCohortClient(): string {
  if (typeof document === "undefined") return "";
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${AB_COOKIE}=`));
  return hit ? decodeURIComponent(hit.slice(AB_COOKIE.length + 1)) : "";
}

/**
 * Lato SERVER: legge il cookie di richiesta. La funzione accetta l'header
 * cookie grezzo (già disponibile su page.tsx via next/headers) così resta
 * importabile anche fuori da un handler Next.
 */
export function cohortFromCookieHeader(cookieHeader: string | null): string {
  if (!cookieHeader) return "";
  const hit = cookieHeader.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${AB_COOKIE}=`));
  return hit ? decodeURIComponent(hit.slice(AB_COOKIE.length + 1)) : "";
}

/**
 * Assegnatore client: dà (e ricorda) la coorte per questo visitatore.
 * Usato dall'editor per l'anteprima del bucket e da chi vuole simulare.
 */
export function ensureCohortClient(): string {
  const existing = readCohortClient();
  if (existing) return existing;
  const fresh = newCohortId();
  document.cookie = `${AB_COOKIE}=${encodeURIComponent(fresh)}; Path=/; Max-Age=${180 * 24 * 3600}; SameSite=Lax`;
  return fresh;
}

/** Variante di UN visitatore client-side (anteprima, debug). */
export function clientVariant(): "control" | "animated" {
  return abBucket(ensureCohortClient(), AB_EXPERIMENT_ID);
}
