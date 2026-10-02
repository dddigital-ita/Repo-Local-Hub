/**
 * REGOLE PURE DEL TEST A/B DELL'HERO — importabili da client, server e
 * test (nessun db, nessun React). La persistenza sta in hero.ts (server),
 * l'editor in hero-editor.tsx: qui solo bucketing e decisione.
 *
 * Principio di misura (GA4): l'assegnazione è misurata DUE volte, per
 * confronto diretto nel report «search_start» —
 * - `hero_animated_view`: impression server-side (l'hero visibile = storia
 *   conta anche chi non interagisce: i "guardoni" non falsano il tasso);
 * - `hero_variant`: dimensione custom su OGNI search_start, così il report
 *   GA4 divide le ricerche per variante senza esport nulla.
 *
 * Il bucketing è deterministico su un ID di coorte: stesso visitatore =
 * stessa variante su ogni richiesta, niente flicker né assegnazioni che
 * cambiano ad ogni refresh.
 */

export const AB_EXPERIMENT_ID = "hero-2026-a";

/** Le due varianti: «control» = hero statico di oggi, «animated» = il nuovo. */
export const AB_VARIANTS = ["control", "animated"] as const;
export type AbVariant = (typeof AB_VARIANTS)[number];

/** modalità del test: off = tutti vedono la config salvata; on = 50/50. */
export type AbMode = "off" | "on";

/** FNV-1a a 32 bit: veloce, deterministico, zero dipendenze. */
export function abHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Bucketing: hash(coorte + esperimento) → variante 50/50.
 * La coorte è un ID stabile del visitatore (cookie first-party,
 * vedi ab-cohort.ts); chi non ha cookie → coorte "" = bucket stabile ma
 * senza persistenza (il server decide comunque uguale per quella richiesta).
 */
export function abBucket(cohort: string, experimentId: string = AB_EXPERIMENT_ID): AbVariant {
  const h = abHash(`${experimentId}:${cohort}`);
  return h % 2 === 0 ? "control" : "animated";
}

/**
 * Decisione dell'hero: con il test ON il bucket comanda (LA config animata
 * si usa solo per il bucket «animated»); con il test OFF vale la config
 * salvata (comportamento pre-A/B). Ritorna anche la variante: è il valore
 * della dimensione GA4 `hero_variant` e decide quale impression mandare.
 */
export function abDecision(
  config: { enabled: boolean; abTest: AbMode },
  cohort: string,
): { variant: AbVariant; showAnimated: boolean } {
  if (config.abTest !== "on") {
    const variant: AbVariant = config.enabled ? "animated" : "control";
    return { variant, showAnimated: config.enabled };
  }
  const variant = abBucket(cohort);
  return { variant, showAnimated: variant === "animated" };
}

/** Nome tecnico della variante per i report (stabile nel tempo). */
export function abVariantLabel(v: AbVariant): string {
  return v === "animated" ? "animato" : "statico";
}
