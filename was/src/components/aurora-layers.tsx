"use client";

import { useEffect, useRef } from "react";

/**
 * Aurora parallax: due aloni fissi che derivano da soli (animazione CSS, GPU)
 * e sopra ricevono un parallax sottile da mouse e scroll, con inerzia
 * (lerp in requestAnimationFrame, zero re-render di React).
 * Solo transform → costo quasi nullo; skipped su touch e reduced-motion.
 */
export default function AuroraLayers() {
  const aRef = useRef<HTMLDivElement>(null);
  const bRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Su touch non c'è mouse: parallax solo scroll, più contained
    const isTouch = window.matchMedia("(pointer: coarse)").matches;

    const target = { mx: 0, my: 0, sy: 0 }; // obiettivi: mouse x/y, scroll y
    const cur = { ax: 0, ay: 0, bx: 0, by: 0 }; // valori correnti (lerp)
    let raf = 0;
    let running = true;

    const onPointer = (e: PointerEvent) => {
      if (isTouch) return;
      // Normalizzato -1..1 rispetto al centro schermo
      target.mx = (e.clientX / window.innerWidth) * 2 - 1;
      target.my = (e.clientY / window.innerHeight) * 2 - 1;
    };

    const onScroll = () => {
      // Parallax verticale legato allo scroll (limitato)
      target.sy = Math.min(1, Math.max(-1, window.scrollY / 800));
    };

    const tick = () => {
      if (!running) return;
      // Layer A (blu): segue il mouse leggermente, contrasta lo scroll
      cur.ax += (target.mx * 18 - cur.ax) * 0.04;
      cur.ay += (target.my * 12 - target.sy * 30 - cur.ay) * 0.04;
      // Layer B (chiaro): direzione opposta, ancora più soft
      cur.bx += (target.mx * -12 - cur.bx) * 0.03;
      cur.by += (target.my * -8 + target.sy * 22 - cur.by) * 0.03;

      a.style.transform = `translate3d(${cur.ax.toFixed(2)}px, ${cur.ay.toFixed(2)}px, 0)`;
      b.style.transform = `translate3d(${cur.bx.toFixed(2)}px, ${cur.by.toFixed(2)}px, 0)`;
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[-1] overflow-hidden">
      <div
        ref={aRef}
        className="aurora-layer aurora-layer-a absolute inset-[-20%] will-change-transform"
      />
      <div
        ref={bRef}
        className="aurora-layer aurora-layer-b absolute inset-[-20%] will-change-transform"
      />
    </div>
  );
}
