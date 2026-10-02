"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Transizioni di pagina con la View Transitions API nativa del browser.
 * Intercetta i click sui link interni, avvia document.startViewTransition()
 * e naviga dentro il callback: il vecchio contenuto sfuma, il nuovo entra
 * come un foglio iOS (vedi ::view-transition-* in globals.css).
 *
 * - Degrada in silenzio dove l'API non c'è (Firefox vecchi) o se l'utente
 *   chiede reduced-motion: navigazione normale, nessuna animazione.
 * - Non tocca link esterni, download, modifier key e i push programmatici
 *   (search bar e chat hanno già le loro animazioni).
 */
type DocWithVT = Document & {
  startViewTransition?: (cb: () => void | Promise<void>) => { finished: Promise<void> };
};

export default function ViewTransitions() {
  const router = useRouter();

  useEffect(() => {
    const doc = document as DocWithVT;
    if (!doc.startViewTransition) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href") ?? "";
      if (!href.startsWith("/")) return; // solo link interni
      if (href.startsWith("/api/")) return;

      const url = new URL(href, location.href);
      if (url.origin !== location.origin) return;
      // Stessa pagina (anche solo hash/ancora): lascia il comportamento nativo
      if (url.pathname === location.pathname && url.search === location.search) return;
      // Pagina diversa ma stesso path con hash: scroll nativo, niente transizione
      if (url.pathname === location.pathname && url.hash) return;

      e.preventDefault();
      doc.startViewTransition!(async () => {
        router.push(`${url.pathname}${url.search}${url.hash}`);
        // attende il render del nuovo contenuto prima di rilasciare lo snapshot
        await new Promise((r) => setTimeout(r, 80));
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      });
    };

    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [router]);

  return null;
}
