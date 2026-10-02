import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, History, RefreshCw } from "lucide-react";
import { GlassCard as Card, GlassNotice } from "@/components/glass";
import { requireAdmin } from "@/lib/admin";
import {
  cacheAgeInfo,
  sanitizeCacheReason,
  targetLabels,
  type CacheTargetId,
} from "@/lib/cache-shared";
import { readLastPurge } from "@/lib/cache-purge";
import CachePanel from "@/components/cache-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Free cache · Tools", robots: { index: false } };

const VALID_TARGETS = new Set(["layout", "home", "landing", "admin"]);

/** Tools → Free cache: i gesti (revalidate) stanno in cache-purge.ts, qui si comanda. */
export default async function CacheToolPage({
  searchParams,
}: {
  searchParams: Promise<{ purged?: string; targets?: string; reason?: string }>;
}) {
  await requireAdmin();
  const { purged, targets, reason } = await searchParams;
  const safeReason = sanitizeCacheReason(reason);
  // I target dell'esito arrivano dalla query: vale solo ciò che il catalogo conosce.
  const doneTargets = (targets ?? "")
    .split(",")
    .filter((t): t is CacheTargetId => VALID_TARGETS.has(t));

  // Età della cache: l'ultima purga dall'audit, riletta a ogni apertura di
  // scheda (force-dynamic) — dopo una purga il numero è già aggiornato.
  const lastPurge = await readLastPurge();
  const age = cacheAgeInfo(lastPurge);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/tools"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Tools
        </Link>
        <h1 className="mt-2 flex items-center gap-2.5 text-2xl font-bold text-slate-900">
          <RefreshCw className="h-6 w-6 text-brand-600" aria-hidden />
          Free cache
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Svuota la cache dove serve: tutto il sito in un gesto, o solo l&apos;area toccata — ogni
          pagina riparte fresca e il contenuto cambiato è visibile subito.
        </p>
      </div>

      {purged === "1" && (
        <GlassNotice tone="success">
          Cache svuotata ({doneTargets.length ? targetLabels(doneTargets) : "nessun target"}): la
          prossima visita sulle pagine toccate ricompila dal vivo. Il gesto è registrato in audit.
        </GlassNotice>
      )}
      {purged === "0" && (
        <GlassNotice tone="warning">
          Purga non riuscita: controlla i log del server e riprova. Nessun contenuto è stato
          modificato.
        </GlassNotice>
      )}

      {/* ── Età della cache: fonte unica = audit (cache.purga) ─────── */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-900/5">
            <History className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            {age ? (
              <p className="text-sm font-semibold text-slate-900">
                Ultima purga: {age.label}
                {lastPurge?.targets.length ? (
                  <span className="font-normal text-slate-500">
                    {" "}
                    · {targetLabels(lastPurge.targets)}
                  </span>
                ) : null}
              </p>
            ) : (
              <p className="text-sm font-semibold text-slate-900">Mai purgata dal registro</p>
            )}
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              {age
                ? "Le pagine toccate da allora servono la cache: nessun contenuto cambiato dopo è ancora visibile."
                : "Nessun evento cache.purga nell'audit: o non è mai stata svuotata dal tool, o il registro non è raggiungibile."}
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CachePanel reason={safeReason || undefined} />
      </Card>
    </div>
  );
}
