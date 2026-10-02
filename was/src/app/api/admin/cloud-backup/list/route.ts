import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { listCloudBackups } from "@/lib/backup-cloud";

export const dynamic = "force-dynamic";

/**
 * Elenco dei backup automatici nel bucket Neon (ripristino d'emergenza):
 * chiave, data/ora, dimensione, sha256 (metadata dell'oggetto) e ultima
 * modifica. Solo sessione admin: l'inventario del bucket non è pubblico.
 * Nessun contenuto qui: il JSON del backup si legge solo sulla rotta plan,
 * con lo stesso flusso di piano+conferma del restore da file.
 */
export async function GET() {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const backups = await listCloudBackups();
    return NextResponse.json({ ok: true, backups });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message.slice(0, 200) : "bucket non raggiungibile" },
      { status: 500 },
    );
  }
}
