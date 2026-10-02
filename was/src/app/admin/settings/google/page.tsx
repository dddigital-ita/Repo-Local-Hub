import type { Metadata } from "next";
import Link from "next/link";
import {
  BarChart3,
  Building2,
  ExternalLink,
  SearchCheck,
  Star,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { GlassCard as Card, GlassSectionHeader } from "@/components/glass";
import { SubPageHeader } from "@/components/sub-page-header";
import { requireAdmin } from "@/lib/admin";
import { getGoogleToolsConfig } from "@/lib/google-tools";
import { googleKitStatus } from "@/lib/tools-status";
import GoogleToolsPanel from "@/components/google-tools-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Google growth kit · Impostazioni", robots: { index: false } };

/**
 * Le quattro skill Google: superficie grafica di ingresso con
 * collegamenti e la forma dei report. L'esecuzione è via agente
 * (terminale): da qui non parte alcuno script, ma ogni dominio
 * ha i suoi link ai servizi e l'elenco dei report che produce.
 */
const SKILLS: {
  slug: string;
  Icon: LucideIcon;
  tone: string;
  title: string;
  text: string;
  reports: string[];
  links: { href: string; label: string }[];
}[] = [
  {
    slug: "google-reviews",
    Icon: Star,
    tone: "bg-amber-50 text-amber-600",
    title: "Recensioni Google",
    text: "Rating e recensioni dell'attività su Google Maps via DataForSEO.",
    reports: [
      "Rating e numero di recensioni",
      "Distribuzione 1–5 stelle",
      "Scheda attività: indirizzo e categoria",
    ],
    links: [{ href: "https://business.google.com", label: "Business Profile" }],
  },
  {
    slug: "google-analytics",
    Icon: TrendingUp,
    tone: "bg-orange-50 text-orange-600",
    title: "Analytics 4",
    text: "Traffico, acquisizione, pagine più visitate, engagement e conversioni dall'Analytics Data API.",
    reports: [
      "Panoramica: sessions, users, page views",
      "Canali di acquisizione e campagne",
      "Pagine top e conversioni per canale",
      "Confronto tra periodi",
    ],
    links: [{ href: "https://analytics.google.com", label: "Analytics" }],
  },
  {
    slug: "google-workspace-cli",
    Icon: Building2,
    tone: "bg-blue-50 text-blue-600",
    title: "Google Workspace",
    text: "Audit di sicurezza del Workspace e guida all'autenticazione per le API.",
    reports: [
      "Audit: 2FA, password, sharing, app, ruoli admin",
      "Guida setup: OAuth, service account, delegation",
      "Diagnostica DNS: MX, SPF, DKIM, DMARC",
    ],
    links: [{ href: "https://admin.google.com", label: "Admin Console" }],
  },
  {
    slug: "seo-google",
    Icon: SearchCheck,
    tone: "bg-indigo-50 text-indigo-600",
    title: "SEO Google",
    text: "Search Console, PageSpeed Insights, CrUX a 25 settimane, Indexing API e organico GA4.",
    reports: [
      "Core Web Vitals: lab + dati campo Chrome",
      "Search Console: click, impression, CTR, posizione",
      "Indicizzazione URL e stato delle sitemap",
      "Report: cwv-audit, gsc-performance, indexation",
    ],
    links: [
      { href: "https://search.google.com/search-console", label: "Search Console" },
      { href: "https://pagespeed.web.dev", label: "PageSpeed" },
    ],
  },
];

export default async function GoogleSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google_test?: string; gsc_test?: string }>;
}) {
  await requireAdmin();
  const { google_test, gsc_test } = await searchParams;
  const google = await getGoogleToolsConfig();
  const kit = googleKitStatus(google.hasGscCreds, [google.ga4Id, google.gtmId].filter(Boolean).length);

  return (
    <div className="space-y-6">
      <SubPageHeader
        backHref="/admin/settings"
        backLabel="Impostazioni"
        Icon={BarChart3}
        title="Google growth kit"
        subtitle={
          <>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                kit.ok ? "bg-green-100/90 text-green-700" : "bg-amber-100/90 text-amber-700"
              }`}
            >
              {kit.label}
            </span>
            Le quattro skill Google in un unico posto: recensioni, analytics, Workspace e SEO,
            con la configurazione dei tag e i test reali.
          </>
        }
      />

      {google_test && (
        <div
          className={`rounded-2xl px-3.5 py-3 text-sm font-medium ring-1 ${
            google_test.startsWith("PageSpeed mobile:")
              ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
              : "bg-amber-50 text-amber-800 ring-amber-200"
          }`}
        >
          {google_test}
        </div>
      )}
      {gsc_test && (
        <div
          className={`rounded-2xl px-3.5 py-3 text-sm font-medium ring-1 ${
            gsc_test.startsWith("Credenziali") || gsc_test.startsWith("OK")
              ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
              : "bg-amber-50 text-amber-800 ring-amber-200"
          }`}
        >
          {gsc_test}
        </div>
      )}

      {/* ── Skill Google: report e collegamenti grafici ─────── */}
      <Card>
        <GlassSectionHeader
          icon={BarChart3}
          title="Skill Google — report e collegamenti"
          subtitle="Quattro domini, quattro set di report. L'esecuzione è via agente: qui trovi i servizi e la forma dei report."
        />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {SKILLS.map(({ slug, Icon, tone, title, text, reports, links }) => (
            <div
              key={slug}
              className="group flex flex-col rounded-3xl border border-white/60 bg-white/55 p-4 shadow-[0_12px_35px_-24px_rgb(15_23_42/.5)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white/70"
            >
              <div className="flex items-start justify-between gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${tone} shadow-sm`}>
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <code className="rounded-full bg-white/70 px-2.5 py-1 font-mono text-[10px] font-semibold text-slate-500 ring-1 ring-white/60">
                  {slug}
                </code>
              </div>
              <h3 className="mt-3 font-semibold text-slate-900">{title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{text}</p>
              <ul className="mt-3 space-y-1.5">
                {reports.map((report) => (
                  <li key={report} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-600">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-400" aria-hidden />
                    {report}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/60 pt-3">
                {links.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Apri ${link.label}`}
                    className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-white/60 transition hover:bg-white hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                  >
                    {link.label}
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Configurazione: tag, API key, credenziali Search Console ── */}
      <Card>
        <GoogleToolsPanel config={google} testMessage={google_test} />
      </Card>

      <p className="text-xs text-slate-400">
        Sezione «Integrazioni» dell&apos;hub Impostazioni: lo stato della scheda («Collegato» con le
        credenziali Search Console API) si legge anche dalla Panoramica.{" "}
        <Link href="/admin/seo" className="text-brand-700 underline">
          Le query reali di Search Console
        </Link>{" "}
        compaiono nel pannello SEO una volta collegata l&apos;API.
      </p>
    </div>
  );
}
