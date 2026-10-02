"use client";

import { useEffect, useRef } from "react";

/**
 * MOTORE CANVAS DELL'HERO — un solo componente per i tre template grafici
 * di nuova generazione, tre fisiche diverse:
 *
 * - particles:      costellazione di nodi che driftano lentamente e si
 *                   connettono al puntatore con fili di luce;
 * - parallax-orbit: tre strati di sfere sfumate a profondità diversa che
 *                   reagiscono a mouse (offset) e scroll (deriva verticale);
 * - dot-grid:       griglia di puntini che respira in riposo e si accende
 *                   dove passa il cursore, con energia che decade.
 *
 * Regole di casa (vedi hero.css in testa):
 * - UNICO canvas per template, sempre dietro il contenuto (z-0), mai sul testo;
 * - solo transform/alpha in draw: niente layout, niente blur pesanti a catena;
 * - pausa totale quando l'hero esce dallo schermo o il tab è nascosto;
 * - prefers-reduced-motion: UN frame statico, niente loop, niente mouse;
 * - palette dai token CSS (brand) con override --hero-accent-rgb dall'admin.
 *
 * Lezioni della revisione «sembra buggato»:
 * - la parallasse NON teletrasporta più le sfere (niente modulo che le fa
 *   «scaricare» dall'alto): deriva smussata dello scroll + dissolvenza ai
 *   bordi, così entrano e escono come fossero fuori fuoco, non di poppo;
 * - la griglia non è più una texture morta: respira con un'onda lentissima
 *   in riposo e si sposta di pochi px col mouse (profondità senza rumore);
 * - gli input (mouse/scroll) sono sempre ammorzati con lerp: niente salti
 *   al primo frame dopo l'ingresso del puntatore.
 *
 * Nota implementativa: funzioni freccia in ordine di dipendenza (le
 * dichiarazioni «function» hoistate perdono il narrowing di TS sugli
 * elementi nullable e spaccano il typecheck).
 */

type EngineVariant = "particles" | "parallax-orbit" | "dot-grid";

interface Props {
  variant: EngineVariant;
}

export default function HeroCanvasEngine({ variant }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement ?? null;
    if (!canvas || !host) return;
    const g2d = canvas.getContext("2d");
    if (!g2d) return;
    // Alias tipizzati non-null: dentro le closure il narrowing non basta.
    const ctx: CanvasRenderingContext2D = g2d;
    const parent: HTMLElement = host;
    const cv: HTMLCanvasElement = canvas;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Palette ereditata dalle variabili CSS: accento admin se scelto,
    // altrimenti i token brand. Parse a tripletta → stringhe rgba sicure.
    const cs = getComputedStyle(cv);
    const parse = (v: string, fb: [number, number, number]): [number, number, number] => {
      const m = v.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : fb;
    };
    const accent = parse(
      cs.getPropertyValue("--hero-accent-rgb"),
      parse(cs.getPropertyValue("--brand-600"), [38, 83, 223]),
    );
    const soft = parse(cs.getPropertyValue("--brand-300"), [125, 171, 247]);
    const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

    let width = 0;
    let height = 0;
    let raf = 0;
    let running = false;
    let visible = true;

    /* ── Input ammorzati: niente salti, tutto entra con lerp ── */
    const mouse = { x: -9999, y: -9999, active: false };
    const nx = { cur: 0 }; // posizione normale del mouse −0.5…0.5 (asse X), ammorzata
    const ny = { cur: 0 };
    const scrollCur = { v: 0 }; // scrollY ammorzato per la parallasse
    let heroTop = 0; // posizione assoluta dell'hero nella pagina (cache al resize)

    /* ── Stato del mondo: inizializzato al resize ── */
    type Node = { x: number; y: number; vx: number; vy: number; r: number; e: number; depth: number };
    let nodes: Node[] = [];

    const seed = () => {
      if (variant === "dot-grid") {
        // Griglia statica: le posizioni non driftano, solo energia.
        const gap = 26;
        nodes = [];
        for (let y = gap; y < height; y += gap) {
          for (let x = gap; x < width; x += gap) {
            nodes.push({ x, y, vx: 0, vy: 0, r: 1, e: 0, depth: 0 });
          }
        }
        return;
      }
      if (variant === "parallax-orbit") {
        // Tre strati: lontano (lento, grande, pallino), medio, vicino.
        const layers = [
          { n: 6, rMin: 60, rMax: 130, a: 0.05, depth: 0.25, sp: 0.05 },
          { n: 5, rMin: 30, rMax: 70, a: 0.08, depth: 0.55, sp: 0.09 },
          { n: 3, rMin: 130, rMax: 220, a: 0.1, depth: 1, sp: 0.13 },
        ];
        nodes = [];
        for (const L of layers) {
          for (let i = 0; i < L.n; i++) {
            const r = L.rMin + Math.random() * (L.rMax - L.rMin);
            nodes.push({
              x: Math.random() * width,
              y: Math.random() * height,
              vx: (Math.random() - 0.5) * L.sp,
              vy: (Math.random() - 0.5) * L.sp * 0.7,
              r,
              e: L.a,
              depth: L.depth,
            });
          }
        }
        return;
      }
      // particles
      const n = Math.max(12, Math.min(90, Math.round((width * height) / 16000)));
      nodes = Array.from({ length: n }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: 0.9 + Math.random() * 1.3,
        e: 0,
        depth: 0,
      }));
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);

      /* ── Input smussati (una volta per frame, per tutti i template) ── */
      const targetNx = mouse.active ? mouse.x / Math.max(1, width) - 0.5 : 0;
      const targetNy = mouse.active ? mouse.y / Math.max(1, height) - 0.5 : 0;
      nx.cur += (targetNx - nx.cur) * 0.06;
      ny.cur += (targetNy - ny.cur) * 0.06;
      const relScroll = Math.max(-300, Math.min(900, (scrollCur.v - heroTop) * 0.08));

      if (variant === "dot-grid") {
        // Parallasse leggera dell'intera griglia: si sposta di pochi pixel
        // INVERSO al mouse → profondità senza toccare il contenuto.
        const ox = nx.cur * -9;
        const oy = ny.cur * -6;
        for (const p of nodes) {
          // Riposo: onda lentissima che attraversa la griglia (viva ma calma).
          const phase = p.x * 0.011 + p.y * 0.013;
          const base = 0.11 + 0.05 * Math.sin(t * 0.0006 + phase);
          // Eccitazione: campana morbida attorno al puntatore, poi decade.
          if (mouse.active) {
            const dx = p.x + ox - mouse.x;
            const dy = p.y + oy - mouse.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < 16900) {
              // 130px
              const k = 1 - Math.sqrt(d2) / 130;
              p.e = Math.min(1, p.e + k * k * 0.22);
            }
          }
          p.e *= 0.93;
          const a = base + p.e * 0.6;
          ctx.fillStyle = rgba(accent, a);
          ctx.beginPath();
          ctx.arc(p.x + ox, p.y + oy - p.e * 5, 1 + p.e * 1.9, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }

      if (variant === "parallax-orbit") {
        for (const o of nodes) {
          // Deriva lenta propria (sempre, anche senza mouse: il fondo vive).
          o.x += o.vx;
          o.y += o.vy;
          // Wrap solo nello spazio NON trasformato: mai teletrasporti a
          // schermo (il vecchio modulo sul y+offset faceva «piovere» sfere).
          if (o.x < -o.r) o.x = width + o.r;
          if (o.x > width + o.r) o.x = -o.r;
          if (o.y < -o.r) o.y = height + o.r;
          if (o.y > height + o.r) o.y = -o.r;
          // Parallasse: mouse ±26px, scroll fino a ~70px — proporzionali alla
          // profondità dello strato, ammorzati dagli input lerp di sopra.
          const dx = o.x + nx.cur * 52 * o.depth;
          const dy = o.y + ny.cur * 34 * o.depth - relScroll * o.depth;
          // Dissolvenza ai bordi verticali: entra/esce come fuori fuoco.
          const edge = Math.min(dy + o.r * 0.4, height + o.r * 0.4 - dy) / 90;
          const a = o.e * Math.max(0, Math.min(1, edge));
          if (a <= 0.004) continue;
          const grad = ctx.createRadialGradient(dx, dy, 0, dx, dy, o.r);
          grad.addColorStop(0, rgba(soft, a));
          grad.addColorStop(1, rgba(soft, 0));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(dx, dy, o.r, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }

      // particles: nodi + fili fra vicini + fili verso il puntatore
      for (const p of nodes) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        if (p.y > height + 10) p.y = -10;
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 12100) {
            // 110px
            ctx.strokeStyle = rgba(accent, 0.3 * (1 - Math.sqrt(d2) / 110));
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        if (mouse.active) {
          const dx = a.x - mouse.x;
          const dy = a.y - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 32400) {
            // 180px: il puntatore «tira» fili più luminosi
            ctx.strokeStyle = rgba(accent, 0.45 * (1 - Math.sqrt(d2) / 180));
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.stroke();
          }
        }
        const tw = 0.5 + 0.5 * Math.sin(t * 0.001 + i * 1.7); // battito lento
        ctx.fillStyle = rgba(accent, 0.35 + tw * 0.3);
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    /* ── Loop con pausa vera: esce dal rAF quando non serve ── */
    const tick = (t: number) => {
      if (!running) return;
      // Input di pagina letti una volta per frame, poi ammorzati.
      scrollCur.v += ((window.scrollY || 0) - scrollCur.v) * 0.12;
      draw(t);
      raf = requestAnimationFrame(tick);
    };
    const play = () => {
      if (running || reduced || !visible || document.hidden) return;
      running = true;
      raf = requestAnimationFrame(tick);
    };
    const pause = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = parent.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      heroTop = rect.top + (window.scrollY || 0);
      cv.width = Math.round(width * dpr);
      cv.height = Math.round(height * dpr);
      cv.style.width = `${width}px`;
      cv.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scrollCur.v = window.scrollY || 0; // niente corsa iniziale della parallasse
      seed();
      if (reduced) draw(0); // frame statico, poi si ferma per sempre
    };

    /* ── Eventi ── */
    const onPointerMove = (e: PointerEvent) => {
      const rect = parent.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = true;
    };
    const onPointerLeave = () => {
      mouse.active = false;
    };
    const onVisibility = () => {
      if (document.hidden) pause();
      else play();
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) play();
      else pause();
    });
    io.observe(parent);

    const ro = new ResizeObserver(resize);
    ro.observe(parent);

    parent.addEventListener("pointermove", onPointerMove, { passive: true });
    parent.addEventListener("pointerleave", onPointerLeave, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    resize();
    play();

    return () => {
      pause();
      io.disconnect();
      ro.disconnect();
      parent.removeEventListener("pointermove", onPointerMove);
      parent.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [variant]);

  return <canvas ref={canvasRef} aria-hidden className="block h-full w-full" />;
}
