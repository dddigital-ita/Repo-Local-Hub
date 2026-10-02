import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { exportDominio } from "@/lib/domain-snapshots";
import { DOMINI, type DominioId } from "@/lib/domain-snapshots-shared";

export const dynamic = "force-dynamic";

/**
 * Download dell'export di un dominio: `?per=gemello` applica la whitelist
 * (niente segreti, niente testi di sito); senza, l'export completo locale.
 * Protetta dalla sessione admin come le altre rotte di download.
 */
export async function GET(req: Request, { params }: { params: Promise<{ dominio: string }> }) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { dominio } = await params;
  if (!DOMINI.some((d) => d.id === dominio)) {
    return NextResponse.json({ error: "dominio_non_valido" }, { status: 400 });
  }
  const perGemello = new URL(req.url).searchParams.get("per") === "gemello";
  try {
    const json = await exportDominio(dominio as DominioId, perGemello);
    const suffisso = perGemello ? "gemello" : "completo";
    const filename = `updates-${dominio}-${suffisso}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "export_fallito", dettaglio: e instanceof Error ? e.message : "?" },
      { status: 500 },
    );
  }
}
