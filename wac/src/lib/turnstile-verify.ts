import { db } from "./db";
import { getActiveSecret } from "./turnstile-settings";

/**
 * TEST REALE DELLA VERIFICA TURNTISTE — lo stesso gesto di Drive/Calendar:
 * la scheda non si limita a salvare le chiavi, dimostra che la catena verso
 * l'API Cloudflare funziona PRIMA che un cliente vero debba passarci.
 *
 * Come funziona: siteverify viene chiamata con la secret attiva (env o DB)
 * e il token fittizio UFFICIALE Cloudflare (`XXXX.DUMMY.TOKEN.XXXX`, sempre
 * rifiutato). Le esitazioni sono due e vanno distinte:
 *   - `invalid-input-response` → la secret è buona e l'API risponde: il
 *     rifiuto riguarda SOLO il token finto, che è esattamente il comportamento
 *     atteso → test VERDE;
 *   - `invalid-input-secret` (o altri errori) → la secret salvata non è
 *     valida → test ROSSO: meglio scoprirlo qui che su un lead perso.
 * Fail-open del runtime non è in gioco: qui non si blocca nessuno, si misura.
 */

export const TURNSTILE_TEST_ACTION = "cloudflare.test";

/** Token fittizio ufficiale Cloudflare: siteverify lo rifiuta sempre. */
export const TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

export async function testTurnstileVerification(): Promise<{ ok: boolean; message: string }> {
  const secret = await getActiveSecret();
  if (!secret) {
    return { ok: false, message: "Secret mancante: salva prima le chiavi (site + secret)." };
  }
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: TURNSTILE_DUMMY_TOKEN }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 160);
      return { ok: false, message: `siteverify ha risposto ${res.status}: ${text || "senza dettagli"}.` };
    }
    const data = (await res.json()) as { success: boolean; "error-codes"?: string[] };
    if (data.success) {
      return { ok: true, message: "La catena verso siteverify è viva e la secret è valida." };
    }
    const codes = data["error-codes"] ?? [];
    if (codes.includes("invalid-input-response")) {
      return { ok: true, message: "Secret valida: Cloudflare ha rifiutato solo il token fittizio, come atteso." };
    }
    if (codes.includes("invalid-input-secret")) {
      return { ok: false, message: "Secret non valida (invalid-input-secret): ricontrolla la chiave salvata o le variabili d'ambiente." };
    }
    return {
      ok: false,
      message: `Siteverify ha rifiutato la verifica: ${codes.join(", ") || "errore sconosciuto"}. Controlla la secret.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `siteverify non raggiungibile: ${msg}. Controlla connettività e secret.` };
  }
}

export interface TurnstileTestState {
  /** Esito dell'ultimo «Prova verifica», come fa Drive (dall'audit). */
  lastTestAt: string | null;
  lastTestOk: boolean | null;
}

/** Ultimo test dall'audit (append-only): nessun altro posto dove guardare. */
export async function getLastTurnstileTest(): Promise<TurnstileTestState> {
  const pool = db();
  if (!pool) return { lastTestAt: null, lastTestOk: null };
  try {
    const { rows } = await pool.query<{ created_at: string; detail: string | null }>(
      "select created_at, detail from audit_log where action = $1 order by created_at desc limit 1",
      [TURNSTILE_TEST_ACTION],
    );
    const last = rows[0];
    return {
      lastTestAt: last?.created_at ?? null,
      lastTestOk: last ? Boolean(last.detail && last.detail.startsWith("OK")) : null,
    };
  } catch {
    // tabella non ancora migrata: nessun test da mostrare
    return { lastTestAt: null, lastTestOk: null };
  }
}
