"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Nasconde il contenuto Pubblico nell'area team: il footer (e tutto ciò
 * che vi si incapsula) è marketing — nel backend sarebbe rumore sotto
 * l'ultimo strumento. Il children resta server-rendered: zero idratazione
 * in più, solo il gate di percorso.
 */
export default function PublicOnly({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Anche /maintenance resta pulita: è già una pagina "sostitutiva", non deve
  // vestirsi di footer, CTA sticky o altri elementi di marketing.
  if (pathname.startsWith("/admin") || pathname === "/maintenance") return null;
  return <>{children}</>;
}
