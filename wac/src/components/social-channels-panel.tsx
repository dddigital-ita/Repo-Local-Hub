"use client";

import { Facebook, Instagram, Linkedin, type LucideIcon } from "lucide-react";
import { GlassBadge, GlassButton, GlassSectionHeader } from "@/components/glass";
import type { SocialAccountView } from "@/lib/social-oauth";

/** Esito dell'OAuth, composto dalla pagina server. */
export interface SocialNotice {
  tone: "ok" | "warn" | "error";
  text: string;
}

const NOTICE_CLS = {
  ok: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  error: "bg-red-50 text-red-800 ring-red-200",
};

const BADGE_OK = "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70";
const BADGE_OFF = "bg-slate-100 text-slate-600 ring-1 ring-slate-300/70";

/** Scadenza token utente Meta (ISO → data leggibile). */
function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" });
}

function AccountRow({ account }: { account: SocialAccountView }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-2xl bg-white/55 px-3.5 py-2.5 ring-1 ring-white/60">
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-slate-900">
          {account.label ?? account.externalId}
        </span>
        <span className="block truncate font-mono text-[11px] text-slate-400">{account.externalId}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        {account.tokenHint ? <span className="font-mono">token {account.tokenHint}</span> : <span>token non salvato</span>}
        {account.userTokenExpiresAt ? (
          <span>utente 60gg: {formatExpiry(account.userTokenExpiresAt) || account.userTokenExpiresAt}</span>
        ) : null}
        {!account.enabled ? <span className="font-semibold text-amber-700">disattivato</span> : null}
      </span>
    </li>
  );
}

function ProviderSection({
  icon: Icon,
  channel,
  title,
  subtitle,
  badge,
  accounts,
  configured,
  formAction,
  buttonLabel,
  buttonHint,
  note,
}: {
  icon: LucideIcon;
  /** Canale registry: il webhook che l'account alimenta. */
  channel: string;
  title: string;
  subtitle: string;
  badge: { text: string; cls: string };
  accounts: SocialAccountView[];
  configured: boolean;
  formAction: string;
  buttonLabel: string;
  buttonHint: string;
  note?: string;
}) {
  const connected = accounts.length > 0;
  return (
    <section className="space-y-3">
      <GlassSectionHeader
        icon={Icon}
        title={title}
        subtitle={subtitle}
        right={<GlassBadge className={badge.cls}>{badge.text}</GlassBadge>}
      />
      {connected ? (
        <ul className="space-y-2">
          {accounts.map((a) => (
            <AccountRow key={`${a.channel}-${a.externalId}`} account={a} />
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl bg-slate-50 px-3.5 py-3 text-xs leading-relaxed text-slate-600 ring-1 ring-slate-200/70">
          Nessun account collegato: dopo l&apos;OAuth la pagina (o l&apos;organizzazione) compare qui e il
          webhook omnicanale <code className="font-mono">/api/webhooks/{channel}</code> è già
          pronto a verificare le firme con il secret cifrato.
        </p>
      )}
      <form method="post" action={formAction} className="rounded-3xl border border-white/60 bg-white/45 p-4 ring-1 ring-white/40 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-xl">
            <p className="text-sm font-semibold text-slate-900">{buttonLabel}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{buttonHint}</p>
            {note ? <p className="mt-1.5 text-xs leading-relaxed text-amber-700">{note}</p> : null}
          </div>
          <GlassButton type="submit" variant="glass" disabled={!configured}>
            {buttonLabel}
          </GlassButton>
        </div>
        {!configured ? (
          <p className="mt-2 text-[11px] font-medium text-amber-700">
            Credenziali app non trovate nelle variabili d&apos;ambiente: aggiungi le chiavi in .env (vedi
            .env.example) e riavvia.
          </p>
        ) : null}
      </form>
    </section>
  );
}

export default function SocialChannelsPanel({
  accounts,
  metaConfigured,
  linkedinConfigured,
  metaNotice,
  linkedinNotice,
}: {
  accounts: SocialAccountView[];
  metaConfigured: boolean;
  linkedinConfigured: boolean;
  metaNotice: SocialNotice | null;
  linkedinNotice: SocialNotice | null;
}) {
  const byChannel = (c: SocialAccountView["channel"]) => accounts.filter((a) => a.channel === c);
  const facebook = byChannel("facebook");
  const instagram = byChannel("instagram");
  const linkedin = byChannel("linkedin");
  // Scadenza più lontana del token utente Meta (60gg): il promemoria
  // del ricollegamento vive dove il team guarda.
  const userTokenExpiry = facebook
    .map((a) => a.userTokenExpiresAt)
    .filter((x): x is string => Boolean(x))
    .sort()
    .at(-1);

  return (
    <div className="space-y-6">
      {metaNotice ? (
        <div className={`rounded-2xl px-3.5 py-3 text-sm font-medium ring-1 ${NOTICE_CLS[metaNotice.tone]}`}>
          {metaNotice.text}
        </div>
      ) : null}
      {linkedinNotice ? (
        <div className={`rounded-2xl px-3.5 py-3 text-sm font-medium ring-1 ${NOTICE_CLS[linkedinNotice.tone]}`}>
          {linkedinNotice.text}
        </div>
      ) : null}

      <ProviderSection
        icon={Facebook}
        channel="facebook"
        title="Facebook (pagine)"
        subtitle="Pagine gestibili dall'utente che autorizza: id pagina + app secret + token pagina, tutti cifrati nel DB."
        badge={
          facebook.length > 0
            ? { text: `${facebook.length} ${facebook.length === 1 ? "pagina collegata" : "pagine collegate"}`, cls: BADGE_OK }
            : { text: "Da collegare", cls: BADGE_OFF }
        }
        accounts={facebook}
        configured={metaConfigured}
        formAction="/api/auth/meta/start"
        buttonLabel="Collega con Meta"
        buttonHint="OAuth in una nuova scheda: autorizza la gestione delle pagine e torni qui. Lo state anti-CSRF dura 10 minuti."
        note={
          userTokenExpiry
            ? `Il token utente Meta (60 giorni) scade il ${formatExpiry(userTokenExpiry)}: dopo la scadenza ricollega per rinnovare i token delle pagine.`
            : undefined
        }
      />

      <ProviderSection
        icon={Instagram}
        channel="instagram"
        title="Instagram (Business)"
        subtitle="Account Instagram Business collegati alle pagine Facebook autorizzate: id IG + token, cifrati."
        badge={
          instagram.length > 0
            ? { text: `${instagram.length} ${instagram.length === 1 ? "account collegato" : "account collegati"}`, cls: BADGE_OK }
            : { text: "Da collegare", cls: BADGE_OFF }
        }
        accounts={instagram}
        configured={metaConfigured}
        formAction="/api/auth/meta/start"
        buttonLabel="Collega con Meta"
        buttonHint="Stesso OAuth di Facebook: gli Instagram Business collegati alle pagine autorizzate compaiono automaticamente."
        note="Un IG Business senza pagina Facebook collegata non è gestibile via API: collega prima la pagina, poi l'account IG."
      />

      <ProviderSection
        icon={Linkedin}
        channel="linkedin"
        title="LinkedIn (organizzazioni)"
        subtitle="Organizzazioni in cui l'utente è amministratore: URN organizzazione + client secret + token, cifrati."
        badge={
          linkedin.length > 0
            ? { text: `${linkedin.length} ${linkedin.length === 1 ? "organizzazione collegata" : "organizzazioni collegate"}`, cls: BADGE_OK }
            : { text: "Da collegare", cls: BADGE_OFF }
        }
        accounts={linkedin}
        configured={linkedinConfigured}
        formAction="/api/auth/linkedin/start"
        buttonLabel="Collega con LinkedIn"
        buttonHint="OAuth con scope w_identity: identità dell'organizzazione per il webhook e l'inbound."
        note="Messaging SPENTO per contratto: l'invio su LinkedIn richiede lo scope w_organization_social e l'approvazione Marketing Developer Platform — si attiva solo dopo l'approvazione."
      />
    </div>
  );
}
