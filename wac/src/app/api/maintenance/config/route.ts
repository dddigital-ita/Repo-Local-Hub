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
    { headers: { "cache-control": "no-store" } },
  );
}
