import AdminToaster from "@/components/admin-toaster";
import AdminNav from "@/components/admin-nav";
import { getAdminUser } from "@/lib/admin";
import { getAppUser } from "@/lib/users";

export const metadata = { title: "Admin", robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getAdminUser();
  // Il ruolo serve alla nav (voce Utenti solo per i super admin): una query in
  // più per richiesta, accettabile — è il pannello, non la pagina pubblica.
  const appUser = user ? await getAppUser() : null;

  return (
    <main className="aurora min-h-screen">
      {user && <AdminToaster />}
      {user && <AdminNav email={user.email} role={appUser?.role} />}
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">{children}</div>
    </main>
  );
}
