/**
 * Icona+testo dentro un componente LOCALE il cui wrapper ha inline-flex
 * (pattern GlassBadge): il guard deve scendere nella def del componente
 * e leggere il layout lì. LEGALE, non segnalare.
 */
import { MapPin } from "lucide-react";
import type { ReactNode } from "react";

export function GlassBadgeLike({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/50 px-3 py-1 text-xs font-medium">
      {children}
    </span>
  );
}

export function BadgeUsageOk() {
  return (
    <GlassBadgeLike>
      <MapPin className="h-3.5 w-3.5 text-brand-600" aria-hidden />
      Web agency con base nel Salento
    </GlassBadgeLike>
  );
}
