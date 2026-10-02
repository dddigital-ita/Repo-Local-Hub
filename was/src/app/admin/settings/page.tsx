import type { Metadata } from "next";
import { Globe, Mail, MessageCircle, MessagesSquare, NotebookPen, Send, Settings, ShieldCheck, Smile, Sparkles, Timer, TimerReset } from "lucide-react";
import { GlassCard as Card, GlassSectionHeader } from "@/components/glass";
import { HubCard, HubCount, HubStatus } from "@/components/settings-hub";
import { requireAdmin } from "@/lib/admin";
import { hubSummary, type HubCardStatus } from "@/lib/settings-status";
import { getSettingsStatuses } from "@/lib/settings-status-server";
import { getIntegrationStatuses } from "@/lib/integrations-status";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Impostazioni · Admin", robots: { index: false } };

/** Due o più pill impilate/affiancate per l'area destra delle card. */
function PillStack({ children }: { children: React.ReactNode }) {
  return <span className="flex flex-wrap items-center justify-end gap-1.5">{children}</span>;
}

/**
 * IMPOSTAZIONI — hub di schede, sullo stesso pattern di /admin/tools.
 * La pagina è PURA PRESENTAZIONE: ogni badge deriva dal layer dati testabile
 * (`settings-status-server` → `settings-status`), come la sezione
 * Integrazioni deriva dal registro (`integrations-registry`/`-status`).
 * UNA scheda = UNA pagina dedicata: apri, regoli, chiudi.
 */
export default async function SettingsPage() {
  await requireAdmin();
  const [statuses, integrations] = await Promise.all([
    getSettingsStatuses(),
    getIntegrationStatuses(),
  ]);
  const { replies, chatEmojis, sla, autoClose, email, whatsapp, telegram, followup, cloudflare } = statuses;
  /** Le integrazioni del registro entrano nel riepilogo: l'hub le mostra
      nella sezione Integrazioni, la pill deve raccontare tutto l'hub. */
  const integrationStatuses: HubCardStatus[] = integrations.map(({ def, warn }) => ({
    key: def.key,
    ok: !warn,
    warn,
    label: def.label,
    counts: [],
  }));
  /** Riepilogo nell'header: quante schede hanno un'azione attesa (solo le ambre). */
  const summary = hubSummary([
    replies,
    chatEmojis,
    sla,
    autoClose,
    email,
    whatsapp,
    telegram,
    followup,
    cloudflare,
    ...integrationStatuses,
  ]);

  return (
    <div className="space-y-6">
      {/* ── Header di pagina (stesso pattern di Tools) ─────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold text-slate-900">
            <Settings className="h-6 w-6 text-brand-600" aria-hidden />
            Impostazioni
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Una scheda per argomento: apri, regoli, chiudi. Lo stato della scheda si legge da qui.
          </p>
        </div>
        <HubStatus ok={summary.ok} warn={summary.warn} label={summary.label} />
      </div>

      {/* ── Ticketing: regole di lavoro del team ───────────────────── */}
      <Card>
        <GlassSectionHeader
          icon={MessagesSquare}
          title="Ticketing"
          subtitle="Come lavorano gli agenti: frasi pronte, tempi di risposta, chiusura automatica."
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <HubCard
            href="/admin/settings/risposte-rapide"
            Icon={MessagesSquare}
            tone="bg-white/70 text-brand-700"
            title="Risposte rapide"
            text="Le frasi pronte che gli agenti cliccano invece di riscriverle, sotto il campo risposta di ogni ticket."
            right={
              <PillStack>
                {replies.counts.map((c) => (
                  <HubCount key={c.label} n={c.n} label={c.label} />
                ))}
                <HubStatus ok={replies.ok} label={replies.label} />
              </PillStack>
            }
          />
          <HubCard
            href="/admin/settings/sla"
            Icon={Timer}
            tone="bg-white/70 text-orange-600"
            title="Policy SLA per priorità"
            text="Quante ore per rispondere e risolvere, per priorità. Da qui nascono i badge «scade presto» e «in ritardo»."
            right={
              <PillStack>
                {sla.counts.map((c) => (
                  <HubCount key={c.label} n={c.n} label={c.label} />
                ))}
                <HubStatus ok={sla.ok} label={sla.label} />
              </PillStack>
            }
          />
          <HubCard
            href="/admin/settings/chiusura-automatica"
            Icon={TimerReset}
            tone="bg-white/70 text-slate-600"
            title="Chiusura automatica"
            text="Chiude in automatico i ticket «In attesa cliente» dopo N giorni di silenzio (opzionale, eseguita dal cron)."
            right={<HubStatus ok={autoClose.ok} label={autoClose.label} />}
          />
        </div>
      </Card>

      {/* ── Canali: con quali mezzi parla l'agenzia ────────────────── */}
      <Card>
        <GlassSectionHeader
          icon={Mail}
          title="Canali"
          subtitle="Con quali mezzi parla l'agenzia: email collegata, WhatsApp in arrivo e la chat pubblica."
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <HubCard
            href="/admin/settings/email"
            Icon={Mail}
            tone="bg-white/70 text-blue-600"
            title="Posta elettronica"
            text="Server SMTP e IMAP dell'agenzia: da qui partono le risposte e entrano le email dei clienti come ticket."
            right={
              <HubStatus
                ok={email.ok}
                warn={email.warn}
                label={email.label}
              />
            }
          />
          <HubCard
            href="/admin/settings/whatsapp"
            Icon={MessageCircle}
            tone="bg-white/70 text-emerald-600"
            title="WhatsApp Business"
            text="Predisposto: schema, policy e adapter sono pronti; mancano account Meta e webhook per accenderlo."
            right={<HubStatus ok={whatsapp.ok} warn={whatsapp.warn} label={whatsapp.label} />}
          />
          <HubCard
            href="/admin/settings/telegram"
            Icon={Send}
            tone="bg-white/70 text-sky-600"
            title="Telegram"
            text="Il canale bidirezionale di Ambrosio: bot, chat del team e webhook si gestiscono qui, senza toccare l'env."
            right={<HubStatus ok={telegram.ok} warn={telegram.warn} label={telegram.label} />}
          />
          <HubCard
            href="/admin/settings/emoji-chat"
            Icon={Smile}
            tone="bg-white/70 text-brand-700"
            title="Emoji della chat"
            text="Le emoticon del picker che i visitatori usano nel composer della chat pubblica."
            right={
              <PillStack>
                {chatEmojis.counts.map((c) => (
                  <HubCount key={c.label} n={c.n} label={c.label} />
                ))}
                <HubStatus ok={chatEmojis.ok} label={chatEmojis.label} />
              </PillStack>
            }
          />
        </div>
      </Card>

      {/* ── Protezione: captcha e difese del perimetro pubblico ────── */}
      <Card>
        <GlassSectionHeader
          icon={ShieldCheck}
          title="Protezione"
          subtitle="Le difese del perimetro pubblico: la configurazione sta qui, la diagnostica su Shield."
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <HubCard
            href="/admin/settings/cloudflare"
            Icon={Globe}
            tone="bg-white/70 text-orange-600"
            title="Cloudflare (Turnstile)"
            text="Il captcha invisibile su login, chat e lead: chiavi si salvano qui, la diagnostica resta su Shield."
            right={
              <PillStack>
                {(cloudflare.meta ?? []).map((m) => (
                  <span
                    key={m}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200/70"
                  >
                    {m}
                  </span>
                ))}
                <HubStatus ok={cloudflare.ok} warn={cloudflare.warn} label={cloudflare.label} />
              </PillStack>
            }
          />
          <HubCard
            href="/admin/shield"
            Icon={ShieldCheck}
            tone="bg-white/70 text-emerald-600"
            title="Shield — diagnostica"
            text="Eventi bloccati, IP bannati e tentativi di reset: la diagnostica dello scudo in tempo reale."
          />
        </div>
      </Card>

      {/* ── Integrazioni: DAL REGISTRO — si popola da solo ─────────── */}
      <Card>
        <GlassSectionHeader
          icon={NotebookPen}
          title="Integrazioni"
          subtitle="Dove arrivano i dati dell'agenzia e come si collegano i servizi esterni."
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {integrations.map(({ def, ok, warn, label, counts, meta }) => (
            <HubCard
              key={def.key}
              href={def.href}
              Icon={def.Icon}
              tone={def.tone}
              title={def.label}
              text={def.text}
              right={
                <PillStack>
                  {meta.map((m) => (
                    <span
                      key={m}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200/70"
                    >
                      {m}
                    </span>
                  ))}
                  {counts.map((c) => (
                    <HubCount key={c.label} n={c.n} label={c.label} />
                  ))}
                  <HubStatus ok={ok} warn={warn} label={label} />
                </PillStack>
              }
            />
          ))}
        </div>
      </Card>

      {/* ── Ambrosio: collegamento diretto alle sue impostazioni ───── */}
      <Card>
        <GlassSectionHeader
          icon={Sparkles}
          title="Ambrosio"
          subtitle="Il follow-up dei lead spariti si regola qui; tutta la configurazione dell'AI sta in Ambrosio · AI."
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <HubCard
            href="/admin/settings/lead-followup"
            Icon={Timer}
            tone="bg-white/70 text-violet-600"
            title="Follow-up ai lead spariti"
            text="Un solo gentile ricordo nella chat a chi lascia i contatti e non scrive più: parte solo fuori dai turni umani."
            right={<HubStatus ok={followup.ok} warn={followup.warn} label={followup.label} />}
          />
          <HubCard
            href="/admin/ai"
            Icon={Sparkles}
            tone="bg-white/70 text-violet-600"
            title="Tutta la configurazione AI"
            text="On/off, provider, chiavi, FAQ e test dal vivo: tutto quello che riguarda Ambrosio sta nella sua area."
          />
        </div>
      </Card>
    </div>
  );
}