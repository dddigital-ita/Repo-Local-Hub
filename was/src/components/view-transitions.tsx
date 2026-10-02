"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

/**
 * Transizioni di pagina con la View Transitions API nativa del browser.
 * Intercetta i click sui link interni, avvia document.startViewTransition()
 * e naviga dentro il callback: il vecchio contenuto sfuma, il nuovo entra
 * come un foglio iOS (vedi ::view-transition-* in globals.css).
 *
 * - La readiness del nuovo contenuto è EVENT-DRIVEN: dentro il callback la
 *   navigazione parte in una useTransition di React e il callback si risolve
 *   quando quella transizione committa (isPending → false, sondato via rAF
 *   con tetto di 3s). Niente ritardo fisso: l'animazione parte al momento
 *   giusto anche sui render lenti (prima compilazione dev, RSC pesante) e la
 *   vecchia pagina resta visibile finché la nuova non è davvero pronta.
 * - Degrada in silenzio dove l'API non c'è (Firefox vecchi) o se l'utente
 *   chiede reduced-motion: navigazione normale, nessuna animazione.
 * - Non tocca link esterni, download, modifier key e i push programmatici
 *   (search bar e chat hanno già le loro animazioni).
 */
type DocWithVT = Document & {
  startViewTransition?: (cb: () => void | Promise<void>) => {
    finished: Promise<void>;
    ready?: Promise<void>;
    updateCallbackDone?: Promise<void>;
  };
};

export default function ViewTransitions() {
  const router = useRouter();
  const [pending, iniziaNavigazione] = useTransition();
  // Il flag vive in un ref: il listener dei click non si riaggancia a ogni
  // flip di isPending, e il callback della transizione lo legge senza
  // chiudersi sopra uno stato stantio.
  const pendingRef = useRef(pending);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

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
      const transizione = doc.startViewTransition!(async () => {
        // La navigazione parte QUI (dopo lo snapshot della vecchia pagina)
        // dentro una useTransition: isPending è il segnale di commit del
        // nuovo contenuto, l'equivalente React del «render fatto».
        iniziaNavigazione(() => {
          router.push(`${url.pathname}${url.search}${url.hash}`);
        });
        // Attende il commit sondando il ref a ogni frame, con tetto di 3s:
        // se qualcosa va storto risolve comunque PRIMA del watchdog di
        // Chromium (~4s sull'update del DOM) — la navigazione resta
        // regolare, salta solo l'animazione, grazia prevista dall'API.
        await new Promise<void>((risolvi) => {
          const tetto = setTimeout(risolvi, 3000);
          const sondaggio = () => {
            if (!pendingRef.current) {
              clearTimeout(tetto);
              risolvi();
            } else {
              requestAnimationFrame(sondaggio);
            }
          };
          requestAnimationFrame(sondaggio);
        });
      });
      // Il watchdog può abortire la transizione (render troppo lento):
      // senza consumo delle promesse il rifiuto diventa un
      // unhandledRejection che Next inoltra dal browser al terminale.
      transizione.finished.catch(() => {});
      transizione.ready?.catch(() => {});
      transizione.updateCallbackDone?.catch(() => {});
    };

    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [router, iniziaNavigazione]);

  return null;
}
