import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAdminUser } from "@/lib/admin";
import { getSeoConfig, saveSeoConfig, sanitizeSeoConfig } from "@/lib/seo";
import { logAudit } from "@/lib/audit";

/**
 * Backup della config SEO COMPLETA (meta, contenuti, redirect, storico
 * contenuti/meta, avvisi GSC): export JSON scaricabile e import da file.
 * Stessi guard degli altri export admin (audit.csv, leads.csv).
 *
 * GET  → download del backup (filename con data).
 * POST → import: il JSON arriva già sanitizzato e VALIDATO (getSeoConfig
 *        gira nella route), viene ripristinato SOLO se il backup contiene
 *        almeno un dato reale — mai sovrascrivere la config con oggetti vuoti.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const config = await getSeoConfig();
  const payload = {
    kind: "seo-config-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: user.email,
    config,
  };

  await logAudit(user.email, "seo.backup-export", null, "export config SEO (JSON)");

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="seo-config-backup-${date}.json"`,
      "cache-control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "File non leggibile: deve essere JSON valido." }, { status: 400 });
  }

  const body = (parsed ?? {}) as Record<string, unknown>;
  if (body.kind !== "seo-config-backup") {
    return NextResponse.json(
      { ok: false, error: "Questo non è un backup della config SEO (manca il campo kind)." },
      { status: 400 },
    );
  }

  // Il backup passa per la stessa sanitize della config live: JSON manipolato,
  // campi extra o valori fuori limite vengono ripuliti, non ripristinati.
  const config = sanitizeSeoConfig(body.config);

  const real = Object.keys(config.landings).length + Object.keys(config.contents).length + config.redirects.length;
  if (real === 0) {
    return NextResponse.json(
      { ok: false, error: "Il backup non contiene dati validi (nessuna meta, contenuto o redirect): config non ripristinata." },
      { status: 400 },
    );
  }

  try {
    await saveSeoConfig(config);
  } catch {
    return NextResponse.json({ ok: false, error: "Database non configurato: ripristino non riuscito." }, { status: 500 });
  }

  revalidatePath("/", "layout");
  revalidatePath("/admin/seo");
  await logAudit(
    user.email,
    "seo.backup-import",
    null,
    `config ripristinata da backup (${Object.keys(config.landings).length} meta, ${Object.keys(config.contents).length} contenuti, ${config.redirects.length} redirect)`,
  );
  return NextResponse.json({ ok: true });
}
