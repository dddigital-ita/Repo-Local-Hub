"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { hexToRgbTriplet } from "@/lib/hero-shared";
import type { HeroCursor } from "@/lib/hero-shared";

// Nessun evento: React riverifica lo snapshot solo al mount/idratazione —
// esattamente ciò che serve al gate del portale.
const subscribeNoop = () => () => {};

/**
 * SCIA DEL MOUSE — cinque temi scelti da /admin/tools/hero (sezione
 * «Cursore» in fondo all'editor), tutti minimali e non invadenti:
 *
 * - glow:    solo l'alone largo in inerzia che segue il puntatore, senza
 *            punto (richiesta: «elimina il punto, lascia il gradiente»);
 * - lens:    lente d'ingrandimento (cerchio + manico) che insegue il
 *            puntatore e si prensi su pulsanti e link;
 * - comet:   cometa luminosa: testina vicina al puntatore, corpo/scia che
 *            segue con inerzia, si allunga con la velocità e punta sempre
 *            nella direzione di volo (atan2 smoothing, niente salti a 180°);
 * - elastic: punto che segue con una molla morbida e si stira nella
 *            direzione del movimento (fisica, non effetto);
 * - none:    nessun effetto — il componente non si monta proprio.
 *
 * Il colore (cursorAccent) arriva come --hero-cursor-rgb; senza colore è il
 * token brand. Il tema vive in data-hero-cursor-mode su <html>, il CSS dei
 * temi è in hero.css (glow predefinito = alone puro).
 *
 * ⚠️ OVERLAY GUARD: layer `fixed` → portale su document.body OBBLIGATORIO
 * (backdrop-filter = containing block, bug palette ⌘K, commit 8e5c7ba) e
 * nessun backdrop-filter qui dentro: solo gradienti/transform/opacity.
 * Touch e reduced-motion: spenti, come prima.
 */

interface Props {
  /** Tema scelto in admin; i salvataggi vecchi arrivano come "glow". */
  cursor?: HeroCursor;
  /** Hex #rrggbb o stringa vuota = token brand. */
  cursorAccent?: string;
}

export default function HeroCursorGlow({ cursor = "glow", cursorAccent = "" }: Props) {
  const dotRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);
  const ready = useSyncExternalStore(
    subscribeNoop,
    () =>
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      !window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );

  useEffect(() => {
    if (!ready) return;
    if (cursor === "none") return; // puntatore statico: niente portale, niente loop
    const dot = dotRef.current;
    const trail = trailRef.current;
    if (!dot || !trail) return;

    const root = document.documentElement;
    const mode = cursor;

    // Il colore vive su <html> così anche il CSS dei temi lo vede.
    if (cursorAccent) {
      root.style.setProperty("--hero-cursor-rgb", hexToRgbTriplet(cursorAccent));
    } else {
      root.style.removeProperty("--hero-cursor-rgb");
    }
    root.setAttribute("data-hero-cursor-mode", mode);

    const target = { x: -200, y: -200 };
    const cur = { x: -200, y: -200 };
    const slow = { x: -200, y: -200 };
    const stretch = { x: 1, y: 1, rot: 0 };
    /** Ultima posizione REALE del puntatore, tracciata anche a hero spento:
     *  al rientro la scia parte da qui, non da −200 (prima «vola» in
     *  diagonale attraverso l'hero a ogni scroll — il bug più visibile). */
    const lastPointer = { x: -200, y: -200 };
    let angle = 0;
    let hoverNear = false;
    let raf = 0;
    let running = true;
    let heroActive = false;

    const onPointer = (e: PointerEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
      lastPointer.x = e.clientX;
      lastPointer.y = e.clientY;
      // Ricalcolato solo su ingresso/uscita da un elemento interattivo
      // (prima il closest a ogni move teneva vivo il querySelector).
      if (e.target instanceof Element) {
        const over = e.target.closest("a, button, input, [role='button']") !== null;
        if (over !== hoverNear) hoverNear = over;
      }
    };

    // Velocità istantanea (per elastic e per la lunghezza della scia comet).
    const vel = { x: 0, y: 0 };
    let lastSpeed = 0;

    const tick = () => {
      if (!running) return;
      const px = cur.x;
      const py = cur.y;

      cur.x += (target.x - cur.x) * 0.22;
      cur.y += (target.y - cur.y) * 0.22;
      slow.x += (target.x - slow.x) * 0.07;
      slow.y += (target.y - slow.y) * 0.07;
      vel.x = cur.x - px;
      vel.y = cur.y - py;
      const sp = Math.hypot(vel.x, vel.y);
      lastSpeed += (sp - lastSpeed) * 0.15; // velocità smussata: la scia respira

      if (mode === "glow") {
        // Solo l'alone largo in inerzia: niente punto (richiesta utente).
        trail.style.transform = `translate3d(${slow.x.toFixed(1)}px, ${slow.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      } else if (mode === "lens") {
        // Lente: il cerchio insegue con inerzia; il manico (pseudo-elemento
        // CSS) punta via dal centro dello schermo via --lens-handle-rot.
        const s = hoverNear ? 1.18 : 1;
        dot.style.transform = `translate3d(${cur.x.toFixed(1)}px, ${cur.y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${s})`;
        trail.style.transform = `translate3d(${slow.x.toFixed(1)}px, ${slow.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
        // Manico verso l'esterno: angolo dal centro schermo al puntatore,
        // convertito per la rotazione CSS (0° = giù). Aggiornato SOLO qui:
        // niente calcoli extra negli altri temi.
        const deg = (Math.atan2(cur.y - window.innerHeight / 2, cur.x - window.innerWidth / 2) * 180) / Math.PI - 90;
        root.style.setProperty("--lens-handle-rot", `${deg.toFixed(1)}deg`);
      } else if (mode === "comet") {
        // Testina vicina al puntatore; il corpo segue con inerzia, la scia
        // si allunga con la velocità e punta nella direzione di volo.
        dot.style.transform = `translate3d(${target.x.toFixed(1)}px, ${target.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
        // Con il puntatore fermo atan2(0,0) = 0: senza la soglia la scia
        // «ruota» verso destra da ferma. Sotto 0.4px/frame l'angolo congela.
        if (sp > 0.4) {
          let da = (Math.atan2(vel.y, vel.x) * 180) / Math.PI - angle;
          // Normalizzazione a (−180°, 180°]: gira sempre per il lato corto,
          // niente «salto» quando la direzione attraversa ±180°.
          da = ((da % 360) + 540) % 360 - 180;
          angle += da * 0.25;
        }
        const scale = 0.75 + Math.min(1.3, lastSpeed * 0.045);
        trail.style.transform =
          `translate3d(${cur.x.toFixed(1)}px, ${cur.y.toFixed(1)}px, 0) translate(-50%, -50%) ` +
          `rotate(${angle.toFixed(1)}deg) scale(${scale.toFixed(3)}, 1)`;
      } else {
        // elastic: la molla è già la lerp; allungo il punto nella direzione
        // della velocità, con decadimento morbido.
        const k = Math.min(0.55, sp * 0.02);
        stretch.rot = (Math.atan2(vel.y, vel.x) * 180) / Math.PI;
        stretch.x += (1 + k - stretch.x) * 0.3;
        stretch.y += (1 - k * 0.7 - stretch.y) * 0.3;
        dot.style.transform =
          `translate3d(${cur.x.toFixed(1)}px, ${cur.y.toFixed(1)}px, 0) translate(-50%, -50%) ` +
          `rotate(${stretch.rot.toFixed(1)}deg) scale(${stretch.x.toFixed(3)}, ${stretch.y.toFixed(3)})`;
        trail.style.transform = `translate3d(${slow.x.toFixed(1)}px, ${slow.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      }

      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (!heroActive) {
        heroActive = true;
        // Snap sul puntatore reale: niente «volo» diagonale dalla corner
        // al rientro dell'hero (stop() aveva portato tutto a −200).
        target.x = lastPointer.x;
        target.y = lastPointer.y;
        cur.x = lastPointer.x;
        cur.y = lastPointer.y;
        slow.x = lastPointer.x;
        slow.y = lastPointer.y;
        const snap = `translate3d(${lastPointer.x.toFixed(1)}px, ${lastPointer.y.toFixed(1)}px, 0)`;
        dot.style.transform = snap;
        trail.style.transform = snap;
        root.setAttribute("data-hero-cursor", "on");
        raf = requestAnimationFrame(tick);
      }
    };
    const stop = () => {
      if (heroActive) {
        heroActive = false;
        root.removeAttribute("data-hero-cursor");
        cancelAnimationFrame(raf);
        // Posizione di riposo fuori schermo: nessuna scia residua.
        target.x = -200;
        target.y = -200;
        cur.x = -200;
        cur.y = -200;
        slow.x = -200;
        slow.y = -200;
        hoverNear = false;
        dot.style.transform = "translate3d(-200px, -200px, 0)";
        trail.style.transform = "translate3d(-200px, -200px, 0)";
      }
    };

    // La scia vive solo mentre l'hero è a schermo: si accende/spegne con
    // l'ingresso/uscita della sezione (l'hero monta data-hero="1" su <html>).
    const observer = new MutationObserver(() => {
      if (root.getAttribute("data-hero") === "1") start();
      else stop();
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-hero"] });

    if (root.getAttribute("data-hero") === "1") start();

    window.addEventListener("pointermove", onPointer, { passive: true });

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointer);
      stop();
      root.removeAttribute("data-hero-cursor-mode");
      root.style.removeProperty("--hero-cursor-rgb");
      root.style.removeProperty("--lens-handle-rot");
    };
  }, [ready, cursor, cursorAccent]);

  // SSR: nessun portale finché il client non è pronto (pattern noto).
  if (!ready) return null;
  // «Nessuno»: puntatore statico, il portale non esiste proprio.
  if (cursor === "none") return null;

  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
      <div
        ref={trailRef}
        className="hero-cursor-trail absolute left-0 top-0 will-change-transform"
        style={{ transform: "translate3d(-200px, -200px, 0)" }}
      />
      <div
        ref={dotRef}
        className="hero-cursor-dot absolute left-0 top-0 will-change-transform"
        style={{ transform: "translate3d(-200px, -200px, 0)" }}
      />
    </div>,
    document.body,
  );
}
