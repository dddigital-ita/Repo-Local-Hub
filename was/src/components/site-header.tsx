"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { Container } from "./ui";
import { site, contacts } from "@/lib/site";

/**
 * Header con il logo del brand pack (lockup "WebAgency Salento").
 * Pulito e leggero: logo a sinistra, WhatsApp a destra; vetro sottile sticky.
 */
export default function SiteHeader() {
  const pathname = usePathname();
  // Nell'area team c'è già la navbar admin: il header del sito sarebbe ridondante
  if (pathname.startsWith("/admin")) return null;

  return (
    <header className="sticky top-0 z-50 border-b border-white/40 bg-white/55 backdrop-blur-xl">
      <Container className="flex h-16 items-center justify-between">
        <Link
          href="/"
          aria-label={`${site.name} — home`}
          className="inline-flex items-center transition-opacity hover:opacity-80"
        >
          {/* Lockup orizzontale del brand pack; altezza 40px come da tema.css.
              Due varianti ufficiali del brand system, scelta via CSS col tema:
              mono-bianco (fondo scuro) e primario navy (fondo chiaro). */}
          <Image
            src="/brand/logo-salento-bianco.svg"
            alt="WebAgency Salento"
            width={172}
            height={40}
            priority
            className="header-logo-white h-8 w-auto sm:h-10"
          />
          <Image
            src="/brand/logo-salento.svg"
            alt="WebAgency Salento"
            width={172}
            height={40}
            priority
            className="header-logo-navy h-8 w-auto sm:h-10"
          />
        </Link>
        {/* WhatsApp È il canale del sito: un solo bottone, in alto a destra. */}
        <a
          href={contacts.whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Scrivici su WhatsApp"
          className="inline-flex items-center gap-1.5 rounded-full border border-white/60 bg-white/60 px-3.5 py-1.5 text-sm font-medium text-slate-700 backdrop-blur-xl transition hover:bg-white/85 hover:text-brand-700"
        >
          <MessageCircle className="h-4 w-4 text-[#25D366]" aria-hidden />
          <span className="hidden sm:inline">WhatsApp</span>
        </a>
      </Container>
    </header>
  );
}
