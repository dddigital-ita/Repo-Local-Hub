import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, ExternalLink, FlaskConical, Globe, KeyRound, ScanEye, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { getTurnstileSettings } from "@/lib/turnstile-settings";
import { getLastTurnstileTest } from "@/lib/turnstile-verify";
import { clearTurnstileAction, saveTurnstileAction, testTurnstileAction } from "./actions";
import { GlassButton, GlassCard as Card, GlassSectionHeader } from "@/components/glass";
import { SubPageHeader } from "@/components/sub-page-header";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Cloudflare · Impostazioni", robots: { index: false } };

const STEPS = [
  {
    n: 1,
    title: "Apri la dashboard Turnstile",
    text: "dash.cloudflare.com → account → menu «Turnstile» → «Add site». Un widget per dominio: il hostname deve coincidere col dominio del sito (la causa tipica se il login dovesse fallire dopo l'attivazione).",
    link: { href: "https://dash.cloudflare.com/?to=/:account/turnstile", label: "Apri Turnstile su Cloudflare" },
  },
  {
    n: 2,
    title: "Copia le due chiavi",
    text: "Dopo «Create» Cloudflare mostra Site Key e Secret Key: la Secret si vede UNA volta sola — copiala subito. Per provare in locale esistono le chiavi di TEST ufficiali (sempre valide, vedi SETUP.md).",
  },
  {
    n: 3,
    title: "Incolla qui e salva",
    text: "Servono ENTRAMBE: solo allora il captcha si accende su login team, chat e lead. La secret viene cifrata (AES-256-GCM) e non torna mai al browser: solo un indizio mascherato. La checklist completa è leggibile in app: link qui sotto.",
    link: { href: "/admin/settings/cloudflare/checklist", label: "Apri la checklist di attivazione" },
  },
  {
    n: 4,
    title: "Prova il flusso dal vivo",
    text: "Fai login, apri la chat e invia un lead: se passano, il captcha è attivo e le persone vere non se ne accorgono. La diagnostica resta su Shield (eventi, ban, reset password).",
    link: { href: "/admin/shield", label: "Apri Shield" },
  },
];

/**
 * CLOUDFLARE — la scheda del captcha invisibile (Turnstile) nell'hub
 * Impostazioni: UNA scheda = UNA pagina, come le altre. L'editor vive QUI
 * da ora (prima stava in Shield); Shield resta la diagnostica di sicurezza
 * (eventi, ban, reset) e rimanda a questa scheda.
 */
export default async function CloudflarePage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; saved?: string; test?: string }>;
}) {
  await requireAdmin();
  const { err, saved, test } = await searchParams;
  const settings = await getTurnstileSettings();
  const lastTest = await getLastTurnstileTest();
  /** La fonte attiva è quella che la verifica runtime usa davvero (getActiveSiteKey): env prima, DB dopo. */
  const envActive = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY);
  const active = Boolean(settings.siteKey);
  const badgeCls = active ? "bg-green-100/90 text-green-700" : "bg-amber-100/90 text-amber-700";

  return (
    <div className="space-y-4">
      <SubPageHeader
        backHref="/admin/settings"
        backLabel="Impostazioni"
        Icon={Globe}
        tone="text-orange-600"
        title="Cloudflare"
        subtitle={
          <>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${badgeCls}`}>
              {active ? "Attivo" : "Da configurare"}
            </span>
            {lastTest.lastTestAt && (
              <span className="inline-flex items-center gap-1 text-xs">
                {lastTest.lastTestOk === true ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#34C759]" aria-hidden />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-red-500" aria-hidden />
                )}
                ultimo test: {new Date(lastTest.lastTestAt).toLocaleString("it-IT")}
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-xs">
              <ScanEye className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              captcha invisibile Turnstile su login, chat e lead
            </span>
          </>
        }
        right={
          <a
            href="https://dash.cloudflare.com/?to=/:account/turnstile"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/60 px-4 py-1.5 text-sm font-semibold text-slate-700 ring-1 ring-white/50 transition hover:bg-white/90"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
            Dashboard Cloudflare
          </a>
        }
      />

      {err && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">{err}</p>
      )}
      {saved === "captcha" && (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ring-1 ring-emerald-100">
          Chiavi captcha salvate: il widget è attivo su login, chat e lead.
        </p>
      )}
      {saved === "cancella" && (
        <p className="rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-700 ring-1 ring-sky-100">
          Config DB rimossa: senza chiavi il captcha è spento e Shield (rate limit + ban) resta la prima difesa.
        </p>
      )}
      {test && (
        <div
          className={`rounded-2xl px-4 py-3 text-sm font-medium ring-1 ${
            test.startsWith("OK")
              ? "bg-green-50/90 text-green-800 ring-green-200/60"
              : "bg-amber-50/90 text-amber-900 ring-amber-200/60"
          }`}
        >
          {test}
          {test.startsWith("ERRORE") && " — i dettagli completi sono nel Log di audit (azione «Prova verifica Turnstile»)."}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {STEPS.map((s) => (
          <Card key={s.n}>
            <p className="font-semibold text-slate-900">
              <span className="step-dot mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-600/90 text-[11px] text-white">
                {s.n}
              </span>
              {s.title}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{s.text}</p>
            {s.link && (
              s.link.href.startsWith("/") ? (
                <Link
                  href={s.link.href}
                  className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
                >
                  {s.link.label} →
                </Link>
              ) : (
                <a
                  href={s.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
                >
                  {s.link.label} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              )
            )}
          </Card>
        ))}
      </div>

      {/* ── Editor: salvataggio/rimozione della coppia di chiavi ─────── */}
      <Card>
        <GlassSectionHeader
          icon={KeyRound}
          tone={active ? "bg-emerald-50 text-emerald-500 ring-1 ring-emerald-100" : "bg-amber-50 text-amber-500 ring-1 ring-amber-100"}
          title="Captcha invisibile (Cloudflare Turnstile)"
          subtitle="Chiavi Turnstile: site key pubblica + secret key cifrata — la coppia che accende il captcha senza rideploy."
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              active ? "bg-emerald-100/90 text-emerald-700" : "bg-amber-100/90 text-amber-700"
            }`}
          >
            {active ? "Attivo" : "Non configurato"}
          </span>
          {settings.fromDb && (
            <span className="rounded-full bg-sky-100/90 px-2.5 py-1 text-[11px] font-semibold text-sky-700">
              chiavi da Cloudflare (DB)
            </span>
          )}
          {envActive && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
              chiavi da environment (prioritaria)
            </span>
          )}
          {settings.siteKey && (
            <code className="text-[11px] text-slate-400">site: {settings.siteKey.slice(0, 8)}…</code>
          )}
          {settings.secretHint && (
            <code className="text-[11px] text-slate-400">secret: {settings.secretHint}</code>
          )}
        </div>

        <form action={saveTurnstileAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ts-site" className="text-sm font-medium text-slate-700">
              Site key (pubblica)
            </label>
            <input
              id="ts-site"
              name="siteKey"
              type="text"
              autoComplete="off"
              spellCheck={false}
              defaultValue={settings.fromDb ? settings.siteKey : ""}
              placeholder="0x4AAAAAAA…"
              className="mt-1 w-full rounded-2xl border border-white/50 bg-white/50 px-3 py-2.5 text-sm outline-none backdrop-blur-xl transition focus:border-brand-400/70 focus:bg-white/70"
            />
          </div>
          <div>
            <label htmlFor="ts-secret" className="text-sm font-medium text-slate-700">
              Secret key {settings.secretHint ? "(vuoto = conserva)" : ""}
            </label>
            <input
              id="ts-secret"
              name="secret"
              type="password"
              autoComplete="new-password"
              placeholder={settings.secretHint ? `salvata (${settings.secretHint})` : "0x4AAAAAAA…"}
              className="mt-1 w-full rounded-2xl border border-white/50 bg-white/50 px-3 py-2.5 text-sm outline-none backdrop-blur-xl transition focus:border-brand-400/70 focus:bg-white/70"
            />
          </div>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
            <GlassButton type="submit">
              <KeyRound className="h-4 w-4" aria-hidden />
              Salva chiavi captcha
            </GlassButton>
          </div>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/60 pt-3">
          <form action={testTurnstileAction}>
            <GlassButton type="submit" variant="glass" size="sm">
              <FlaskConical className="h-3.5 w-3.5" aria-hidden />
              Prova verifica
            </GlassButton>
          </form>
          {settings.hasDbConfig && (
            <form action={clearTurnstileAction}>
              <GlassButton type="submit" variant="glass" size="sm">
                <Trash2 className="h-3 w-3" aria-hidden />
                Rimuovi config DB
              </GlassButton>
            </form>
          )}
          <span className="text-xs text-slate-400">
            il test chiama davvero siteverify col token fittizio ufficiale Cloudflare: nessun visitatore coinvolto.
          </span>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Le chiavi si creano dal pannello Cloudflare → Turnstile. La secret viene cifrata
          (AES-256-GCM) e non viene mai più mostrata: solo un indizio mascherato. Se esistono anche
          le variabili d&apos;ambiente, quelle vincono (utile in CI): la pagina indica qual è la fonte
          attiva. Per provare in locale usa le chiavi di TEST ufficiali Cloudflare (vedi SETUP.md).
          Stai per attivare le chiavi reali? La CHECKLIST-CAPTCHA-PRODUZIONE è leggibile in app,
          sempre aggiornata col documento del repo:{" "}
          <Link
            href="/admin/settings/cloudflare/checklist"
            className="font-medium text-brand-700 hover:underline"
          >
            apri la checklist di attivazione →
          </Link>
        </p>
      </Card>

      {/* ── Collegamenti: dove agisce il captcha, dove si legge il log ── */}
      <Card>
        <GlassSectionHeader
          icon={ShieldCheck}
          title="Dove agisce e dove si controlla"
          subtitle="La scheda configura, Shield diagnostica: due ruoli, nessuna sovrapposizione."
        />
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl bg-white/60 px-3 py-2 ring-1 ring-white/50">
            <p className="text-sm font-semibold text-slate-800">Shield Security</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Eventi bloccati, IP bannati, tentativi di reset: qui si legge cosa ha fermato lo scudo.
            </p>
            <Link href="/admin/shield" className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
              Apri Shield →
            </Link>
          </div>
          <div className="rounded-xl bg-white/60 px-3 py-2 ring-1 ring-white/50">
            <p className="text-sm font-semibold text-slate-800">Audit</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Ogni salvataggio di chiavi finisce nel log append-only (azioni «cloudflare.*»).
            </p>
            <Link href="/admin/audit" className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
              Apri Audit →
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
