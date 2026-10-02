/**
 * OAUTH LINKEDIN — AVVIO (§3 del piano social).
 *
 * POST ONLY (GET esplicito 405, come il gemello Meta).
 * Richiede l'admin, pianta lo state CSRF in cookie
 * httpOnly (10 min) e 302 all'autorizzazione LinkedIn
 * con scope w_identity (identità organizzazione).
 *
 * Il MESSAGGING resta SPENTO: w_organization_social
 * richiede l'approvazione Marketing Developer Platform —
 * nessun codice di invio esiste finché non arriva.
 */
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import {
  getLinkedinAppConfig,
  linkedinAuthorizationUrl,
  linkedinRedirectUri,
  newOAuthState,
  setOAuthStateCookie,
} from "@/lib/social-oauth";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "linkedin_oauth_state";

export async function GET() {
  return Response.json({ ok: false, error: "metodo_non_consentito" }, { status: 405 });
}

export async function POST() {
  await requireAdmin();

  const app = getLinkedinAppConfig();
  if (!app) {
    redirect("/admin/settings/social?linkedin=app_non_configurata");
  }

  const state = newOAuthState();
  await setOAuthStateCookie(STATE_COOKIE, state);

  redirect(linkedinAuthorizationUrl(state, linkedinRedirectUri(), app));
}
