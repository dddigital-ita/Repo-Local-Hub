/**
 * Turnstile di Cloudflare: captcha invisibile (seconda difesa di Shield,
 * dopo rate limit + honeypot + ban). Funziona solo se le DUE chiavi sono
 * attive — env (NEXT_PUBLIC_TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY) oppure
 * la coppia salvata dall'admin nella pagina Shield (turnstile-settings.ts,
 * secret cifrata su DB). Senza chiavi la verifica è disattivata: il sito
 * resta funzionante e la prima difesa resta Shield (rate limit + ban).
 *
 * Chiavi di test ufficiali Cloudflare per lo sviluppo locale:
 * site:  1x00000000000000000000AA (sempre valido, invisibile)
 * secret: 1x0000000000000000000000000000000AA (sempre valido)
 */

import { getActiveSiteKey, getActiveSecret } from "./turnstile-settings";

/** Site key per il client: env prima, DB dopo; null = widget non monta. */
export async function activeTurnstileSiteKey(): Promise<string | null> {
  return getActiveSiteKey();
}

/** Le difese Turnstile sono attive? (entrambe le chiavi presenti) */
export async function turnstileEnabledAsync(): Promise<boolean> {
  const [site, secret] = await Promise.all([getActiveSiteKey(), getActiveSecret()]);
  return Boolean(site && secret);
}

/** Verifica il token col server Cloudflare. Fail-open: se l'API non risponde, non bloccare i clienti veri. */
export async function verifyTurnstile(token: unknown, ip: string): Promise<{ ok: boolean; reason?: string }> {
  const secret = await getActiveSecret();
  const site = await getActiveSiteKey();
  if (!secret || !site) return { ok: true, reason: "disabled" };
  if (typeof token !== "string" || token.length < 10) {
    return { ok: false, reason: "token_mancante" };
  }
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: ip === "unknown" ? undefined : ip,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      // API Cloudflare giù: meglio lasciar passare che bloccare lead veri
      console.error("[turnstile] siteverify http:", res.status);
      return { ok: true, reason: "api_unreachable" };
    }
    const data = (await res.json()) as { success: boolean; "error-codes"?: string[] };
    return data.success ? { ok: true } : { ok: false, reason: data["error-codes"]?.[0] ?? "invalid" };
  } catch (e) {
    console.error("[turnstile] errore verifica (fail-open):", e);
    return { ok: true, reason: "api_unreachable" };
  }
}
