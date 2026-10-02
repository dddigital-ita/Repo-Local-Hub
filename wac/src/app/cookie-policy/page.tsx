import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Cookie policy",
  description: "Quali cookie usa questo sito, quali richiedono il consenso e come cambiarlo.",
  alternates: { canonical: "/cookie-policy" },
};

const TABLE = [
  { name: "cc_consent", type: "Tecnico", duration: "180 giorni", purpose: "Ricorda la tua scelta sul banner cookie. Non richiede consenso." },
  { name: "_ga / _ga_*", type: "Statistico (consenso)", duration: "fino a 13 mesi", purpose: "Google Analytics 4: conteggio visite e pagine viste. Caricato solo dopo il consenso." },
  { name: "GTM / altri tag Google", type: "Statistico (consenso)", duration: "variabile", purpose: "Google Tag Manager: gestisce i tag di misurazione. Caricato solo dopo il consenso." },
  { name: "_clck / _clsk", type: "Statistico (consenso)", duration: "12 mesi", purpose: "Microsoft Clarity (se attivo): analisi anonimizzata delle sessioni. Solo dopo il consenso." },
];

export default function CookiePolicyPage() {
  return (
    <main>
      <Container className="max-w-3xl py-14">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Cookie policy</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-slate-700">
          Questo sito usa cookie tecnici (necessari) e — <strong>solo con il tuo consenso</strong> —
          cookie statistici di terze parti per capire quali contenuti sono utili. Puoi revocare il
          consenso in qualsiasi momento: cancella il cookie <code>cc_consent</code> oppure usa la
          funzione «Cookie» che riaprirà il banner.
        </p>
        <div className="mt-8 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4">Cookie</th>
                <th className="py-2 pr-4">Tipo</th>
                <th className="py-2 pr-4">Durata</th>
                <th className="py-2">Scopo</th>
              </tr>
            </thead>
            <tbody>
              {TABLE.map((c) => (
                <tr key={c.name} className="border-b border-slate-100 align-top">
                  <td className="py-3 pr-4 font-mono text-xs">{c.name}</td>
                  <td className="py-3 pr-4">{c.type}</td>
                  <td className="py-3 pr-4">{c.duration}</td>
                  <td className="py-3">{c.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-8 text-[15px] leading-relaxed text-slate-700">
          I dati raccolti tramite la chat non usano cookie di profilazione: sono trattati secondo la{" "}
          <Link href="/privacy-policy" className="text-brand-700 underline underline-offset-2">
            privacy policy
          </Link>{" "}
          e solo dopo il tuo consenso esplicito nella chat stessa. Per qualsiasi domanda: {site.privacyController.email} ({site.privacyController.name}, titolare del trattamento).
        </p>
      </Container>
    </main>
  );
}
