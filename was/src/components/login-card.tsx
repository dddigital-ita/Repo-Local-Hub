"use client";

import type { ReactNode } from "react";

/**
 * Card con entrata morbida (usata nel login admin).
 * Era framer-motion (spring): stessa sensazione con una CSS animation —
 * gemello-pari nei due repo, framer fuori dalla pagina di login.
 */
export default function LoginCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`card-in ${className ?? ""}`}>{children}</div>;
}
