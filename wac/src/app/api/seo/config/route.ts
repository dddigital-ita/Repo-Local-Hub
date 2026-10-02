import { NextResponse } from "next/server";
import { getSeoConfig } from "@/lib/seo";

/**
 * Config SEO in JSON per il proxy (ex middleware, che non può usare pg).
 * Pubblica SOLO i dati non sensibili (redirect + slug override): niente
 * meta, keyword o impostazioni interne. Cache disattivata: il proxy
 * gestisce la sua cache in-process (60s).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const config = await getSeoConfig();
  return NextResponse.json(
    {
      redirects: config.redirects.map(({ from, to }) => ({ from, to })),
      landings: Object.fromEntries(
        Object.entries(config.landings).map(([k, v]) => [k, { slugOverride: v.slugOverride }]),
      ),
    },
    {
      headers: {
        // Config pubblica e rara: cache CDN, browser sempre aggiornato.
        "cache-control": "public, max-age=0, must-revalidate",
        "vercel-cdn-cache-control": "max-age=3600",
      },
    },
  );
}
