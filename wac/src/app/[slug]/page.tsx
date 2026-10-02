import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import JsonLd from "@/components/json-ld";
import SearchBar from "@/components/search-bar";
import { Phone, MessageCircle } from "lucide-react";
import { GlassBadge, GlassCard } from "@/components/glass";
import { Container } from "@/components/ui";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion";
import { LANDINGS, PROVINCE_INFO, site, contacts, absoluteUrl } from "@/lib/site";
import { effectiveLandingContent, effectiveLandingSeo, findLandingByServedSlug, getSeoConfig } from "@/lib/seo";

export async function generateStaticParams() {
  return LANDINGS.map((l) => ({ slug: l.slug }));
}

// Gli slug PERSONALIZZATI dallo strumento SEO non esistono a build time:
// arrivano a runtime (render on-demand). I 10 slug originali restano
// prerenderizzati statici; revalidatePath("/", "layout") nell'action di
// salvataggio purga la cache quando l'admin cambia meta o slug.
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const seoCfgMeta = await getSeoConfig();
  const l = findLandingByServedSlug(slug, LANDINGS, seoCfgMeta);
  if (!l) return {};
  // H1 personalizzato → anche il JSON-LD Service e il badge keyword lo seguono.
  // Override SEO dell'admin (title, description, keyword, noindex).
  const seo = await getSeoConfig();
  const e = effectiveLandingSeo(l, seo);
  return {
    title: e.title,
    description: e.description,
    keywords: e.keywords,
    alternates: { canonical: `/${e.slug}` },
    robots: e.noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      title: e.title,
      description: e.description,
      url: absoluteUrl(`/${e.slug}`),
      images: [`/og?title=${encodeURIComponent(e.keyword)}`],
    },
  };
}

export default async function LandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const seoCfg = await getSeoConfig();
  const l = findLandingByServedSlug(slug, LANDINGS, seoCfg);
  if (!l) notFound();
  const city = PROVINCE_INFO[l.city];
  // Override SEO (keyword principale mostrata nel badge).
  const eSeo = effectiveLandingSeo(l, seoCfg);
  // Contenuti editabili (intro/servizi/FAQ/proof/H1): override admin sopra i
  // testi di site.ts; senza DB la pagina resta identica a oggi.
  const content = effectiveLandingContent(l, seoCfg);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: l.breadcrumb.map((b, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: b.name,
        item: absoluteUrl(b.href),
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: `${content.h1}`,
      serviceType: l.serviceType,
      provider: { "@id": `${site.url}/#organization` },
      areaServed: { "@type": "City", name: city.name },
      url: absoluteUrl(`/${l.slug}`),
      description: content.intro[0] ?? l.description,
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: content.faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];

  return (
    <main>
      <Container className="py-12 sm:py-16">
        {/* slate-600: slate-500 su aurora chiara dava 4,18:1 (< AA) */}
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          {l.breadcrumb.map((b, i) => (
            <span key={b.href}>
              {i > 0 && <span className="mx-1.5">/</span>}
              {i === l.breadcrumb.length - 1 ? (
                <span className="text-slate-700">{b.name}</span>
              ) : (
                <Link href={b.href} className="hover:text-brand-700">
                  {b.name}
                </Link>
              )}
            </span>
          ))}
        </nav>

        <div className="mt-6 max-w-3xl">
          <GlassBadge>{eSeo.keyword}</GlassBadge>
          <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-4xl">
            {content.h1}
          </h1>
        </div>

        {/* CTA = la barra, sempre */}
        <div className="mt-8 max-w-2xl">
          <SearchBar />
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_320px]">
          <div>
            {content.intro.map((p, i) => (
              <p key={i} className="mb-5 text-[15px] leading-relaxed text-slate-700">
                {p}
              </p>
            ))}

            <h2 className="mt-10 text-xl font-bold text-slate-900">
              {l.serviceType}: cosa include
            </h2>
            <RevealGroup className="mt-4 grid gap-3 sm:grid-cols-2" stagger={0.06}>
              {content.services.map((s) => (
                <RevealItem key={s.title} className="h-full">
                  {/* h-full su card e wrapper: le due card di ogni riga hanno
                      la stessa altezza, lo slide d'ingresso non «cade» sul
                      box sotto (che ora ha anche il suo margine). */}
                  <GlassCard className="h-full">
                    <p className="font-semibold text-slate-900">{s.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-slate-600">{s.text}</p>
                  </GlassCard>
                </RevealItem>
              ))}
            </RevealGroup>

            {/* Margine proprio: senza, la griglia e il box si toccano e le
                card in reveal (slide 18px) passano sopra il box stesso. */}
            <div className="glass-solid mt-6 rounded-3xl border-brand-200/50 p-5 text-sm leading-relaxed text-brand-900">
              <strong className="font-semibold">Prova sul territorio:</strong> {content.proof}
            </div>

            {/* CTA finale landing: la barra prima, poi i contatti diretti */}
            <div className="glass-solid mt-10 rounded-3xl p-6 text-center">
              <p className="text-lg font-bold text-slate-900">Parla ora con una persona vera</p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
                Scrivi cosa ti serve nella barra e vedi subito la fascia di prezzo — oppure
                prendi il telefono: rispondiamo in orario di ufficio, WhatsApp sempre.
              </p>
              <div className="mx-auto mt-5 max-w-xl">
                {/* Seconda barra nella pagina: niente invito animato e niente
                    chip (glow, shake e suggerimenti restano alla barra in alto —
                    una sola «chiama», niente rumore duplicato). */}
                <SearchBar beckoning={false} showChips={false} />
              </div>
              <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <a
                  href={contacts.whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-[#25D366]/95 px-5 py-2.5 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition-colors hover:bg-[#20bd5a]/95"
                >
                  <MessageCircle className="h-4 w-4" aria-hidden />
                  WhatsApp: {contacts.phoneDisplay}
                </a>
                <a
                  href={contacts.telHref}
                  className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 transition hover:text-brand-700"
                >
                  <Phone className="h-4 w-4 text-brand-600" aria-hidden />
                  {contacts.phoneDisplay}
                </a>
              </div>
            </div>

            <h2 className="mt-12 text-xl font-bold text-slate-900">Domande frequenti</h2>
            <RevealGroup className="mt-4 space-y-3" stagger={0.05}>
              {content.faq.map((f) => (
                <RevealItem key={f.q}>
                <details className="glass-solid group rounded-3xl p-5">
                  <summary className="cursor-pointer list-none font-semibold text-slate-900">
                    {f.q}
                    <span className="float-right text-brand-700 transition group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-slate-600">{f.a}</p>
                </details>
                </RevealItem>
              ))}
            </RevealGroup>
          </div>

          {/* top-24 (96px): con top-8 l'aside sticky finiva SOTTO l'header
              sticky (64px) e le card sembravano sovrapporsi al vetro. */}
          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            {/* Il gap vive sul wrapper Reveal: con le due card dentro un solo
                elemento lo space-y dell'aside non le separa e si toccano. */}
            <Reveal delay={0.1} className="space-y-4">
            <GlassCard>
              <p className="font-semibold text-slate-900">Chi risponde</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{city.blurb}</p>
              <p className="mt-3 text-sm">
                <a href={contacts.telHref} className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline">
                  <Phone className="h-4 w-4" aria-hidden />
                  {contacts.phoneDisplay}
                </a>
              </p>
              <p className="mt-2 text-sm">
                <a
                  href={contacts.whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline"
                >
                  <MessageCircle className="h-4 w-4" aria-hidden />
                  WhatsApp diretto
                </a>
              </p>
            </GlassCard>
            <GlassCard>
              <p className="text-sm font-semibold text-slate-900">Altre pagine utili</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {LANDINGS.filter((x) => x.slug !== l.slug)
                  .slice(0, 5)
                  .map((x) => (
                    <li key={x.slug}>
                      <Link href={`/${x.slug}`} className="text-slate-600 hover:text-brand-700">
                        {x.serviceType} · {PROVINCE_INFO[x.city].name}
                      </Link>
                    </li>
                  ))}
              </ul>
            </GlassCard>
            </Reveal>
          </aside>
        </div>
      </Container>
      {jsonLd.map((d, i) => (
        <JsonLd key={i} data={d} />
      ))}
    </main>
  );
}
