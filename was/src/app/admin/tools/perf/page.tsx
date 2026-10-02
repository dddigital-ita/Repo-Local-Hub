import type { Metadata } from "next";
import { Gauge } from "lucide-react";
import { GlassCard as Card, GlassSectionHeader } from "@/components/glass";
import { SubPageHeader } from "@/components/sub-page-header";
import PageCacheTtlPanel from "@/components/page-cache-ttl-panel";
import PerfTargetPanel from "@/components/perf-target-panel";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { readPageCacheConfig } from "@/lib/page-cache-store";
import { readPerfTargetConfig } from "@/lib/perf-target-store";
import {
  aggregaPerPagina,
  leggiAdminRender,
  PERF_RELEASE_CUT_ISO,
} from "@/lib/admin-perf";

/* I due pannelli sono Client Component importati DIRETTAMENTE:
   Next.js fa già code-splitting per rotta (il loro chunk entra
   nel bundle di /admin/tools/perf e solo lì) e l'import diretto
   renderizza in SSR — il server manda il contenuto vero. Il
   lazy loading con next/dynamic (React.lazy) è stato abbandonato
   su questo stack (Next 16.3.6 + React 19.3.0): il Flight
   serializer non sa serializzare l'elemento lazy — nella Server
   Component il payload RSC manda il nodo come null (pannello
   vuoto in SSR) e il wrapper Client Component con ssr:false
   lascia i pannelli fuori dal server con errori «destination
   stream closed early». Verificato su build reale: la prodlike
   TELEMETRIA (confronto prima/dopo) falliva col lazy, passa
   coll'import diretto. */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Velocità admin · Tools", robots: { index: false } };

export default async function PerfPage() {
  await requireAdmin();
  const pool = db();

  const righe = pool ? await leggiAdminRender(pool) : [];
  const pagine = aggregaPerPagina(righe, PERF_RELEASE_CUT_ISO);
  const [cache, target] = await Promise.all([
    readPageCacheConfig(),
    readPerfTargetConfig(),
  ]);

  return (
    <div className="space-y-6">
      <SubPageHeader
        backHref="/admin/tools"
        backLabel="Tools"
        Icon={Gauge}
        title="Velocità dell'admin"
        subtitle="Quanto pesa ogni pagina, letto dall'audit: una riga admin.render per navigazione, niente stime a memoria."
      />

      <Card>
        <GlassSectionHeader
          icon={Gauge}
          title="Prima / dopo le ottimizzazioni"
          subtitle="Il taglio è il rilascio 0.7.1 (reader singolo, cache per richiesta, TTL 60 s, indice dell'audit)."
        />
        {/* Target + barre vivono nel pannello client: il cursore
            ricolora le pill al momento (stato locale), il
            salvataggio è dell'action dietro requireAdmin. */}
        <PerfTargetPanel pagine={pagine} config={target} />
        <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
          Fonte: audit_log (action = admin.render, ultimi 2000 eventi — la
          lettura usa l&apos;indice della migration 044). Il tempo copre il
          rendering server della pagina, non la rete del tuo browser: le due
          colonne PRIMA/DOPO dividono la storia al taglio del rilascio.
        </p>
      </Card>

      {/* La leva del TTL: la pagina è dinamica (audit_log),
          ma il TTL accelera LE PAGINE PUBBLICHE — la stessa
          velocità misurata sopra, spostabile a mano. */}
      <Card>
        <GlassSectionHeader
          icon={Gauge}
          title="Velocità delle pagine pubbliche"
          subtitle="TTL della cache CDN di home e landing: lo sposti tu, lo applica il proxy, niente redeploy."
        />
        <div className="mt-4">
          <PageCacheTtlPanel config={cache} />
        </div>
      </Card>
    </div>
  );
}
