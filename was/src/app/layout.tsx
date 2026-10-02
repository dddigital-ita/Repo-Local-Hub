import type { Metadata, Viewport } from "next";
import { Geist, Inter, Manrope, Playfair_Display } from "next/font/google";
import { ConsentProvider } from "@/components/consent";
import Analytics from "@/components/analytics";
import AuroraLayers from "@/components/aurora-layers";
import ViewTransitions from "@/components/view-transitions";
import TurnstileWidget from "@/components/turnstile-widget";
import Footer from "@/components/footer";
import SiteHeader from "@/components/site-header";
import JsonLd from "@/components/json-ld";
import StickyCallButton from "@/components/sticky-call";
import PublicOnly from "@/components/public-only";
import { site, contacts } from "@/lib/site";
import { getSiteTheme, themeVars, DEFAULT_THEME } from "@/lib/theme";
import { getGoogleToolsConfig } from "@/lib/google-tools";
import { getSeoConfig } from "@/lib/seo";
import { activeTurnstileSiteKey } from "@/lib/turnstile";
// CSS per dominio: globals.css resta il design system (temi, dark mode,
// Glossy, glass); i domini applicativi vivono nei loro fogli dedicati.
// L'ORDINE è la cascata originale di globals.css prima della divisione:
// admin → hero → chat, tutti dopo il design system.
import "./globals.css";
import "./admin.css";
import "./hero.css";
import "./chat.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });

// Font opzionali dell'hero animato (tools → hero): variabili sempre definite
// (fallback sistema finché non usate) — l'hero le attiva con font-[family-name:…].
const heroInter = Inter({ subsets: ["latin"], variable: "--font-hero-inter" });
const heroManrope = Manrope({ subsets: ["latin"], variable: "--font-hero-manrope" });
const heroPlayfair = Playfair_Display({ subsets: ["latin"], variable: "--font-hero-playfair" });

const baseMetadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — Web agency nel Salento`,
    template: `%s | ${site.name}`,
  },
  description:
    "Web agency nel Salento: siti web in 7 giorni, e-commerce e SEO locale. Cerca nella barra, chatta col team e ti richiamiamo in giornata.",
  alternates: { canonical: "/" },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Web Agency Salento",
    statusBarStyle: "default",
  },
  openGraph: {
    type: "website",
    locale: "it_IT",
    siteName: site.name,
    images: ["/og"],
  },
  robots: { index: true, follow: true },
};

export async function generateMetadata(): Promise<Metadata> {
  const google = await getGoogleToolsConfig();
  // Strumento SEO: gli override dell'admin (home, keyword, og:site_name)
  // vincono sui default; senza configurazione i valori sono IDENTI ai
  // default di codice (DEFAULT_SEO_CONFIG deriva da site.ts), quindi
  // applicarli sempre è un no-op sicuro.
  const seo = await getSeoConfig();
  return {
    ...baseMetadata,
    title: { default: seo.homeTitle, template: `%s | ${seo.ogSiteName}` },
    description: seo.homeDescription,
    keywords: seo.siteKeywords ? seo.siteKeywords.split(",").map((k) => k.trim()).filter(Boolean) : undefined,
    openGraph: { ...baseMetadata.openGraph, siteName: seo.ogSiteName },
    verification: google.gscToken ? { google: google.gscToken } : undefined,
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/** themeColor DINAMICO (fix F1 della THEME-REVIEW): segue tema+mode+primary. */
export async function generateViewport(): Promise<Viewport> {
  const theme = await getSiteTheme().catch(() => DEFAULT_THEME);
  return {
    width: "device-width",
    initialScale: 1,
    themeColor: theme.primary ?? (theme.mode === "dark" ? "#0f1522" : "#2653df"),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Tema globale (sito + admin), applicato server-side: zero flash.
  // Con i default nessuna style inline: i token di globals.css fanno tutto.
  const theme = await getSiteTheme();
  const google = await getGoogleToolsConfig();
  // Captcha invisibile: site key attiva (env o config salvata su Shield).
  // Il widget globale serve a chat/lead; il login monta il SUO widget dedicato.
  const turnstileKey = await activeTurnstileSiteKey().catch(() => null);
  const vars = themeVars(theme);
  const styleVars = Object.keys(vars).length
    ? (Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v])) as React.CSSProperties)
    : undefined;
  const organization = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": `${site.url}/#organization`,
    name: site.name,
    legalName: site.legalName,
    url: site.url,
    telephone: site.phone,
    email: site.email,
    image: `${site.url}/og`,
    priceRange: "€€",
    // L'indirizzo nei dati strutturati SOLO se configurato davvero:
    // il placeholder («Via Example …») non finisce mai nel markup pubblico.
    ...(site.address.includes("Example")
      ? {}
      : {
          address: {
            "@type": "PostalAddress",
            streetAddress: site.address,
            addressLocality: "Lecce",
            addressRegion: "LE",
            postalCode: "73100",
            addressCountry: "IT",
          },
        }),
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        opens: "09:00",
        closes: "19:00",
      },
    ],
    areaServed: ["Salento", "Lecce", "Gallipoli", "Brindisi", "Otranto", "Nardò", "Maglie", "Copertino"],
    // Il contatto diretto è il numero WhatsApp (wa.me), non il numero di telefono.
    sameAs: [contacts.whatsapp],
  };

  return (
    <html
      lang="it"
      className={`${geist.variable} ${heroInter.variable} ${heroManrope.variable} ${heroPlayfair.variable}`}
      data-theme={theme.theme}
      data-mode={theme.mode}
      // Il layout è smooth (globals.css): dichiariarlo al router evita lo
      // scroll istantaneo durante le transizioni client-side e l'avviso Next.
      data-scroll-behavior="smooth"
      style={styleVars}
    >
      <body className="aurora flex min-h-screen flex-col font-sans text-slate-900 antialiased">
      <AuroraLayers />
        <ConsentProvider>
          <SiteHeader />
          <div className="flex min-h-screen flex-1 flex-col">{children}</div>
          <ViewTransitions />
          <TurnstileWidget siteKey={turnstileKey} />
          {/* Solo pagine pubbliche: footer e CTA telefono sono marketing —
              nell'area team sarebbero rumore sotto l'ultimo strumento. */}
          <PublicOnly>
            <Footer />
            <StickyCallButton />
          </PublicOnly>
          <Analytics config={google} />
        </ConsentProvider>
        <JsonLd data={organization} />
      </body>
    </html>
  );
}
