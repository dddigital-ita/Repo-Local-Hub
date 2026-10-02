"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requestPasswordReset, confirmPasswordReset } from "@/lib/password-reset";
import { verifyTurnstile } from "@/lib/turnstile";
import { limit, clientIp } from "@/lib/rate-limit";

/**
 * Azioni del recupero password self-service.
 * La risposta della richiesta è SEMPRE neutra (redirect con ?sent=1): che
 * l'email esista o no il client vede lo stesso schermo — l'enumerazione
 * degli account resta impossibile anche misurando le risposte.
 *
 * L'endpoint è PUBBLICO e invia email: è un bersaglio di spam (bombardare
 * le caselle dell'agenzia). Difese in ordine: captcha invisibile (se
 * configurato) → rate limit → token monouso via email.
 */

export async function requestResetAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const ip = clientIp(await headers());
  // Captcha invisibile PRIMA del rate limit: un bot bloccato qui non consuma
  // il budget delle richieste. Come sul login: nessuna violazione Shield dal
  // blocco captcha (il widget è lazy, un timing sfavorevole non è un abuso) e
  // il messaggio NON rivela se l'email esiste (l'anti-enumerazione resta
  // integro anche sull'errore anti-bot).
  const ts = await verifyTurnstile(formData.get("turnstileToken"), ip);
  if (!ts.ok) {
    redirect("/admin/password-dimenticata?err=captcha");
  }
  // Anti-abuso: 3 richieste/ora per IP (il flusso via email è già lento per
  // design; il limite ferma lo spamming programmatico verso le caselle).
  const rl = limit("pw-reset", ip, 3, 60 * 60_000);
  if (!rl.ok) {
    redirect("/admin/password-dimenticata?err=rate");
  }
  await requestPasswordReset(email, ip);
  redirect("/admin/password-dimenticata?sent=1");
}

export async function confirmResetAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  if (newPassword !== confirm) {
    redirect(`/admin/password-dimenticata?token=${encodeURIComponent(token)}&err=validazione`);
  }
  const res = await confirmPasswordReset(token, newPassword);
  if (!res.ok) {
    redirect(`/admin/password-dimenticata?token=${encodeURIComponent(token)}&err=${res.error}`);
  }
  redirect("/admin/password-dimenticata?done=1");
}
