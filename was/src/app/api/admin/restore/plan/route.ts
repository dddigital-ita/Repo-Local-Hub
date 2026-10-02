import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { planRestore } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

const MAX_JSON_BYTES = 128 * 1024 * 1024; // il backup è ~117 KB oggi; margine ampio

/**
 * Piano di restore: l'operatore carica il backup e vede cosa verrebbe
 * toccato (righe nel file vs righe attuali, tabelle saltate e perché).
 * NON esegue nulla: l'esecuzione passa da restoreConfirmAction con la
 * conferma esplicita. Il file NON viene salvato da nessuna parte: vive
 * solo tra questa risposta e il form di conferma (hidden field).
 */
export async function POST(req: Request) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let json: string;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "nessun_file" }, { status: 400 });
    }
    if (file.size > MAX_JSON_BYTES) {
      return NextResponse.json({ error: "file troppo grande" }, { status: 413 });
    }
    json = await file.text();
    if (json.length > MAX_JSON_BYTES) {
      return NextResponse.json({ error: "file troppo grande" }, { status: 413 });
    }
  } catch {
    return NextResponse.json({ error: "upload illeggibile" }, { status: 400 });
  }

  const plan = await planRestore(json);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });

  // Il JSON torna al client solo per rientrare nel form di conferma (hidden):
  // non c'è storage, la fonte di verità resta il file che l'operatore ha scelto.
  return NextResponse.json({
    ok: true,
    plan: plan.plan,
    meta: plan.meta,
    json,
  });
}
