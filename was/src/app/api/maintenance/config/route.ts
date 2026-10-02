import { NextResponse } from "next/server";
import { readMaintenanceConfig } from "@/lib/maintenance-store";
import { MAINTENANCE_KEY } from "@/lib/maintenance-shared";

/**
 * Config manutenzione in JSON per il proxy (ex middleware, che non può usare
 * pg — stessa disciplina di /api/seo/config). Nessun segreto: la config è
 * pubblica per progetto (lo stato del sito lo è per chiunque la veda);
 * la rotta resta esclusa dall'indicizzazione via robots e dal matcher del
 * proxy (nessun loop: il proxy non intercetta /api).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const config = await readMaintenanceConfig();
  return NextResponse.json(
    { [MAINTENANCE_KEY]: config },
    {
      headers: {
        // La cache condivisa evita una query Neon per ogni istanza proxy.
        // ponytail: toggle manutenzione può richiedere fino a 10 minuti; usare invalidazione CDN se servirà immediatezza.
        "cache-control": "public, max-age=0, must-revalidate",
        "vercel-cdn-cache-control": "max-age=600",
      },
    },
  );
}
