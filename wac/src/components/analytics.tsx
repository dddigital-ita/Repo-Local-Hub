"use client";

import Script from "next/script";
import { useConsent } from "./consent";

/**
 * Google kit caricato SOLO dopo consenso:
 *  - GA4 via @next/third-parties
 *  - Google Tag Manager (container id da env)
 *  - Microsoft Clarity (opzionale)
 * Search Console: meta tag nel layout (sempre attiva, nessun cookie).
 */
export default function Analytics({
  config,
}: {
  config?: { ga4Id?: string; gtmId?: string; clarityId?: string };
}) {
  const { consent } = useConsent();
  const ga4 = config?.ga4Id || process.env.NEXT_PUBLIC_GA4_ID;
  const gtm = config?.gtmId || process.env.NEXT_PUBLIC_GTM_ID;
  const clarity = config?.clarityId || process.env.NEXT_PUBLIC_CLARITY_ID;

  if (consent !== "granted") return null;

  return (
    <>
      {ga4 && <Script src={`https://www.googletagmanager.com/gtag/js?id=${ga4}`} strategy="afterInteractive" />}
      {gtm && (
        <Script id="gtm" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}');`}
        </Script>
      )}
      {clarity && (
        <Script id="clarity" strategy="afterInteractive">
          {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${clarity}");`}
        </Script>
      )}
    </>
  );
}
