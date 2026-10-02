"use client";

import { useState } from "react";
import { BarChart3, ExternalLink, Gauge, Globe2, KeyRound, LoaderCircle, Save, Search, ShieldCheck, Tag, Trash2 } from "lucide-react";
import { saveGoogleToolsAction, testGooglePageSpeedAction, saveGscCredentialsAction, testGscConnectionAction, removeGscCredentialsAction } from "@/app/admin/actions";
import { GlassBadge, GlassButton, GlassSectionHeader, GlassStatus } from "@/components/glass";
import type { GoogleToolsConfig } from "@/lib/google-tools";

function Status({ ok, label }: { ok: boolean; label: string }) {
  return <GlassStatus ok={ok} label={label} />;
}

function ToolCard({ icon: Icon, tone, title, description, status, href, children }: { icon: typeof Search; tone: string; title: string; description: string; status: React.ReactNode; href: string; children?: React.ReactNode }) {
  return (
    <div className="group rounded-3xl border border-white/60 bg-white/55 p-4 shadow-[0_12px_35px_-24px_rgb(15_23_42/.5)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white/70">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${tone} shadow-sm`}>
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        {status}
      </div>
      <div className="mt-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>
        </div>
        <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Apri ${title}`} className="rounded-full p-2 text-slate-400 transition hover:bg-white hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
          <ExternalLink className="h-4 w-4" aria-hidden />
        </a>
      </div>
      {children}
    </div>
  );
}

export default function GoogleToolsPanel({ config, testMessage }: { config: GoogleToolsConfig; testMessage?: string }) {
  const [saving, setSaving] = useState(false);
  const configured = [config.ga4Id, config.gtmId, config.gscToken, config.clarityId].filter(Boolean).length;
  const onSubmit = () => setSaving(true);

  return (
    <div className="space-y-4">
      <GlassSectionHeader
        icon={Globe2}
        title="Google growth kit"
        subtitle="Misurazione, SEO e performance in un unico posto."
        right={
          <GlassBadge className="px-3 py-1.5 font-semibold ring-1 ring-brand-100 text-brand-700 glass-badge-brand">
            {configured}/4 strumenti collegati
          </GlassBadge>
        }
      />

      {testMessage && (
        <div className={`rounded-2xl px-3.5 py-3 text-sm font-medium ring-1 ${testMessage.startsWith("PageSpeed mobile:") ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}>
          {testMessage}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <ToolCard icon={BarChart3} tone="bg-orange-50 text-orange-600" title="Analytics 4" description="Misura ricerche, chat, lead, chiamate e callback dopo il consenso cookie." status={<Status ok={Boolean(config.ga4Id)} label={config.ga4Id ? "Attivo" : "Da collegare"} />} href="https://analytics.google.com">
          <p className="mt-3 rounded-xl bg-white/55 px-3 py-2 font-mono text-[11px] text-slate-600 ring-1 ring-white/60">{config.ga4Id || "ID misurazione · G-XXXXXXXXXX"}</p>
        </ToolCard>
        <ToolCard icon={Tag} tone="bg-blue-50 text-blue-600" title="Tag Manager" description="Gestisci eventi e campagne senza pubblicare codice a ogni modifica." status={<Status ok={Boolean(config.gtmId)} label={config.gtmId ? "Attivo" : "Da collegare"} />} href="https://tagmanager.google.com">
          <p className="mt-3 rounded-xl bg-white/55 px-3 py-2 font-mono text-[11px] text-slate-600 ring-1 ring-white/60">{config.gtmId || "Container · GTM-XXXXXXX"}</p>
        </ToolCard>
        <ToolCard icon={Search} tone="bg-indigo-50 text-indigo-600" title="Search Console" description="Verifica il dominio e monitora query, indicizzazione e sitemap." status={<Status ok={Boolean(config.gscToken)} label={config.gscToken ? "Verificato" : "Da verificare"} />} href="https://search.google.com/search-console">
          <p className="mt-3 rounded-xl bg-white/55 px-3 py-2 text-[11px] text-slate-600 ring-1 ring-white/60">{config.gscToken ? "Meta tag di verifica configurato" : "Token o file HTML ancora da configurare"}</p>
        </ToolCard>
        <ToolCard icon={Gauge} tone="bg-emerald-50 text-emerald-600" title="PageSpeed Insights" description="Controlla il punteggio mobile e trova i colli di bottiglia prima dei clienti." status={<Status ok={config.hasApiKey} label={config.hasApiKey ? "API pronta" : "API opzionale"} />} href="https://pagespeed.web.dev">
          <form action={testGooglePageSpeedAction} className="mt-3">
            <GlassButton type="submit" variant="glass" size="sm">
              <Gauge className="h-3.5 w-3.5" aria-hidden />
              Testa mobile
            </GlassButton>
          </form>
        </ToolCard>
      </div>

      {/* ── Search Console API: credenziali per le query reali in /admin/seo ── */}
      <div className="rounded-3xl border border-white/60 bg-white/55 p-4 shadow-[0_12px_35px_-24px_rgb(15_23_42/.5)] backdrop-blur-xl">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 shadow-sm">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Search Console — API delle query reali</h3>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-500">
                Collega l&apos;API per vedere nel pannello SEO le query con cui il sito compare davvero su Google,
                affiancate alle keyword configurate. Credenziali cifrate server-side, il token non torna mai al browser.
              </p>
            </div>
          </div>
          {config.hasGscCreds ? <Status ok label="Collegato" /> : <Status ok={false} label="Opzionale" />}
        </div>

        {config.hasGscCreds ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p className="rounded-xl bg-white/55 px-3 py-2 font-mono text-[11px] text-slate-600 ring-1 ring-white/60">
              {config.gscSiteUrl ?? "proprietà non impostata"}
            </p>
            <form action={testGscConnectionAction}>
              <GlassButton type="submit" variant="glass" size="sm">
                <Gauge className="h-3.5 w-3.5" aria-hidden />
                Testa collegamento
              </GlassButton>
            </form>
            <form action={removeGscCredentialsAction}>
              <button
                type="submit"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white/60 px-4 py-2 text-sm font-semibold text-red-700 ring-1 ring-white/60 transition hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Rimuovi
              </button>
            </form>
          </div>
        ) : (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <form action={saveGscCredentialsAction} className="space-y-2">
              <label className="block text-xs font-semibold text-slate-600">
                Credenziali OAuth <span className="font-normal text-slate-400">(JSON del file scaricato da Google Cloud, o i tre campi)</span>
                <textarea
                  name="gscJson"
                  rows={4}
                  required
                  placeholder={`{\n  "installed": {\n    "client_id": "….apps.googleusercontent.com",\n    "client_secret": "GOCSPX-…",\n    "refresh_token": "1//…"\n  }\n}`}
                  className="mt-1 w-full rounded-2xl border border-white/70 bg-white/65 px-3 py-2.5 font-mono text-[11px] text-slate-800 outline-none placeholder:text-slate-400 focus:border-brand-400 focus:bg-white"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-600">
                Proprietà Search Console
                <input
                  name="gscSiteUrl"
                  defaultValue={config.gscSiteUrl ?? ""}
                  placeholder="https://www.webagencysalento.com oppure sc-domain:webagencysalento.com"
                  className="mt-1 w-full rounded-2xl border border-white/70 bg-white/65 px-3 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-brand-400 focus:bg-white"
                />
              </label>
              <GlassButton type="submit" size="sm">
                <Save className="h-3.5 w-3.5" aria-hidden />
                Salva credenziali
              </GlassButton>
            </form>
            <ol className="space-y-2 rounded-2xl bg-white/45 px-3.5 py-3 text-xs leading-relaxed text-slate-600 ring-1 ring-white/50">
              <li>
                <strong className="text-slate-800">1.</strong> Su Google Cloud Console crea un progetto, attiva la
                «Search Console API» e crea credenziali OAuth di tipo «App desktop»; scarica il JSON.
              </li>
              <li>
                <strong className="text-slate-800">2.</strong> Genera il refresh token con accesso a
                <span className="font-mono"> https://www.googleapis.com/auth/webmasters.readonly </span>
                (l&apos;account deve avere accesso alla proprietà su Search Console).
              </li>
              <li>
                <strong className="text-slate-800">3.</strong> Incolla qui JSON e proprietà, salva e premi
                «Testa collegamento»: le query compariranno nel pannello SEO.
              </li>
            </ol>
          </div>
        )}
      </div>

      <form action={saveGoogleToolsAction} onSubmit={onSubmit} className="rounded-3xl border border-white/60 bg-white/45 p-4 ring-1 ring-white/40 backdrop-blur-xl">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm">
            <KeyRound className="h-4 w-4" aria-hidden />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Configurazione avanzata</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">I dati restano server-side. La Google API key viene cifrata e non viene mai mostrata per intero.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-slate-600">ID misurazione GA4<input name="ga4Id" defaultValue={config.ga4Id} placeholder="G-XXXXXXXXXX" className="mt-1 w-full rounded-2xl border border-white/70 bg-white/65 px-3 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-500 focus:border-brand-400 focus:bg-white" /></label>
          <label className="block text-xs font-semibold text-slate-600">Container GTM<input name="gtmId" defaultValue={config.gtmId} placeholder="GTM-XXXXXXX" className="mt-1 w-full rounded-2xl border border-white/70 bg-white/65 px-3 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-500 focus:border-brand-400 focus:bg-white" /></label>
          <label className="block text-xs font-semibold text-slate-600">Token Search Console<input name="gscToken" defaultValue={config.gscToken} placeholder="token di verifica Google" className="mt-1 w-full rounded-2xl border border-white/70 bg-white/65 px-3 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-500 focus:border-brand-400 focus:bg-white" /></label>
          <label className="block text-xs font-semibold text-slate-600">ID Microsoft Clarity<input name="clarityId" defaultValue={config.clarityId} placeholder="ID progetto Clarity" className="mt-1 w-full rounded-2xl border border-white/70 bg-white/65 px-3 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-500 focus:border-brand-400 focus:bg-white" /></label>
          <label className="block text-xs font-semibold text-slate-600 sm:col-span-2">Google API key <span className="font-normal text-slate-400">(PageSpeed, opzionale)</span><input name="apiKey" type="password" autoComplete="new-password" placeholder={config.apiKeyHint ? `${config.apiKeyHint} · lascia vuoto per conservare` : "AIza…"} className="mt-1 w-full rounded-2xl border border-white/70 bg-white/65 px-3 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-500 focus:border-brand-400 focus:bg-white" /></label>
        </div>
        {config.hasApiKey && <label className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-600"><input name="removeApiKey" type="checkbox" className="h-4 w-4 accent-brand-600" />Rimuovi API key salvata</label>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400">Dopo il salvataggio i tag vengono caricati solo dopo consenso cookie.</p>
          <GlassButton type="submit" disabled={saving}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            Salva configurazione
          </GlassButton>
        </div>
      </form>
    </div>
  );
}
