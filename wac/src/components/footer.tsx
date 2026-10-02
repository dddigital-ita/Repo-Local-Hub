"use client";

import Link from "next/link";
import { Phone, Mail, MessageCircle, CalendarClock } from "lucide-react";
import { site, LANDINGS, contacts } from "@/lib/site";
import { useConsent } from "@/components/consent";

export default function Footer() {
  // GDPR: chi ha già scelto deve poter CAMBIARE idea. Il bottone riapre il
  // banner (openPreferences del ConsentProvider); senza consenso registrato
  // il banner compare da sé e il bottone resta «Cookie» (link alla policy).
  const { openPreferences, consent } = useConsent();

  return (
    <footer className="mt-24 border-t border-white/50 bg-white/40 backdrop-blur-xl">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        {/* Contatti: telefono + WhatsApp di Michele, sempre visibili e cliccabili */}
        <div>
          <p className="text-sm font-bold text-slate-900">{site.name}</p>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
            <li>
              <a
                href={contacts.telHref}
                className="flex items-center gap-2 font-medium text-slate-800 hover:text-brand-700"
              >
                <Phone className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                {contacts.phoneDisplay}
              </a>
            </li>
            <li>
              <a
                href={contacts.whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 font-medium text-slate-800 hover:text-brand-700"
              >
                <MessageCircle className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                WhatsApp diretto
              </a>
            </li>
            <li>
              <a href={`mailto:${site.email}`} className="flex items-center gap-2 hover:text-brand-700">
                <Mail className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                {site.email}
              </a>
            </li>
            <li className="flex items-start gap-2">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              Lun–Ven 9:00–19:00 · chat AI dopo le 19
            </li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">Servizi</p>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
            {LANDINGS.filter((l) => l.city === "crema").map((l) => (
              <li key={l.slug}>
                <Link href={`/${l.slug}`} className="hover:text-brand-700">
                  {l.serviceType}
                </Link>
              </li>
            ))}
            <li className="pt-1">
              <Link
                href="/consulenza?q=consulenza%20siti%20web"
                className="font-semibold text-brand-700 hover:text-brand-600"
              >
                Parla in chat col team →
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">Zone</p>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
            <li>
              <Link href="/agenzia-web-crema" className="hover:text-brand-700">
                Crema
              </Link>
            </li>
            <li>
              <Link href="/siti-web-cremona" className="hover:text-brand-700">
                Cremona
              </Link>
            </li>
            <li>
              <Link href="/siti-web-lodi" className="hover:text-brand-700">
                Lodi
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">Legale</p>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
            <li>
              <Link href="/privacy-policy" className="hover:text-brand-700">
                Privacy policy
              </Link>
            </li>
            <li>
              {consent === "unknown" ? (
                <Link href="/cookie-policy" className="hover:text-brand-700">
                  Cookie policy
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={openPreferences}
                  className="hover:text-brand-700"
                  aria-haspopup="dialog"
                >
                  Preferenze cookie
                </button>
              )}
            </li>
            <li>
              <Link href="/admin" className="hover:text-brand-700">
                Area team
              </Link>
            </li>
          </ul>
        </div>
      </div>
      {/* slate-600, non 500: su vetro bianco/40 il 500 dava 4,41:1 (< AA
          per il testo 12px) — il 600 sale a 5,5:1. In dark la scala slate
          invertita lo rende comunque chiaro (mirror del testo secondario).
          Footer senza via e P.IVA (richiesto): i dati legali completi restano
          nella privacy policy, il punto che la legge cerca davvero. */}
      <div className="flex flex-col items-center justify-between gap-2 border-t border-white/50 px-4 py-5 text-center text-xs leading-relaxed text-slate-600 sm:flex-row sm:px-6 sm:text-left">
        {/* Solo il nome corto, senza forma societaria: «S.r.l.» resta nella
            privacy policy, dove la ragione sociale completa è richiesta. */}
        <p>
          © {new Date().getFullYear()} {site.name} —{" "}
          <span className="font-medium text-slate-700">a branch by DDDigital</span>
        </p>
        <p>Crema (CR) · da sempre nel territorio</p>
      </div>
    </footer>
  );
}
