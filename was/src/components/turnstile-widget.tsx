"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";

/**
 * Widget Turnstile invisibile. Monta il challenge solo se riceve una siteKey
 * (env OPPURE configurazione salvata su Shield — il server decide). Espone
 * window.wacTurnstile.getToken() per ottenere il token (o null se
 * disabilitato/non pronto) prima delle submission importanti.
 * Il token è a USO UNICO: dopo ogni uso chiamare reset() per il successivo.
 *
 * Supporta più widget sulla stessa pagina (login + globale): getToken()
 * restituisce il PRIMO token disponibile.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
    wacTurnstile?: {
      getToken: () => string | null;
      ready: Promise<string | null>;
      reset: () => void;
      readyWithTimeout: (ms?: number) => Promise<string | null>;
    };
  }
}

const widgetIds: string[] = [];
let resolveReady: ((t: string | null) => void) | null = null;
let readyPromise: Promise<string | null> | null = null;

function newReady() {
  readyPromise = new Promise<string | null>((resolve) => {
    resolveReady = resolve;
  });
  if (window.wacTurnstile) window.wacTurnstile.ready = readyPromise;
}

function setupGlobal() {
  if (window.wacTurnstile) return;
  newReady();
  window.wacTurnstile = {
    getToken: () => {
      const els = document.querySelectorAll<HTMLInputElement>('[name="cf-turnstile-response"]');
      for (const el of els) if (el.value) return el.value;
      return null;
    },
    ready: readyPromise ?? Promise.resolve(null),
    reset: () => {
      if (!window.turnstile) return;
      for (const id of widgetIds) window.turnstile.reset(id);
    },
    readyWithTimeout: (ms?: number) => tokenWithTimeout(ms),
  };
}


/** Attende un token fresco con timeout: mai bloccare il cliente oltre 6s. */
async function tokenWithTimeout(ms = 6000): Promise<string | null> {
  if (!window.wacTurnstile) return null;
  // Se c'è già un token non consumato, usalo subito
  const current = window.wacTurnstile.getToken();
  if (current) return current;
  try {
    return await Promise.race([
      window.wacTurnstile.ready,
      new Promise<null>((r) => setTimeout(() => r(null), ms)),
    ]);
  } catch {
    return null;
  }
}

export default function TurnstileWidget({
  siteKey,
  containerId = "wac-turnstile-box",
}: {
  siteKey?: string | null;
  /** Con più widget nella stessa pagina servono container distinti. */
  containerId?: string;
}) {
  // setupGlobal() è idempotente: registrarla una volta di più non cambia
  // nulla (stesso comportamento del vecchio flag mounted, senza lo
  // setState-in-effect). Il ref callback di sotto non ne dipende più.
  useEffect(() => {
    if (siteKey) setupGlobal();
  }, [siteKey]);

  // All'unmount rimuovo i MIEI widget dal registry di Cloudflare PRIMA che il
  // container esca dal DOM: senza remove() ogni login→admin orfanizza il
  // widget e al mount successivo la console grida «Cannot find Widget
  // cf-chl-widget-…, consider using turnstile.remove()» (rumore nei log E2E).
  // Ref, non array locale: la closure del cleanup deve vedere gli id pushati
  // da onScriptLoad anche se il componente si è ri-renderizzato nel frattempo.
  const myIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const ids = myIdsRef.current; // stabile per istanza; letto al cleanup
    return () => {
      // Drain (splice(0) svuota DENTRO il loop): in dev StrictMode gli effect
      // girano mount→cleanup→mount e con lo script già in cache onReady
      // ri-spara al remount. Senza drain il ref conserva l'id del primo
      // render e il cleanup finale richiama remove() su un widget GIÀ
      // rimosso dal registry Cloudflare → «Cannot find Widget
      // cf-chl-widget-…» (il rumore intermittente nei log E2E: appare solo
      // nelle run con script cachato, mai a script freddo).
      for (const id of ids.splice(0)) {
        window.turnstile?.remove(id);
        const i = widgetIds.indexOf(id);
        if (i >= 0) widgetIds.splice(i, 1);
      }
    };
  }, []);

  if (!siteKey) return null;

  function onScriptLoad() {
    const container = document.getElementById(containerId);
    if (!container || !window.turnstile) return;
    const id = window.turnstile.render(container, {
      sitekey: siteKey,
      // NIENTE `size: "invisible"`: l'API attuale lo rifiuta («expected
      // "compact", "flexible", or "normal"») e il widget non si monta più,
      // bloccando ogni login. Il comportamento invisibile dipende dal TIPO di
      // sitekey (i widget invisibili non hanno footprint visivo a prescindere
      // dalla size); il contenitore resta comunque fuori schermo.
      callback: () => {
        resolveReady?.(window.wacTurnstile?.getToken() ?? null);
      },
    });
    if (typeof id === "string") {
      widgetIds.push(id);
      myIdsRef.current.push(id);
    }
  }

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="lazyOnload"
        onReady={onScriptLoad}
      />
      <div id={containerId} className="absolute -left-[9999px]" aria-hidden />
    </>
  );
}
