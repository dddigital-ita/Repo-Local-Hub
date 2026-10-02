"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActiveUser, updateOwnProfile, changeOwnEmail, type PersonalInfo } from "@/lib/users";

/**
 * Azioni dell'Area personale (/admin/profilo).
 * L'utente aggiorna SOLO i propri campi anagrafici: email, ruolo e stato
 * attivo non passano mai da qui (updateOwnProfile itera solo i campi del
 * profilo per costruzione — un campo iniettato nel FormData viene ignorato).
 */
export async function updateProfileAction(formData: FormData) {
  const user = await requireActiveUser();
  const fields: Partial<PersonalInfo> = {};
  for (const k of [
    "firstName",
    "lastName",
    "vatNumber",
    "fiscalCode",
    "phone",
    "address",
    "city",
    "province",
    "postalCode",
    "bio",
  ] as const) {
    const v = formData.get(k);
    if (typeof v === "string") fields[k] = v;
  }
  await updateOwnProfile(user.email, fields);
  revalidatePath("/admin/profilo");
}

/**
 * Cambio email del PROPRIO account: richiede la password corrente (l'email è
 * l'identità di login). In caso di successo la sessione viene ri-emessa con la
 * nuova email (changeOwnEmail lo fa) e si torna al profilo; gli errori
 * tornano come ?err= nella pagina.
 */
export async function changeEmailAction(formData: FormData) {
  const user = await requireActiveUser();
  const password = String(formData.get("currentPassword") ?? "");
  const newEmail = String(formData.get("newEmail") ?? "");
  const res = await changeOwnEmail(user.email, password, newEmail);
  if (!res.ok) {
    redirect(`/admin/profilo?err=email_${res.error}`);
  }
  revalidatePath("/admin/profilo");
  redirect("/admin/profilo?ok=email");
}
