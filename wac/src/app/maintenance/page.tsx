import type { Metadata } from "next";
import { contacts, site } from "@/lib/site";
import {
  MAINTENANCE_TITLE,
  MAINTENANCE_DEFAULT_SUB,
} from "@/lib/maintenance-shared";
import { readMaintenanceConfig } from "@/lib/maintenance-store";

/**
 * PAGINA DI MANUTENZIONE (/maintenance) — pulita per progetto: logo, hero
 * hook, info e due CTA (WhatsApp + Chiama) con mini footer. Niente header,
 * niente chat, niente banner: il layout del sito la esclude da PublicOnly.
 *
 * Questa rotta React è l'ANTEPRIMA/backup della pagina (il cancello vero
 * vive nel proxy, che serve lo stesso messaggio in HTML autonomo con 503
 * su qualunque percorso pubblico): qui si arriva direttamente per vedere
 * com'è, o se il matcher cambiasse in futuro.
 */

export const metadata: Metadata = {
  title: MAINTENANCE_TITLE,
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  const config = await readMaintenanceConfig();
  const sub = config.message || MAINTENANCE_DEFAULT_SUB;

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-4 py-16">
      <section
        aria-labelledby="m-title"
        className="w-full max-w-2xl rounded-[32px] border border-white/70 bg-white/60 p-8 text-center shadow-glass backdrop-blur-xl sm:p-12"
      >
        <p className="inline-flex items-center gap-3">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 text-xl font-extrabold text-white shadow-glass-btn" aria-hidden>
            W
          </span>
          <span className="text-left">
            <span className="block text-[15px] font-bold tracking-tight text-slate-900">{site.name}</span>
            <span className="block text-xs text-slate-500">Agenzia web · Crema</span>
          </span>
        </p>

        <h1 id="m-title" className="mt-8 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
          {MAINTENANCE_TITLE}
        </h1>
        <p className="mx-auto mt-4 max-w-[46ch] text-[15px] leading-relaxed text-slate-600">{sub}</p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href={contacts.whatsapp}
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand-600 px-6 text-sm font-bold text-white shadow-glass-btn transition hover:bg-brand-500"
          >
            Scrivici su WhatsApp
          </a>
          <a
            href={contacts.telHref}
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-900/10 bg-white/75 px-6 text-sm font-bold text-slate-800 transition hover:bg-white"
          >
            {contacts.phoneDisplay}
          </a>
        </div>

        <p className="mt-6 text-sm text-slate-500">
          Oppure scrivi a{" "}
          <a href={`mailto:${site.email}`} className="font-semibold text-brand-700 hover:underline">
            {site.email}
          </a>
        </p>
        {config.backOnline && <p className="mt-2 text-[13px] text-slate-500">Torniamo online: {config.backOnline}</p>}
      </section>

      <footer className="mt-8 pb-4 text-center text-xs leading-relaxed text-slate-500">
        © {new Date().getFullYear()} {site.name} —{" "}
        <span className="font-semibold text-slate-600">a branch by DDDigital</span>
      </footer>
    </main>
  );
}
