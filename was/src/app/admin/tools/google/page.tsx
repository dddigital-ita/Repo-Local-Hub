import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * Il Google growth kit vive in Impostazioni › Integrazioni
 * (`/admin/settings/google`): questa è solo una compatibilità
 * per i segnalibri vecchi.
 */
export default async function LegacyGoogleToolPage() {
  await requireAdmin();
  redirect("/admin/settings/google");
}
