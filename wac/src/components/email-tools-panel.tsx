"use client";

import { useState } from "react";
import {
  Inbox,
  KeyRound,
  LoaderCircle,
  Mail,
  RefreshCw,
  Save,
  Send,
  Server,
  Ticket,
} from "lucide-react";
import {
  saveEmailToolsAction,
  syncEmailIngestAction,
  testEmailToolsAction,
} from "@/app/admin/actions";
import { GlassBadge, GlassButton, GlassSectionHeader, GlassStatus } from "@/components/glass";
import type { EmailToolsConfigBase } from "@/lib/email-tools-shared";
import { EMAIL_PRESETS } from "@/lib/email-tools-shared";

function Status({ ok, label }: { ok: boolean; label: string }) {
  return <GlassStatus ok={ok} label={label} />;
}

function ServerCard({
  icon: Icon,
  tone,
  title,
  description,
  status,
  children,
}: {
  icon: typeof Mail;
  tone: string;
  title: string;
  description: string;
  status: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="group rounded-3xl border border-white/60 bg-white/55 p-4 shadow-[0_12px_35px_-24px_rgb(15_23_42/.5)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white/70">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${tone} shadow-sm`}>
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        {status}
      </div>
      <div className="mt-3">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>
      </div>
      {children}
    </div>
  );
}

const inputCls =
  "mt-1 w-full rounded-2xl border border-white/70 bg-white/65 px-3 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-500 focus:border-brand-400 focus:bg-white";

export default function EmailToolsPanel({ config, testMessage }: { config: EmailToolsConfigBase; testMessage?: string }) {
  const [saving, setSaving] = useState(false);
  const [preset, setPreset] = useState("custom");
  const connected = Boolean(config.smtpHost && config.user && config.hasPassword);

  function applyPreset(key: string) {
    setPreset(key);
    const p = EMAIL_PRESETS[key];
    if (!p) return;
    const form = document.getElementById("email-tools-form") as HTMLFormElement | null;
    if (!form) return;
    const set = (name: string, value: string) => {
      const el = form.elements.namedItem(name) as HTMLInputElement | null;
      if (el) el.value = value;
    };
    set("smtpHost", p.smtpHost);
    set("smtpPort", String(p.smtpPort));
    set("imapHost", p.imapHost);
    set("imapPort", String(p.imapPort));
  }

  return (
    <div className="space-y-4">
      <GlassSectionHeader
        icon={Mail}
        title="Posta elettronica"
        subtitle="Collega il server dell'agenzia per inviare e ricevere email."
        right={
          <GlassBadge className="px-3 py-1.5 font-semibold ring-1 ring-brand-100 text-brand-700 glass-badge-brand">
            {connected ? "Server collegato" : "Da collegare"}
          </GlassBadge>
        }
      />

      {testMessage && (
        <div
          className={`rounded-2xl px-3.5 py-3 text-sm font-medium ring-1 ${
            testMessage.startsWith("SMTP ok") || testMessage.includes("salvata")
              ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
              : "bg-amber-50 text-amber-800 ring-amber-200"
          }`}
        >
          {testMessage}
        </div>
      )}

      {/* Le due metà del servizio di posta: invio e ricezione */}
      <div className="grid gap-3 md:grid-cols-2">
        <ServerCard
          icon={Send}
          tone="bg-blue-50 text-blue-600"
          title="Invio · SMTP"
          description="Parte da qui ogni email dell'agenzia: risposte ai clienti, notifiche e test."
          status={<Status ok={Boolean(config.smtpHost)} label={config.smtpHost ? "Configurato" : "Da configurare"} />}
        >
          <p className="mt-3 rounded-xl bg-white/55 px-3 py-2 font-mono text-[11px] text-slate-600 ring-1 ring-white/60">
            {config.smtpHost ? `${config.smtpHost}:${config.smtpPort}` : "smtp.provider.it · porta 587"}
          </p>
        </ServerCard>
        <ServerCard
          icon={Inbox}
          tone="bg-violet-50 text-violet-600"
          title="Ricezione · IMAP"
          description="Legge la casella dell'agenzia: le risposte dei clienti entrano nel sistema."
          status={<Status ok={Boolean(config.imapHost)} label={config.imapHost ? "Configurato" : "Opzionale"} />}
        >
          <p className="mt-3 rounded-xl bg-white/55 px-3 py-2 font-mono text-[11px] text-slate-600 ring-1 ring-white/60">
            {config.imapHost ? `${config.imapHost}:${config.imapPort}` : "imap.provider.it · porta 993"}
          </p>
        </ServerCard>
      </div>

      {/* Configurazione: preset provider + credenziali */}
      <form id="email-tools-form" action={saveEmailToolsAction} onSubmit={() => setSaving(true)} className="rounded-3xl border border-white/60 bg-white/45 p-4 ring-1 ring-white/40 backdrop-blur-xl">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm">
            <Server className="h-4 w-4" aria-hidden />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Configurazione server</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              Scegli il provider per compilare host e porte, poi inserisci l&apos;account. La password viene cifrata
              e non viene mai mostrata per intero.
            </p>
          </div>
        </div>

        {/* Preset: i provider italiani prima */}
        <div className="mt-4">
          <span className="text-xs font-semibold text-slate-600">Provider</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Preset provider email">
            {Object.entries(EMAIL_PRESETS).map(([key, p]) => (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                aria-pressed={preset === key}
                className={`min-h-10 rounded-full px-3.5 py-2 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
                  preset === key
                    ? "bg-slate-900 text-white shadow-sm"
                    : "border border-white/60 bg-white/60 text-slate-600 hover:bg-white/90 hover:text-slate-900"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-slate-600">
            Email dell&apos;agenzia
            <input name="fromEmail" type="email" defaultValue={config.fromEmail} placeholder="info@webagencycrema.it" className={inputCls} />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Nome visualizzato
            <input name="fromName" defaultValue={config.fromName} placeholder="Web Agency Crema" className={inputCls} />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Server SMTP (invio)
            <input name="smtpHost" defaultValue={config.smtpHost} placeholder="smtp.provider.it" className={inputCls} />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Porta SMTP
            <input name="smtpPort" type="number" min={1} max={65535} defaultValue={config.smtpPort} className={inputCls} />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Server IMAP (ricezione)
            <input name="imapHost" defaultValue={config.imapHost} placeholder="imap.provider.it" className={inputCls} />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Porta IMAP
            <input name="imapPort" type="number" min={1} max={65535} defaultValue={config.imapPort} className={inputCls} />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Utente (di solito l&apos;email)
            <input name="user" type="email" autoComplete="off" defaultValue={config.user} placeholder="info@webagencycrema.it" className={inputCls} />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Password{" "}
            <span className="font-normal text-slate-400">
              {config.passwordHint ? `· salvata ${config.passwordHint}, lascia vuoto per conservare` : "(APP password se Gmail)"}
            </span>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder={config.passwordHint ? `${config.passwordHint} · lascia vuoto per conservare` : "••••••••"}
              className={inputCls}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400">Le credenziali restano server-side: il browser non le riceve mai.</p>
          <GlassButton type="submit" disabled={saving}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            Salva configurazione
          </GlassButton>
        </div>
      </form>

      {/* Test live: connessione + invio reale */}
      <form action={testEmailToolsAction} className="rounded-3xl border border-white/60 bg-white/45 p-4 ring-1 ring-white/40 backdrop-blur-xl">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm">
            <KeyRound className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-slate-900">Testa la connessione</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              Verifica SMTP e IMAP e invia una email di prova reale all&apos;indirizzo indicato (default: l&apos;email dell&apos;agenzia).
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="block min-w-0 flex-1 text-xs font-semibold text-slate-600 sm:max-w-xs">
                Invia l&apos;email di prova a
                <input
                  name="testRecipient"
                  type="email"
                  placeholder={config.fromEmail || config.user || "destinatario@test.it"}
                  className={inputCls}
                />
              </label>
              <GlassButton type="submit" variant="glass">
                <Send className="h-3.5 w-3.5" aria-hidden />
                Testa e invia
              </GlassButton>
            </div>
          </div>
        </div>
      </form>

      {/* Canale ticket: scarica la casella e trasforma le email in ticket o risposte. */}
      <form action={syncEmailIngestAction} className="rounded-3xl border border-white/60 bg-white/45 p-4 ring-1 ring-white/40 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-600/90 text-white shadow-sm">
              <Ticket className="h-4 w-4" aria-hidden />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Canale ticket</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                Scarica la casella: le nuove email diventano ticket, le risposte con «[#N]» nell&apos;oggetto tornano nel ticket giusto. Il cron lo fa ogni 15 minuti.
              </p>
            </div>
          </div>
          <GlassButton type="submit">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Sincronizza ora
          </GlassButton>
        </div>
      </form>
    </div>
  );
}
