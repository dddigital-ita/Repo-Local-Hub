import { NextResponse } from "next/server";
import { logout } from "@/lib/admin";

/**
 * Route di logout (POST): cancella il cookie di sessione e manda al login.
 *
 * DIFETTO SUL VIVO (29/09): il logout era su GET e il link «Esci» nell'header
 * veniva PREFETCHATO da Next a idle — il prefetch eseguiva il GET del route
 * handler, che cancellava il cookie di sessione pochi secondi dopo ogni pagina
 * caricata. Risultato: login regge, primo click dopo → login di nuovo (il
 * cookie era già morto nel jar, nessun rigetto lato server: la guardia non
 * vedeva nemmeno un token da rifiutare). Il team finiva nel loop
 * login→click→login e beccava il rate limit.
 *
 * Ora: solo il POST (form reale nella nav) cancella la sessione. Il GET resta
 * come redirezione innocua per vecchi bookmark — MAI più un side-effect.
 */
export async function POST(req: Request) {
  await logout();
  return NextResponse.redirect(new URL("/admin/login", req.url), 303);
}

export async function GET(req: Request) {
  // Prefetch o click accidentale: nessun side-effect, solo si torna al login
  // (se c'è una sessione viva, sopravvive — il logout vero passa dal form POST).
  return NextResponse.redirect(new URL("/admin", req.url), 303);
}
