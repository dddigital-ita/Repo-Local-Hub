import { NextResponse } from "next/server";
import { logout } from "@/lib/admin";

/**
 * Route di logout (GET): cancella il cookie di sessione e manda al login.
 *
 * Era una pagina con form che puntava a una Server Action: il form non si
 * auto-inviava (nessun JS lo faceva partire) e il click su «Esci» lasciava
 * l'utente su /admin/logout con la sessione viva — scoperto dall'E2E.
 * Un Route Handler può scrivere cookie senza il vincolo dei Server Component:
 * GET idempotente, niente side-effect oltre al proprio logout.
 */
export async function GET(req: Request) {
  await logout();
  return NextResponse.redirect(new URL("/admin/login", req.url));
}
