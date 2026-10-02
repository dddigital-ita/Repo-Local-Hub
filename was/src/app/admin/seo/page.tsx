import type { Metadata } from "next";
import Link from "next/link";
import { FileSearch, ListChecks, Map as MapIcon, Route, ScrollText } from "lucide-react";
import { GlassCard as Card, GlassNotice, GlassSectionHeader, GlassStatus } from "@/components/glass";
import { requireAdmin } from "@/lib/admin";
import { site } from "@/lib/site";
import { dbConfigured } from "@/lib/db";
import { effectiveLandingSeo, getSeoConfig, DEFAULT_SEO_CONFIG } from "@/lib/seo";
import { listSeoBackups } from "@/lib/seo-backups";
import { LANDINGS } from "@/lib/site";
import SeoGlobalPanel from "@/components/seo-global-panel";
import SeoLandingEditor, { type LandingSeoView } from "@/components/seo-landing-editor";
import SeoRedirects from "@/components/seo-redirects";
import SeoGscPanel from "@/components/seo-gsc-panel";
import SeoBackupPanel from "@/components/seo-backup-panel";
import { seoAuditAction, measureSeoAlerts } from "../actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "SEO", robots: { index: false } };

export default async function SeoPage({
  searchParams,
}: {
  searchParams: Promise<{ seo_error?: string; seo_audit?: string }>;
}) {
  await requireAdmin();
  const { seo_error, seo_audit } = await searchParams;
  // Avvisi GSC in attesa maturi per giorni: misura qui (best effort, prima
  // di leggere la config) così il banner sotto è sempre aggiornato.
  await measureSeoAlerts();
  const config = await getSeoConfig();
  const dbOk = dbConfigured();

  const landingsView: LandingSeoView[] = LANDINGS.map((l) => {
    const e = effectiveLandingSeo(l, config);
    return {
      slug: l.slug,
      h1: l.h1,
      title: e.title,
      description: e.description,
      keyword: e.keyword,
      keywords: e.keywords,
      slugOverride: config.landings[l.slug]?.slugOverride ?? "",
      noindex: e.noindex,
      customized: Boolean(config.landings[l.slug]),
      metaHistory: config.metaHistory?.[l.slug] ?? [],
      alert: config.pageAlerts?.[l.slug] ?? null,
    };
  });

  // Vista contenuti per l'editor: base = testi di codice, override = DB.
  const contentsView = LANDINGS.map((l) => ({
    slug: l.slug,
    base: { h1: l.h1, intro: l.intro, services: l.services, faq: l.faq, proof: l.proof },
    override: config.contents[l.slug] ?? null,
    history: config.contentHistory?.[l.slug] ?? [],
  }));

  const customizedCount = landingsView.filter((l) => l.customized).length;
  const noindexCount = landingsView.filter((l) => l.noindex).length;
  const redirects = config.redirects;

  // Avvisi attivi (misurati): appaiono nel banner in cima con ancora alla card.
  const activeAlerts = Object.entries(config.pageAlerts).filter(([, a]) => Boolean(a.measuredAt));

  // Snapshot automatici del cron (solo metadati: la config sta nel DB).
  const autoBackups = (await listSeoBackups()).map((b) => ({ takenAt: b.takenAt, takenBy: b.takenBy }));

  // Tutte le keyword del sito (globali + principali + secondarie) per il
  // confronto con le query reali di Search Console.
  const siteKeywords = config.siteKeywords
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const allKeywords = Array.from(
    new Set([
      ...siteKeywords,
      ...landingsView.flatMap((l) => [l.keyword, ...l.keywords].filter(Boolean)),
    ]),
  );

  return (
    <div className="space-y-6">
      {/* ── Header di pagina (pattern Panoramica/Tools) ─────────── */}
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold text-slate-900">
          <FileSearch className="h-6 w-6 text-brand-600" aria-hidden />
          SEO
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Tutto quello che Google legge del sito: meta, parole chiave, indirizzi e redirect — in un unico posto.
        </p>
      </div>

      {!dbOk && (
        <GlassNotice tone="warning">
          DATABASE_URL non configurata: le modifiche SEO non vengono salvate (restano i default di codice). Vedi SETUP.md → Neon.
        </GlassNotice>
      )}
      {seo_error && <GlassNotice tone="warning">{seo_error}</GlassNotice>}
      {seo_audit && (
        <GlassNotice tone={seo_audit.startsWith("OK") ? "success" : "warning"}>{seo_audit}</GlassNotice>
      )}

      {/* ── Avvisi calo posizioni (Search Console) ──────────────── */}
      {activeAlerts.length > 0 && (
        <GlassNotice tone="warning">
          <span className="font-semibold">Calo posizioni dopo un ripristino:</span>{" "}
          {activeAlerts.map(([slug, a], i) => (
            <span key={slug} className="whitespace-nowrap">
              {i > 0 && " · "}
              <Link href={`/admin/seo#landing-${slug}`} className="font-semibold underline">
                /{slug}
              </Link>{" "}
              {a.positionBefore.toFixed(1)} → {a.positionAfter.toFixed(1)}
            </span>
          ))}
          {" "}— apri la card della pagina per verificare, ripristinare un&apos;altra versione o scartare l&apos;avviso.
        </GlassNotice>
      )}

      {/* ── Sintesi ─────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Landing indicizzate", value: LANDINGS.length - noindexCount, sub: `${LANDINGS.length} pagine totali` },
          { label: "Personalizzate", value: customizedCount, sub: "override attivi" },
          { label: "Keyword pagine", value: landingsView.reduce((a, l) => a + l.keywords.length, 0), sub: "secondarie mappate" },
          { label: "Redirect 301", value: redirects.length, sub: redirects.length === 1 ? "regola attiva" : "regole attive" },
        ].map((k) => (
          <Card key={k.label} hover>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{k.label}</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{k.value}</p>
            <p className="mt-1 text-xs text-slate-500">{k.sub}</p>
          </Card>
        ))}
      </div>

      {/* ── Meta globali ────────────────────────────────────────── */}
      <Card>
        <SeoGlobalPanel
          homeTitle={config.homeTitle}
          homeDescription={config.homeDescription}
          siteKeywords={config.siteKeywords}
          ogSiteName={config.ogSiteName}
          siteUrl={site.url}
        />
      </Card>

      {/* ── Audit + sitemap + robots ────────────────────────────── */}
      <Card>
        <GlassSectionHeader
          icon={ListChecks}
          title="Audit meta e indicizzazione"
          subtitle="Controlli rapidi prima di ogni rilascio: lunghezze, sitemap e robots."
          right={
            <form action={seoAuditAction}>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-600/90 px-5 py-2.5 text-sm font-semibold text-white shadow-glass-btn transition hover:bg-brand-500/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
              >
                <FileSearch className="h-4 w-4" aria-hidden />
                Esegui audit meta
              </button>
            </form>
          }
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-white/55 p-3 ring-1 ring-white/60">
            <p className="flex items-center justify-between text-xs font-semibold text-slate-800">
              Sitemap
              <GlassStatus ok label="automatica" />
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              <Link href="/sitemap.xml" target="_blank" className="text-brand-700 underline">
                {site.url}/sitemap.xml
              </Link>{" "}
              include home, landing non noindex e pagine legali.
            </p>
          </div>
          <div className="rounded-2xl bg-white/55 p-3 ring-1 ring-white/60">
            <p className="flex items-center justify-between text-xs font-semibold text-slate-800">
              Robots.txt
              <GlassStatus ok label="configurato" />
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              <Link href="/robots.txt" target="_blank" className="text-brand-700 underline">
                {site.url}/robots.txt
              </Link>{" "}
              — admin e API esclusi dall&apos;indicizzazione.
            </p>
          </div>
          <div className="rounded-2xl bg-white/55 p-3 ring-1 ring-white/60">
            <p className="flex items-center justify-between text-xs font-semibold text-slate-800">
              Search Console
              <GlassStatus ok label="scheda Google" />
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Le query reali sono nel pannello qui sotto; il collegamento API si gestisce in{" "}
              <Link href="/admin/settings/google" className="text-brand-700 underline">
                Google growth kit
              </Link>
              .
            </p>
          </div>
        </div>
      </Card>

      {/* ── Redirect 301 ────────────────────────────────────────── */}
      <Card>
        <SeoRedirects redirects={redirects} />
      </Card>

      {/* ── Backup config (export/import JSON) ──────────── */}
      <Card>
        <SeoBackupPanel backups={autoBackups} />
      </Card>

      {/* ── Query reali (Search Console) ────────────────────────── */}
      <Card>
        <SeoGscPanel keywords={allKeywords} />
      </Card>

      {/* ── Landing: meta, keyword, slug ───────────────────────── */}
      <div>
        <GlassSectionHeader
          icon={MapIcon}
          title="Pagine e parole chiave"
          subtitle="Meta, keyword e indirizzo di ogni landing: l'anteprima mostra come appariranno su Google. Le modifiche diventano live subito dopo il salvataggio."
        />
        <div className="mt-3 grid gap-4 xl:grid-cols-2">
          {landingsView.map((l) => (
            <div key={l.slug} id={`landing-${l.slug}`} className="scroll-mt-24">
            <SeoLandingEditor
              landing={l}
              siteUrl={site.url}
              others={landingsView.filter((o) => o.slug !== l.slug).map((o) => ({ slug: o.slug, keyword: o.keyword, keywords: o.keywords }))}
              content={contentsView.find((c) => c.slug === l.slug)!}
            />
            </div>
          ))}
        </div>
      </div>

      {/* ── Note tecniche ───────────────────────────────────────── */}
      <Card>
        <GlassSectionHeader
          icon={ScrollText}
          title="Come funziona sotto il cofano"
          subtitle="Per sapere cosa aspettarsi quando salvi (e cosa no)."
        />
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-600">
          <li className="flex gap-2.5">
            <Route className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            <span>
              <strong className="text-slate-800">Slug personalizzato:</strong> la pagina risponde subito al nuovo
              indirizzo e il vecchio fa un 301 verso il nuovo (niente errore 404, niente posizionamento perso).
            </span>
          </li>
          <li className="flex gap-2.5">
            <Route className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            <span>
              <strong className="text-slate-800">Noindex:</strong> la pagina esce dalla sitemap al salvataggio e riceve
              il meta noindex; Google la rimuove entro qualche giorno dalla sua cache.
            </span>
          </li>            <li className="flex gap-2.5">
              <Route className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              <span>
                <strong className="text-slate-800">Contenuti di pagina:</strong> i testi di ogni pagina si modificano
                nell&apos;editor «Contenuti pagina» (fallback ai testi di codice); l&apos;H1 e le FAQ effettivi sono
                verificati lì contro la keyword, con badge di stato anche da pannello chiuso.
              </span>
            </li>
          <li className="flex gap-2.5">
            <Route className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            <span>
              <strong className="text-slate-800">Audit log:</strong> ogni salvataggio finisce in{" "}
              <Link href="/admin/audit" className="text-brand-700 underline">
                Audit
              </Link>{" "}
              con autore, pagina e dettaglio.
            </span>
          </li>
        </ul>
        <p className="mt-3 text-xs text-slate-400">
          I default (quando una pagina non è personalizzata) arrivano dal codice: title home «{DEFAULT_SEO_CONFIG.homeTitle}».
        </p>
      </Card>
    </div>
  );
}
