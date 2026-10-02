import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { planRestore } from "@/lib/maintenance";
import { readCloudBackupJson } from "@/lib/backup-cloud";
import { parseCloudKey } from "@/lib/backup-cloud-shared";

export const dynamic = "force-dynamic";

/**
 * Piano di restore da un BACKUP AUTOMATICO NEL CLOUD (ripristino
 * d'emergenza). Non c'è upload: la chiave dell'oggetto nel bucket Neon
 * arriva in query, deve superare parseCloudKey (nessun path traversal
 * possibile: solo la forma auto/db-YYYY-MM-DD-HHMMSS.json.gz passa).
 * Il file viene letto, verificato contro il suo sha256 e scompattato qui;
 * il resto è identico alla rotta restore/plan: stesso piano, stesso JSON,
 * stessa conferma esplicita («RIPRISTINA») via restoreConfirmAction.
 * Nessuna scrittura: solo lettura dal bucket e dal database live.
 */
export async function GET(req: Request) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!parseCloudKey(key)) {
    return NextResponse.json({ error: "chiave non riconosciuta come backup automatico" }, { status: 400 });
  }

  const read = await readCloudBackupJson(key);
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: 400 });

  const plan = await planRestore(read.json);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });

  // Il JSON torna al client per rientrare nel form di conferma (hidden),
  // come per il backup da file: la fonte di verità resta l'oggetto nel
  // bucket, riletto al momento del restore da readCloudBackupJson.
  return NextResponse.json({
    ok: true,
    plan: plan.plan,
    meta: plan.meta,
    json: read.json,
    info: read.info,
  });
}
