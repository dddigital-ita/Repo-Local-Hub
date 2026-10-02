import { headers } from "next/headers";
import { after } from "next/server";
import AdminToaster from "@/components/admin-toaster";
import AdminNav from "@/components/admin-nav";
import { getAdminUser } from "@/lib/admin";
import { getAppUser } from "@/lib/users";
import { logAdminRenderTime } from "@/lib/admin-telemetry";
import { risolviPath } from "@/lib/admin-perf";

export const metadata = { title: "Admin", robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Telemetria dei tempi di rendering (ADR-005): il tempo parte QUI, prima
  // dell'auth — copre il percorso vero del caricamento (auth + query + RSC).
  // Un middleware con performance.now() confronterebbe orologi diversi su
  // Vercel (edge vs Node): Date.now() nello stesso processo è comparabile
  // ovunque. La registrazione va in after(): la risposta non attende l'INSERT
  // (fire-and-forget come tutto l'audit).
  // Misurare il tempo È impuro di proposito: la regola purity di react-hooks
  // lo vieta per default, qui l'eccezione è documentata (il valore NON entra
  // nell'output: finisce in audit come durata, dopo la risposta).
  // eslint-disable-next-line react-hooks/purity
  const t0 = Date.now();
  const user = await getAdminUser();
  // Il ruolo serve alla nav (voce Utenti solo per i super admin): una query in
  // più per richiesta, accettabile — è il pannello, non la pagina pubblica.
  const appUser = user ? await getAppUser() : null;
  const h = await headers();
  // SOLO navigazioni vere: i prefetch RSC di Next (hover/viewport sulla nav
  // e sui link della coda) portano l'header «next-router-prefetch: 1» e sono
  // richieste da pochi ms — campionarli falserebbe la statistica. Anche i
  // prefetch espliciti (Sec-Purpose) sono fuori campione.
  if (h.get("next-router-prefetch") !== "1" && h.get("sec-purpose") !== "prefetch") {
    // Risoluzione onesta del path (vedi admin-perf.ts): l'edge proxy quando
    // lo espone, altrimenti il bucket /admin — mai il referer (è da DOVE
    // arriva il visitatore, non la pagina che sta renderizzando).
    const path = risolviPath(h);
    after(async () => {
      // eslint-disable-next-line react-hooks/purity -- vedi t0: misura intenzionale
      const ms = Date.now() - t0;
      await logAdminRenderTime({
        path,
        ms,
        email: user?.email ?? null,
      });
    });
  }

  return (
    <main className="aurora min-h-screen">
      {user && <AdminToaster />}
      {user && <AdminNav email={user.email} role={appUser?.role} />}
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">{children}</div>
    </main>
  );
}
