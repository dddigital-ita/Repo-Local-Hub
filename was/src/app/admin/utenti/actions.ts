"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/users";
import { stashNote } from "@/lib/note";
import {
  createUser,
  setUserRole,
  setUserActive,
  setUserEmail,
  resetUserPassword,
  deleteUser,
  type UserRole,
} from "@/lib/users";

/**
 * Azioni di gestione utenti — SOLO super admin (requireSuperAdmin come prima
 * riga di ogni azione: la guardia è nel server action, non solo nella pagina).
 * Ogni esito reindirizza con ?err=/&ok= per il feedback in pagina; le azioni
 * che creano dati finiscono in audit_log con l'attore (in lib/users).
 */

function back(err: string, ok?: string): never {
  const q = new URLSearchParams();
  if (err) q.set("err", err);
  if (ok) q.set("ok", ok);
  redirect(`/admin/utenti?${q.toString()}`);
}

export async function createUserAction(formData: FormData) {
  const me = await requireSuperAdmin();
  const role = String(formData.get("role") ?? "admin");
  const res = await createUser(me.email, {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    role: (role === "super_admin" ? "super_admin" : "admin") as UserRole,
    displayName: String(formData.get("displayName") ?? "") || undefined,
  });
  if (!res.ok) back(res.error ?? "db");
  revalidatePath("/admin/utenti");
  back("", "creato");
}

export async function setUserRoleAction(formData: FormData) {
  const me = await requireSuperAdmin();
  const email = String(formData.get("email") ?? "");
  const role = String(formData.get("role") ?? "admin");
  const res = await setUserRole(me.email, email, (role === "super_admin" ? "super_admin" : "admin") as UserRole);
  if (!res.ok) back(res.error ?? "db");
  revalidatePath("/admin/utenti");
  back("", "ruolo");
}

export async function setUserActiveAction(formData: FormData) {
  const me = await requireSuperAdmin();
  const email = String(formData.get("email") ?? "");
  const res = await setUserActive(me.email, email, String(formData.get("active") ?? "") === "1");
  if (!res.ok) back(res.error ?? "db");
  revalidatePath("/admin/utenti");
  back("", String(formData.get("active") ?? "") === "1" ? "attivato" : "disattivato");
}

export async function setUserEmailAction(formData: FormData) {
  const me = await requireSuperAdmin();
  const email = String(formData.get("email") ?? "");
  const newEmail = String(formData.get("newEmail") ?? "");
  const res = await setUserEmail(me.email, email, newEmail);
  if (!res.ok) back(res.error === "formato" ? "email" : res.error ?? "db");
  revalidatePath("/admin/utenti");
  back("", "email");
}

export async function resetUserPasswordAction(formData: FormData) {
  const me = await requireSuperAdmin();
  const email = String(formData.get("email") ?? "");
  const res = await resetUserPassword(me.email, email);
  if (!res.ok) back(res.error ?? "db");
  revalidatePath("/admin/utenti");
  // La password temporanea NON viaggia nell'URL (la cronologia del browser,
  // i referer e i log intermedi non devono vederla): viene stipata lato
  // server, cifrata, con audience = solo l'attore che ha compiuto l'azione.
  // Il redirect porta un FLAG opaco (?note=<id> senza valore): la pagina
  // rivendica la nota UNA volta (claim atomico) e la mostra come «da copiare
  // ora». Nessun log server registra la password: solo l'evento in audit.
  const noteId = await stashNote({
    payload: res.tempPassword ?? "",
    actorEmail: me.email,
    audience: [me.email],
  });
  if (!noteId) {
    // Niente nota stashabile (es. DB momentaneo): esito generico, nessun
    // segreto nell'URL. Il super admin può rilanciare il reset.
    back("", "reset_senza_nota");
  }
  redirect(`/admin/utenti?ok=reset&note=${encodeURIComponent(noteId)}&email=${encodeURIComponent(email)}`);
}

export async function deleteUserAction(formData: FormData) {
  const me = await requireSuperAdmin();
  const email = String(formData.get("email") ?? "");
  const res = await deleteUser(me.email, email);
  if (!res.ok) back(res.error ?? "db");
  revalidatePath("/admin/utenti");
  back("", "cancellato");
}
