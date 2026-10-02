import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  Search,
  MessagesSquare,
  PhoneCall,
  Globe,
  TrendingUp,
  ShoppingCart,
  Wrench,
  Check,
  MapPin,
  ChevronRight,
  MessageCircle,
  Phone,
  Users,
  MousePointerClick,
} from "lucide-react";
import JsonLd from "@/components/json-ld";
import SearchBar from "@/components/search-bar";
import HeroAbGate from "@/components/hero-ab-gate";
import { GlassBadge, GlassCard } from "@/components/glass";
import { Container, LinkButton } from "@/components/ui";
import { LANDINGS, PROVINCE_INFO, site, contacts } from "@/lib/site";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion";
import { teamCards } from "@/lib/operators";
import { listPackages } from "@/lib/packages";
import { getHeroConfig } from "@/lib/hero";

// I pacchetti attivi sono editabili da /admin/packages: la home si rigenera da sola (ISR 5 min).
export const revalidate = 300;

export const metadata: Metadata = {
  title: `${site.name} — Web agency nel Salento`,
  description:
    "Web agency nel Salento: siti in 7 giorni, e-commerce e SEO locale. Scrivi cosa cerchi, il team risponde in chat e ti richiama in giornata.",
  alternates: { canonical: "/" },
};

const STEPS = [
  {
    n: "1",
    title: "Cerca",
    text: "Scrivi nella barra ciò che ti serve: «sito per il ristorante», «e-commerce», «SEO»…",
    Icon: Search,
  },
  {
    n: "2",
    title: "Chatta",
    text: "Si apre una chat col team: 4 domande da 10 secondi e hai la fascia di prezzo.",
    Icon: MessagesSquare,
  },
  {
    n: "3",
    title: "Ti richiamiamo",
    text: "Una persona vera ti risponde in chat o ti richiama: chiamaci, scrivici su WhatsApp o lascia il numero.",
    Icon: PhoneCall,
  },
];

const FLIPBOXES = [
  {
    title: "Parli con persone vere",
    Icon: Users,
    front: "Due persone con nome, cognome e turno — non un call center.",
    back: "A chat e telefono risponde chi costruirà il tuo sito, con nome e cognome. Le riunioni si fanno anche davanti a un caffè in centro a Lecce — o direttamente da voi.",
  },
  {
    title: "Risposte in pochi minuti",
    Icon: MousePointerClick,
    front: "Prezzo indicativo subito in chat, dopo 4 domande da 10 secondi.",
    back: "Media di risposta in orario di ufficio: 4 minuti. Il preventivo scritto arriva entro 24 ore, con cosa è incluso e la data di consegna — e vale 30 giorni.",
  },
  {
    title: "Dovunque tu sia, WhatsApp",
    Icon: MessageCircle,
    front: "Scrivi quando vuoi: la chat risponde anche fuori orario.",
    back: "Il numero del sito è WhatsApp: ti arriva una risposta in giornata, e se è urgente fissiamo una chiamata al primo turno utile. Niente form che sparisce nel nulla.",
  },
];

const SERVICE_ICONS: Record<string, typeof Globe> = {
  "Agenzia web": Globe,
  "Creazione siti web": Globe,
  "E-commerce": ShoppingCart,
  SEO: TrendingUp,
  "Posizionamento Google": TrendingUp,
  "Restyling sito web": Wrench,
  "Consulenza digitale": MessagesSquare,
  "Preventivo sito web": Search,
};

export default async function HomePage() {
  const packages = (await listPackages(true, "package")).slice(0, 4); // primi 4 per ordine
  const services = (await listPackages(true, "service")).slice(0, 4); // catalogo servizi (migration 035)
  const team = teamCards();
  // Hero animato (tools → hero): default SPENTO — la home resta com'è.
  // Con il test A/B attivo la decisione è del bucket (50/50 stabile per
  // coorte, cookie first-party): metà statico, metà animato, e ogni
  // search_start porta la dimensione hero_variant per il confronto GA4.
  const heroRaw = await getHeroConfig();
  const hero = { ...heroRaw };
  return (
    <main>
      {/* Il cancellò A/B decide nel browser (cookie first-party
          wac_ab): senza headers() di richiesta la home resta ISR —
          prerenderizzata e servita dalla cache CDN, non renderizzata
          per ogni visitatore. L'hero statico qui dentro è il markup
          server del gate (coorte vuota, zero bundle aggiuntivo); la
          variante A/B per search_start → GA4 arriva dal contesto
          HeroVariantContext. */}
      <HeroAbGate config={hero}>
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(60%_60%_at_50%_0%,rgba(61,114,236,0.12),transparent)]"
        />
        <Container className="relative flex flex-col items-center pb-20 pt-16 text-center sm:pt-24">
          <RevealGroup stagger={0.09} amount={0}>
            <RevealItem>
              <GlassBadge>
                <MapPin className="h-3.5 w-3.5 text-brand-600" aria-hidden />
                Web agency con base nel Salento
              </GlassBadge>
            </RevealItem>
            <RevealItem>
              <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-5xl">
                Cerchi una web agency nel Salento?
                <span className="block text-brand-600">Scrivilo nella barra, ti rispondiamo davvero.</span>
              </h1>
            </RevealItem>
            <RevealItem>
              <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-600">
                Siti web in 7 giorni, e-commerce e SEO locale. Niente form da compilare: cerca, chatta
                in 4 domande e una persona vera ti richiama.
              </p>
            </RevealItem>
            <RevealItem>
              <div className="mt-10 w-full max-w-3xl">
                <SearchBar autoFocus />
              </div>
            </RevealItem>
            <RevealItem>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                <a
                  href={contacts.whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/60 px-4 py-2 text-sm font-medium text-slate-700 backdrop-blur-xl transition hover:bg-white/85 hover:text-brand-700"
                >
                  <MessageCircle className="h-4 w-4 text-[#25D366]" aria-hidden />
                  Scrivici su WhatsApp
                </a>
                <a
                  href={contacts.telHref}
                  className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 transition hover:text-brand-700"
                >
                  <Phone className="h-4 w-4 text-brand-600" aria-hidden />
                  {contacts.phoneDisplay}
                </a>
              </div>
            </RevealItem>
            <RevealItem>
              {/* slate-600, non 500: su aurora chiara il 500 dava 4,18:1
                  (< AA) — il 600 sale sopra 5:1. */}
              <p className="mt-4 text-xs text-slate-600">
                Turni: {team.map((t) => `${t.name} (${t.availability})`).join(" · ")}
              </p>
            </RevealItem>
          </RevealGroup>
        </Container>
      </section>
      </HeroAbGate>

      {/* Come funziona */}
      <section className="py-16 sm:py-20">
        <Container>
          <Reveal>
            <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900">
              Come funziona
            </h2>
          </Reveal>
          <RevealGroup className="mt-10 grid gap-5 md:grid-cols-3">
            {STEPS.map((s) => (
              <RevealItem key={s.n} className="h-full">
              <GlassCard hover className="flex h-full flex-col items-center justify-center text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600/90 text-white shadow-glass-btn backdrop-blur-xl">
                  <s.Icon className="h-6 w-6" aria-hidden />
                </div>
                <p className="mt-4 text-sm font-bold uppercase tracking-wide text-brand-600">
                  {s.n}. {s.title}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.text}</p>
              </GlassCard>
              </RevealItem>
            ))}
          </RevealGroup>
        </Container>
      </section>

      {/* Perché scelgono noi: flipbox — davanti la promessa, dietro la prova */}
      <section className="py-16 sm:py-20">
        <Container>
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900">
            Perché i clienti ci chiamano
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-slate-600">
            Passa il mouse (o tocca) le schede: dietro ogni promessa c&apos;è come funziona davvero.
          </p>
          <RevealGroup className="mt-10 grid gap-5 md:grid-cols-3">
            {FLIPBOXES.map((f) => (
              <RevealItem key={f.title}>
                <div className="flipbox h-56 cursor-pointer outline-none" tabIndex={0} aria-label={`${f.title} — attiva per i dettagli`}>
                  <div className="flipbox-inner h-full w-full">
                    {/* Fronte: la promessa (translateZ separa i piani: senza,
                        front e back sono coplanari e il retro «rispunta» sopra) */}
                    <div className="flipbox-face flipbox-face-front glass-solid flex h-full w-full flex-col items-center justify-center rounded-3xl p-6 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600/90 text-white shadow-glass-btn backdrop-blur-xl">
                        <f.Icon className="h-6 w-6" aria-hidden />
                      </div>
                      <p className="mt-4 font-semibold text-slate-900">{f.title}</p>
                      <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.front}</p>
                    </div>
                    {/* Retro: la prova — fondo OPACO: con bianco/85 il fronte
                        traspariva specchiato durante la rotazione */}
                    <div className="flipbox-face flipbox-face-back flex h-full w-full flex-col items-center justify-center rounded-3xl border border-brand-200/60 bg-white p-6 text-center shadow-glass">
                      <p className="text-sm font-semibold text-brand-700">{f.title}</p>
                      <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.back}</p>
                    </div>
                  </div>
                </div>
              </RevealItem>
            ))}
          </RevealGroup>
        </Container>
      </section>

      {/* Servizi = landing programmatiche */}
      <section className="py-16 sm:py-20">
        <Container>
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900">
            Cosa facciamo nel Salento
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-slate-600">
            Ogni servizio ha la sua pagina con prezzi, tempi e FAQ: niente brogliadiri.
          </p>
          <RevealGroup className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" stagger={0.05}>
            {LANDINGS.map((l) => {
              const Icon = SERVICE_ICONS[l.serviceType] ?? Globe;
              return (
                <RevealItem key={l.slug}>
                <Link
                  href={`/${l.slug}`}
                  className="glass-solid group block rounded-3xl p-5 transition duration-300 hover:-translate-y-0.5 hover:shadow-glass-hover"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600/90 text-white shadow-glass-btn backdrop-blur-xl">
                      <Icon className="h-5 w-5" aria-hidden />
                    </div>
                    <p className="font-semibold text-slate-900">
                      {l.serviceType}
                      <span className="ml-1 text-slate-500">
                        · {PROVINCE_INFO[l.city]?.name ?? "Salento"}
                      </span>
                    </p>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-600">
                    {l.description}
                  </p>
                  <p className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-600">
                    Vai alla pagina
                    <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
                  </p>
                </Link>
                </RevealItem>
              );
            })}
          </RevealGroup>
          <div className="mt-8 text-center">
            <LinkButton href="/consulenza?q=consulenza%20siti%20web" size="lg">
              Parla col team in chat
            </LinkButton>
          </div>
        </Container>
      </section>

      {/* Servizi = le attività professionali che l'agenzia esegue (o fa eseguire):
          stesso archivio dei pacchetti, altro catalogo (kind='service'). */}
      {services.length > 0 && (
        <section className="py-16 sm:py-20">
          <Container>
            <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900">
              Servizi che vanno oltre il sito
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-center text-slate-600">
              Foto, video, assistenza: le attività professionali che il tuo progetto ha bisogno —
              le stesse che Ambrosio propone in chat.
            </p>
            <RevealGroup className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" stagger={0.05}>
              {services.map((p) => (
                <RevealItem key={p.id}>
                  <div className="glass-solid flex h-full flex-col rounded-3xl p-5 transition duration-300 hover:-translate-y-0.5 hover:shadow-glass-hover">
                    <p className="font-semibold text-slate-900">{p.name}</p>
                    <p className="mt-1 text-lg font-bold text-brand-600">{p.price_text}</p>
                    {p.tagline && (
                      <p className="mt-2 text-sm leading-relaxed text-slate-600">{p.tagline}</p>
                    )}
                    {!!p.includes?.length && (
                      <ul className="mt-3 space-y-1.5">
                        {p.includes.slice(0, 4).map((inc, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
                            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#34C759]" aria-hidden />
                            {inc}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-auto pt-4">
                      <LinkButton
                        href={`/consulenza?q=${encodeURIComponent(`servizio ${p.name}`)}`}
                        variant="ghost"
                        className="w-full justify-center"
                      >
                        Chiedi in chat
                      </LinkButton>
                    </div>
                  </div>
                </RevealItem>
              ))}
            </RevealGroup>
          </Container>
        </section>
      )}

      {/* Pacchetti = i prezzi chiari, gli stessi che propone Ambrosio in chat */}
      {packages.length > 0 && (
        <section className="py-16 sm:py-20">
          <Container>
            <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900">
              Pacchetti chiari, prezzi dettati subito
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-center text-slate-600">
              Le stesse proposte che ricevi in chat: cifre oneste, cosa include scritto prima.
            </p>
            <RevealGroup className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" stagger={0.05}>
              {packages.map((p) => (
                <RevealItem key={p.id}>
                  <div className="glass-solid flex h-full flex-col rounded-3xl p-5 transition duration-300 hover:-translate-y-0.5 hover:shadow-glass-hover">
                    <p className="font-semibold text-slate-900">{p.name}</p>
                    <p className="mt-1 text-lg font-bold text-brand-600">{p.price_text}</p>
                    {p.tagline && (
                      <p className="mt-2 text-sm leading-relaxed text-slate-600">{p.tagline}</p>
                    )}
                    {!!p.includes?.length && (
                      <ul className="mt-3 space-y-1.5">
                        {p.includes.slice(0, 4).map((inc, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
                            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#34C759]" aria-hidden />
                            {inc}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-auto pt-4">
                      <LinkButton
                        href={`/consulenza?q=${encodeURIComponent(`preventivo ${p.name}`)}`}
                        variant="ghost"
                        className="w-full justify-center"
                      >
                        Chiedi in chat
                      </LinkButton>
                    </div>
                  </div>
                </RevealItem>
              ))}
            </RevealGroup>
          </Container>
        </section>
      )}

      {/* Team */}
      <section className="py-16 sm:py-20">
        <Container>
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900">
            Due persone vere, due turni
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-slate-600">
            In chat non trovi un bot che finge: trovi i turni del team. Le foto si aggiungono in
            public/team/ — qui l&apos;avatar provvisorio.
          </p>
          <RevealGroup className="mx-auto mt-10 grid max-w-2xl gap-5 sm:grid-cols-2">
            {team.map((t) => (
              <RevealItem key={t.id}>
              <GlassCard className="flex items-center gap-4">
                {t.photo ? (
                  <Image
                    src={t.photo}
                    alt={t.name}
                    width={56}
                    height={56}
                    className="h-14 w-14 rounded-full object-cover"
                  />
                ) : (
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-600/90 text-xl font-bold text-white shadow-glass-btn backdrop-blur-xl"
                    aria-hidden
                  >
                    {t.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="font-semibold text-slate-900">{t.name}</p>
                  <p className="text-sm text-slate-500">{t.role}</p>
                  <p className="mt-1 text-xs font-medium text-brand-600">{t.availability}</p>
                </div>
              </GlassCard>
              </RevealItem>
            ))}
          </RevealGroup>
        </Container>
      </section>

      {/* FAQ home (JSON-LD FAQPage) */}
      <section className="py-16 sm:py-20">
        <Container className="max-w-3xl">
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900">
            Domande frequenti
          </h2>
          <RevealGroup className="mt-8 space-y-3" stagger={0.06}>
            {HOME_FAQ.map((f) => (
              <RevealItem key={f.q}>
              <details className="glass-solid group rounded-3xl p-5">
                <summary className="cursor-pointer list-none font-semibold text-slate-900 marker:hidden">
                  {f.q}
                  <span className="float-right text-brand-700 transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{f.a}</p>
              </details>
              </RevealItem>
            ))}
          </RevealGroup>
        </Container>
      </section>

      {/* CTA finale */}
      <section className="py-20 text-center">
        <Container>
          <Reveal>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">
            Prova la barra: scrivi «sito web in 7 giorni»
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-600">
            È la stessa cosa che faresti su Google — solo che qui in fondo c&apos;è gente che ti
            richiama davvero.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <LinkButton href="/consulenza?q=sito%20web%20in%207%20giorni" size="lg">
              Apri la chat col team
            </LinkButton>
            <a
              href={contacts.whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-[#25D366]/95 px-6 py-3 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition-colors hover:bg-[#20bd5a]/95"
            >
              <MessageCircle className="h-5 w-5" aria-hidden />
              Scrivici su WhatsApp
            </a>
            <a
              href={contacts.telHref}
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 transition hover:text-brand-700"
            >
              <Phone className="h-4 w-4 text-brand-600" aria-hidden />
              {contacts.phoneDisplay}
            </a>
          </div>
          </Reveal>
        </Container>
      </section>

      <JsonLd data={faqJsonLd} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: site.name,
          url: site.url,
          potentialAction: {
            "@type": "SearchAction",
            target: `${site.url}/consulenza?q={search_term_string}`,
            "query-input": "required name=search_term_string",
          },
        }}
      />
    </main>
  );
}

const HOME_FAQ = [
  {
    q: "Cosa succede dopo che cerco qualcosa nella barra?",
    a: "Si apre una chat: 4 domande veloci (servizio, tempi, sito esistente, budget) e il tuo numero. Se c'è qualcuno in turno, vi sentite al telefono in pochi minuti.",
  },
  {
    q: "Chi risponde in chat?",
    a: "Il team vero: due persone con turni alternati. Quando nessuno è in turno, la chat ti propone i prossimi slot per farti richiamare.",
  },
  {
    q: "Quanto costano i siti?",
    a: "Sito vetrina da 1.000 €, e-commerce da 3.000 €: la fascia te la dice la chat in base a 4 risposte, senza aspettare il preventivo.",
  },
  {
    q: "Con quali zone lavorate?",
    a: "Siamo con base a Lecce e seguiamo tutto il Salento: Gallipoli, Otranto, Nardò, Maglie, Copertino e il brindisino. Per i progetti locali la prima riunione si fa di persona.",
  },
  {
    q: "Posso parlarvi subito al telefono o su WhatsApp?",
    a: "Sì: il numero del sito è anche WhatsApp — scrivi o chiama, risponde Daniele o chi è di turno. Fuori orario la chat prende il messaggio e ti richiamiamo al turno successivo.",
  },
  {
    q: "Cosa succede se non sono del Salento?",
    a: "Seguiamo clienti anche fuori provincia: riunioni in video e supporto al telefono con chi ha fatto il sito. Le pagine locali restano il nostro punto di forza.",
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: HOME_FAQ.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};
