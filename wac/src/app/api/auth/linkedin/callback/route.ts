/**
 * OAUTH LINKEDIN — CALLBACK (§3 del piano social).
 *
 * GET per CONTRATTO del provider: LinkedIn 302-indietro
 * con ?code= e ?state=. Stessa disciplina del callback
 * Meta — la sentinella GET-purity lo documenta in
 * WHITELIST con motivo: state CSRF httpOnly 10 min con
 * confronto costante (non prefetchabile senza code+state
 * validi) e UNA scrittura idempotente: l'upsert
 * (ON CONFLICT channel,external_id) di channel_accounts
 * con client secret e token CIFRATI.
 *
 * Flusso: code → access token → /v2/organizations?
 * role=ADMINISTRATOR → per ogni organizzazione un
 * account linkedin con external_id = urn:li:organization:<id>
 * (l'identità che il webhook riceve in
 * events[].organizationalEntity e firma con X-LI-Signature).
 *
 * messaging SPENTO per contract: w_organization_social
 * serve l'approvazione Marketing Developer Platform.
 */
import { redirect } from "next/navigation";
import {
  exchangeLinkedinCode,
  fetchLinkedinOrganizations,
  getLinkedinAppConfig,
  linkedinCredentials,
  linkedinRedirectUri,
  upsertChannelAccount,
  verifyOAuthState,
  ProviderError,
} from "@/lib/social-oauth";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "linkedin_oauth_state";

function fail(message: string): never {
  redirect(`/admin/settings/social?linkedin=${encodeURIComponent(message)}`);
}

export async function GET(req: Request) {
  const app = getLinkedinAppConfig();
  if (!app) fail("app_non_configurata");

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  // CSRF: lo state deve combaciare col cookie httpOnly.
  if (!code || !state || !(await verifyOAuthState(STATE_COOKIE, state))) {
    fail("state_non_valido");
  }

  try {
    const redirectUri = linkedinRedirectUri();
    const accessToken = await exchangeLinkedinCode(code, redirectUri, app);
    const organizations = await fetchLinkedinOrganizations(accessToken);
    if (organizations.length === 0) fail("nessuna_organizzazione");

    for (const org of organizations) {
      await upsertChannelAccount(
        "linkedin",
        `urn:li:organization:${org.id}`,
        org.name,
        linkedinCredentials(app.clientSecret, accessToken),
      );
    }
    redirect(
      `/admin/settings/social?linkedin=collegato&organizzazioni=${organizations.length}`,
    );
  } catch (e) {
    const detail = e instanceof ProviderError ? e.message : e instanceof Error ? e.message : String(e);
    fail(`errore:${detail.slice(0, 120)}`);
  }
}
