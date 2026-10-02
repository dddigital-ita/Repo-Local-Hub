"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { saveTurnstileSettings, clearTurnstileSettings } from "@/lib/turnstile-settings";
import { testTurnstileVerification } from "@/lib/turnstile-verify";

/**
 * Azioni della scheda Cloudflare (Turnstile) nell'hub Impostazioni:
 * l'editor vive QUI da ora (prima stava in Shield, che resta diagnostica).
 * La SECRET non torna MAI al client: nella pagina si mostra solo un hint
 * mascherato. Ogni azione finisce nell'audit log con l'attore. Gli errori
 * tornano via ?err= come da convenzione del pannello.
 */

export async function saveTurnstileAction(formData: FormData) {
  const admin = await requireAdmin();
  const siteKey = String(formData.get("siteKey") ?? "");
  const secret = String(formData.get("secret") ?? "");
  const res = await saveTurnstileSettings({ siteKey, secret });
  if (!res.ok) {
    redirect(`/admin/settings/cloudflare?err=${encodeURIComponent(res.error ?? "Operazione non riuscita.")}`);
  }
  await logAudit(admin.email, "cloudflare.turnstile_save", null, "chiavi captcha aggiornate dalla scheda Cloudflare");
  revalidatePath("/admin/settings/cloudflare");
  revalidatePath("/admin/shield");
  redirect("/admin/settings/cloudflare?saved=captcha");
}

export async function clearTurnstileAction() {
  const admin = await requireAdmin();
  await clearTurnstileSettings();
  await logAudit(admin.email, "cloudflare.turnstile_clear", null, "config captcha (DB) rimossa dalla scheda Cloudflare");
  revalidatePath("/admin/settings/cloudflare");
  revalidatePath("/admin/shield");
  redirect("/admin/settings/cloudflare?saved=cancella");
}

/**
 * Test REALE della catena verso siteverify (stesso gesto di Drive e
 * Telegram: il test interroga davvero l'API esterna). Con la secret attiva
 * (env o DB) e il token fittizio ufficiale Cloudflare: un rifiuto solo del
 * token finto è la prova che la secret è valida. Audit con prefisso OK/ERRORE
 * come Drive: il dettaglio decide anche l'indicatore «ultimo test».
 */
export async function testTurnstileAction() {
  const admin = await requireAdmin();
  const result = await testTurnstileVerification();
  const msg = result.ok ? `OK — ${result.message}` : `ERRORE — ${result.message}`;
  await logAudit(admin.email, "cloudflare.test", null, msg);
  revalidatePath("/admin/settings/cloudflare");
  redirect(`/admin/settings/cloudflare?test=${encodeURIComponent(msg)}`);
}
