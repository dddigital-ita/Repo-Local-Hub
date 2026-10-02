"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Primitive di animazione stile Apple per i reveal allo scorrimento.
 *
 * ⚠️ Lezione dal bug delle "card staccate": era causato dalle card-link rimaste
 * `display: inline` dentro i wrapper RevealItem (background spezzato per righe).
 * Cura: `a.glass-solid { display: block }` in globals.css + classe `block` sulle card.
 * Con ciò i reveal possono usare slide+fade completi senza artefatti.
 */

/** Spring "gentle": per dissolvenze di sezioni e card. */
export const springSoft = { type: "spring", stiffness: 170, damping: 22, mass: 1 } as const;

/** Spring "snappy": per bottoni, chip, micro-interazioni. */
export const springSnappy = { type: "spring", stiffness: 420, damping: 30, mass: 0.8 } as const;

/** Varianti per contenitori con figli in sequenza (stagger). */
export function staggerChildren(stagger = 0.08, delay = 0): Variants {
  return {
    hidden: {},
    shown: { transition: { staggerChildren: stagger, delayChildren: delay } },
  };
}

/** Varianti del figlio: dissolvenza + leggera salita (stile iOS). */
export const childFade: Variants = {
  hidden: { opacity: 0, y: 18 },
  shown: { opacity: 1, y: 0, transition: springSoft },
};

/** Compat: alias deprecati (nessun transform). */
export const hiddenUp = { opacity: 0 };
export const shownUp = { opacity: 1 };

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
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 20 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount }}
      transition={{ ...springSoft, delay }}
    >
      {children}
    </motion.div>
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
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : "hidden"}
      whileInView="shown"
      viewport={{ once: true, amount }}
      variants={staggerChildren(stagger, delay)}
    >
      {children}
    </motion.div>
  );
}

/** Figlio di RevealGroup: solo dissolvenza. */
export function RevealItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div className={className} variants={childFade}>
      {children}
    </motion.div>
  );
}
