"use client";

import { Children, cloneElement, isValidElement, useEffect, useRef, type CSSProperties, type ReactNode } from "react";

/**
 * Primitive di animazione stile Apple per i reveal allo scorrimento.
 *
 * ⚠️ Lezione dal bug delle "card staccate": era causato dalle card-link rimaste
 * `display: inline` dentro i wrapper RevealItem (background spezzato per righe).
 * Cura: `a.glass-solid { display: block }` in globals.css + classe `block` sulle card.
 *
 * ── PERCHÉ NIENTE FRAMER-MOTION QUI ─────────────────────────────────────────
 * Questi primitive vivono in OGNI pagina pubblica (home, 17 landing, privacy…):
 * con framer-motion portavano ~70 kB gzip nel first load dei visitatori solo
 * per dissolvenze. Da 2026-09-30 sono IntersectionObserver + transizioni CSS:
 * stessa estetica (spring iOS approssimato con cubic-bezier), API IDENTICA per
 * i consumatori (Reveal/RevealGroup/RevealItem con stagger/amount/delay) e
 * zero KB di JS di animazione. framer-motion resta dove il payload non pesa
 * sui visitatori: /admin e /consulenza (Chat).
 *
 * Riduced-motion: il CSS lo rispetta da solo via media query in globals.css.
 */

/** Spring "gentle" → curva CSS equivalente (attacco morbido, rilascio lungo). */
export const EASE_SOFT = "cubic-bezier(0.22, 1, 0.36, 1)";

/** Spring "snappy" per bottoni/chip (micro-interazioni). */
export const EASE_SNAPPY = "cubic-bezier(0.34, 1.3, 0.64, 1)";

/**
 * Hook condiviso: aggiunge la classe `is-revealed` quando l'elemento entra nel
 * viewport (una volta sola, soglia `amount`). Gli stili partono nascosti in
 * globals.css (.rv / .rv-item) e si accendono con la transizione.
 */
function useReveal<T extends HTMLElement>(amount: number) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-revealed");
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("is-revealed");
          io.disconnect();
        }
      },
      { threshold: amount },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [amount]);
  return ref;
}

/**
 * Reveal allo scroll: dissolve quando entra nel viewport, una volta sola.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  amount = 0.2,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  amount?: number;
}) {
  const ref = useReveal<HTMLDivElement>(amount);
  return (
    <div
      ref={ref}
      className={`rv ${className ?? ""}`}
      style={delay ? ({ "--rv-delay": `${delay}s` } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}

/** Griglia che dissolve i figli in sequenza quando entra nel viewport. */
export function RevealGroup({
  children,
  className,
  stagger = 0.08,
  delay = 0,
  amount = 0.2,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
  amount?: number;
}) {
  const ref = useReveal<HTMLDivElement>(amount);
  // Ogni figlio riceve il proprio indice: il delay staggerato è calc() in CSS
  // (calcolato dal browser, zero JS durante l'animazione). Se il figlio è già
  // un RevealItem (rv-item) NON lo incarto: gli clono l'indice, altrimenti
  // verrebbe un doppio wrapper con doppio transform.
  const items = Children.toArray(children).map((child, i) => {
    if (child === null || child === undefined) return null;
    if (isValidElement(child) && typeof child.props === "object" && child.props !== null && "className" in child.props && String((child.props as { className?: unknown }).className ?? "").includes("rv-item")) {
      return cloneElement(child, { key: i, ...({ "--i": i } as CSSProperties) });
    }
    return (
      <StaggerSlot key={i} index={i}>
        {child}
      </StaggerSlot>
    );
  });
  return (
    <div
      ref={ref}
      className={`rv-group ${className ?? ""}`}
      style={{ "--rv-stagger": `${stagger}s`, "--rv-delay": `${delay}s` } as CSSProperties}
    >
      {items}
    </div>
  );
}

function StaggerSlot({ index, children }: { index: number; children: ReactNode }) {
  return (
    <div className="rv-item" style={{ "--i": index } as CSSProperties}>
      {children}
    </div>
  );
}

/** Figlio di RevealGroup: solo dissolvenza (il ritardo viene dal gruppo). */
export function RevealItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`rv-item ${className ?? ""}`}>{children}</div>;
}
