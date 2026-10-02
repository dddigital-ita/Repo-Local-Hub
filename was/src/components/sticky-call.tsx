"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { trackEvent } from "@/lib/ga";
import { Phone, MessageCircle } from "lucide-react";
import { contacts } from "@/lib/site";

/**
 * Telefono + WhatsApp sempre a portata di pollice su mobile. Nell'area admin
 * sono nascosti: coprivano le azioni dei ticket (risposte rapide) senza avere
 * senso lì. Il numero è quello principale del sito (Daniele): la chat AI
 * copre le notti, il sticky copre i pollici impazienti.
 */
export default function StickyCallButton() {
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();
  const inAdmin = pathname?.startsWith("/admin") ?? false;

  useEffect(() => {
    if (inAdmin) return;
    const onScroll = () => setVisible(window.scrollY > 300);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [inAdmin]);

  if (inAdmin) return null;

  return (
    <div
      className={`fixed bottom-4 right-4 z-[80] flex items-center gap-2 transition-all duration-300 sm:hidden ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-16 opacity-0"
      }`}
    >
      <a
        href={contacts.whatsapp}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackEvent("whatsapp_click", { position: "sticky_mobile" })}
        aria-label={`Scrivici su WhatsApp al ${contacts.phoneDisplay}`}
        className="flex items-center gap-2 rounded-full bg-[#25D366]/95 px-4 py-3.5 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition-colors hover:bg-[#20bd5a]/95"
      >
        <MessageCircle className="h-4 w-4" aria-hidden />
        WhatsApp
      </a>
      <a
        href={contacts.telHref}
        onClick={() => trackEvent("call_click", { position: "sticky_mobile" })}
        aria-label={`Chiama al ${contacts.phoneDisplay}`}
        className="flex items-center gap-2 rounded-full bg-brand-600/90 px-4 py-3.5 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition-colors hover:bg-brand-500/90"
      >
        <Phone className="h-4 w-4" aria-hidden />
        Chiama
      </a>
    </div>
  );
}
