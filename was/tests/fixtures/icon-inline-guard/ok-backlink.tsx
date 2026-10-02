/**
 * Back-link con inline-flex sull'ospite: LEGALE (non segnalare).
 * Riproduce il pattern dei back-link admin («Torna alla inbox»).
 */
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export function BackLinkOk() {
  return (
    <Link
      href="/admin/tickets"
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-white/60 hover:text-slate-900"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Torna alla inbox
    </Link>
  );
}
