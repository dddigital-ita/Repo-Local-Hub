/**
 * OAUTH META — CALLBACK (§2 del piano social).
 *
 * GET per CONTRATTO del provider: Meta 302-indietro con
 * ?code= e ?state= dopo il consenso. La sentinella GET-purity
 * lo documenta in WHITELIST con motivo:
 *   - lo state CSRF (cookie httpOnly 10 min, confronto in
 *     tempo costante) rende il GET NON eseguibile da un
 *     prefetch: senza un code+state validi appena emessi,
 *     non succede nulla;
 *   - la scrittura è UN upsert idempotente
 *     (ON CONFLICT channel,external_id) che popola
 *     channel_accounts con app secret e token CIFRATI
 *     (AES-256-GCM, encryptKey): il contratto che il
 *     webhook omnicanale verifica già (X-Hub-Signature-256
 *     con credentials.secretEnc).
 *
 * Flusso: code → token breve → token utente 60gg →
 * me/accounts → per ogni pagina: account facebook
 * (external_id = id pagina; secretEnc, accessTokenEnc,
 * userTokenEnc, expiresAt) e, se c'è, account instagram
 * (external_id = id IG Business; secretEnc, accessTokenEnc).
 */
import { redirect } from "next/navigation";
import {
  exchangeMetaCode,
  extendMetaToken,
  fetchMetaPageAccounts,
  facebookCredentials,
  getMetaAppConfig,
  instagramCredentials,
  metaRedirectUri,
  upsertChannelAccount,
  verifyOAuthState,
  ProviderError,
} from "@/lib/social-oauth";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "meta_oauth_state";

function fail(message: string): never {
  redirect(`/admin/settings/social?meta=${encodeURIComponent(message)}`);
}

export async function GET(req: Request) {
  const app = getMetaAppConfig();
  if (!app) fail("app_non_configurata");

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  // CSRF: lo state deve combaciare col cookie httpOnly.
  // Nessuna corrispondenza = prefetch/crawler/attacco:
  // nessuna scrittura, solo redirect indietro.
  if (!code || !state || !(await verifyOAuthState(STATE_COOKIE, state))) {
    fail("state_non_valido");
  }

  try {
    const redirectUri = metaRedirectUri();
    // 1) code → token breve, 2) → token utente 60 giorni.
    const shortToken = await exchangeMetaCode(code, redirectUri, app);
    const longLived = await extendMetaToken(shortToken, app);
    // 3) pagine gestibili (+ IG Business collegati).
    const pages = await fetchMetaPageAccounts(longLived.accessToken);
    if (pages.length === 0) fail("nessuna_pagina");

    // 4) upsert: OGNI pagina è un account facebook, OGNI
    //    IG Business un account instagram — il contratto
    //    del webhook (channel_accounts) è pronto subito.
    let instagrams = 0;
    for (const page of pages) {
      await upsertChannelAccount(
        "facebook",
        page.id,
        page.name,
        facebookCredentials(app.appSecret, page.accessToken, longLived.accessToken, longLived.expiresAt),
      );
      if (page.instagramBusinessAccount) {
        await upsertChannelAccount(
          "instagram",
          page.instagramBusinessAccount.id,
          page.instagramBusinessAccount.name,
          instagramCredentials(app.appSecret, page.instagramBusinessAccount.accessToken),
        );
        instagrams++;
      }
    }
    redirect(
      `/admin/settings/social?meta=collegato&pagine=${pages.length}&instagram=${instagrams}` +
        (longLived.expiresAt ? `&scadenza=${encodeURIComponent(longLived.expiresAt)}` : ""),
    );
  } catch (e) {
    const detail = e instanceof ProviderError ? e.message : e instanceof Error ? e.message : String(e);
    fail(`errore:${detail.slice(0, 120)}`);
  }
}
