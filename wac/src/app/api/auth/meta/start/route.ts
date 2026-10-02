/**
 * OAUTH META — AVVIO (§2 del piano social).
 *
 * POST ONLY (la sentinella GET-purity non ha nullo da
 * controllare qui: il GET è un 405 esplicito). L'avvio:
 *  1. richiede l'admin (il «Collega con Meta» è un form
 *     della scheda Canali social, cookie di sessione incluso);
 *  2. genera uno state CSRF e lo pianta in cookie httpOnly
 *     (10 min, sameSite lax — mai esposto al JS);
 *  3. 302 al dialog Meta con scope pagine + IG Business.
 *
 * Il callback (GET, contratto del provider) verifica lo
 * state e salva i token cifrati in channel_accounts.
 */
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import {
  getMetaAppConfig,
  metaAuthorizationUrl,
  metaRedirectUri,
  newOAuthState,
  setOAuthStateCookie,
} from "@/lib/social-oauth";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "meta_oauth_state";

export async function GET() {
  return Response.json({ ok: false, error: "metodo_non_consentito" }, { status: 405 });
}

export async function POST() {
  await requireAdmin();

  const app = getMetaAppConfig();
  if (!app) {
    // Credenziali app assenti: torna alla scheda con il motivo
    // (il pannello mostra «Da configurare» con questo segnale).
    redirect("/admin/settings/social?meta=app_non_configurata");
  }

  const state = newOAuthState();
  await setOAuthStateCookie(STATE_COOKIE, state);

  redirect(metaAuthorizationUrl(state, metaRedirectUri(), app));
}
