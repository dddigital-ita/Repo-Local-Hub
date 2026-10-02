import { NextResponse } from "next/server";
import { readPageCacheConfig } from "@/lib/page-cache-store";
import { PAGE_CACHE_KEY } from "@/lib/page-cache-shared";

/**
 * Config TTL cache pagine in JSON per il proxy (stessa disciplina
 * di /api/maintenance/config e /api/seo/config: il proxy non può
 * usare pg). Nessun segreto: il TTL è un numero pubblico per
 * progetto. La rotta resta esclusa dal matcher del proxy (nessun
 * loop: il proxy non intercetta /api).
 *
 * Cache CDN 60s — volutamente breve: lo slider deve arrivare al
 * proxy in fretta (il browser rivalida sempre, come da regola).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const config = await readPageCacheConfig();
  return NextResponse.json(
    { [PAGE_CACHE_KEY]: config },
    {
      headers: {
        // La cache condivisa evita una query Neon per ogni istanza
        // proxy, ma il cambio TTL deve propagarsi in ~1 minuto.
        "cache-control": "public, max-age=0, must-revalidate",
        "vercel-cdn-cache-control": "max-age=60",
      },
    },
  );
}
