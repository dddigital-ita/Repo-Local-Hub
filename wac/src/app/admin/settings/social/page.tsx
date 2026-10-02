import type { Metadata } from "next";
import { AtSign } from "lucide-react";
import { GlassCard as Card } from "@/components/glass";
import { SubPageHeader } from "@/components/sub-page-header";
import SocialChannelsPanel, { type SocialNotice } from "@/components/social-channels-panel";
import { requireAdmin } from "@/lib/admin";
import {
  getLinkedinAppConfig,
  getMetaAppConfig,
  getSocialChannelsView,
} from "@/lib/social-oauth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Canali social · Impostazioni", robots: { index: false } };

/**
 * Esito del flusso OAuth, dal query string con cui le
 * callback riportano l'admin qui (?meta=… / ?linkedin=…
 * + eventuali contatori). Il canale distingue il banner.
 */
function composeNotice(
  provider: "Meta" | "LinkedIn",
  value: string | undefined,
  extras: Record<string, string | undefined>,
): SocialNotice | null {
  if (!value) return null;
  if (value === "collegato") {
    const dettagli: string[] = [];
    if ("pagine" in extras && extras.pagine !== undefined) {
      dettagli.push(`${extras.pagine} ${extras.pagine === "1" ? "pagina Facebook" : "pagine Facebook"}`);
    }
    if ("instagram" in extras && extras.instagram !== undefined) {
      dettagli.push(`${extras.instagram} ${extras.instagram === "1" ? "account Instagram" : "account Instagram"}`);
    }
    if ("organizzazioni" in extras && extras.organizzazioni !== undefined) {
      dettagli.push(`${extras.organizzazioni} ${extras.organizzazioni === "1" ? "organizzazione" : "organizzazioni"}`);
    }
    return {
      tone: "ok",
      text: `${provider} collegato${dettagli.length ? `: ${dettagli.join(" e ")}` : ""}. Token e segreti cifrati nel database: i webhook omnicanale verificano già le firme.`,
    };
  }
  if (value === "app_non_configurata") {
    return {
      tone: "warn",
      text: `App ${provider} non configurata: aggiungi le chiavi in .env (vedi .env.example) e riavvia, poi riprova.`,
    };
  }
  if (value === "state_non_valido") {
    return {
      tone: "error",
      text: `State anti-CSRF non valido o scaduto (dura 10 minuti): riavvia il collegamento dal pulsante «Collega con ${provider}».`,
    };
  }
  if (value === "nessuna_pagina" || value === "nessuna_organizzazione") {
    return {
      tone: "warn",
      text:
        value === "nessuna_pagina"
          ? "Nessuna pagina gestibile dall'utente che ha autorizzato: verifica i permessi dell'app Meta (pages_show_list)."
          : "Nessuna organizzazione con ruolo amministratore per l'utente che ha autorizzato: verifica i permessi dell'app LinkedIn.",
    };
  }
  if (value.startsWith("errore:")) {
    return { tone: "error", text: `${provider}: ${value.slice("errore:".length)}` };
  }
  return { tone: "warn", text: `Esito OAuth ${provider} non riconosciuto: ${value}` };
}

export default async function SocialToolsPage({
  searchParams,
}: {
  searchParams: Promise<{
    meta?: string;
    pagine?: string;
    instagram?: string;
    scadenza?: string;
    linkedin?: string;
    organizzazioni?: string;
  }>;
}) {
  await requireAdmin();
  const { meta, pagine, instagram, scadenza, linkedin, organizzazioni } =
    await searchParams;
  const accounts = await getSocialChannelsView();

  const metaNotice = composeNotice("Meta", meta, { pagine, instagram });
  const linkedinNotice = composeNotice("LinkedIn", linkedin, { organizzazioni });
  // La scadenza del token utente (60gg) è un promemoria, non un errore.
  if (metaNotice && scadenza) {
    metaNotice.text += ` Il token utente scade il ${new Date(scadenza).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" }) || scadenza}: ricollega per rinnovare.`;
  }

  return (
    <div className="space-y-6">
      <SubPageHeader
        backHref="/admin/settings"
        backLabel="Impostazioni"
        Icon={AtSign}
        tone="text-indigo-600"
        title="Canali social"
        subtitle="Facebook, Instagram Business e LinkedIn via OAuth: id, app secret e token cifrati nel database. Dopo il «Collega» i webhook /api/webhooks/{facebook,instagram,linkedin} verificano già le firme."
      />

      <Card>
        <SocialChannelsPanel
          accounts={accounts}
          metaConfigured={Boolean(getMetaAppConfig())}
          linkedinConfigured={Boolean(getLinkedinAppConfig())}
          metaNotice={metaNotice}
          linkedinNotice={linkedinNotice}
        />
      </Card>
    </div>
  );
}
