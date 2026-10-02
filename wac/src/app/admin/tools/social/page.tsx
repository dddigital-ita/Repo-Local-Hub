import { permanentRedirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * I canali social vivono in Impostazioni › Canali
 * (`/admin/settings/social`): lo spostamento è definitivo,
 * quindi questa compatibilità per i segnalibri vecchi è
 * un reindirizzamento permanente (308).
 */
export default async function LegacySocialToolPage() {
  await requireAdmin();
  permanentRedirect("/admin/settings/social");
}
