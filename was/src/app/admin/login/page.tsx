import type { Metadata } from "next";
import { loginAction } from "../actions";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/admin";
import { Container } from "@/components/ui";
import LoginCard from "@/components/login-card";
import TurnstileWidget from "@/components/turnstile-widget";
import TurnstileLoginField from "@/components/turnstile-login-field";
import { activeTurnstileSiteKey } from "@/lib/turnstile";

export const metadata: Metadata = { title: "Login team", robots: { index: false } };

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (await getAdminUser()) redirect("/admin");
  const captchaSiteKey = await activeTurnstileSiteKey();
  return (
    <main>
      {captchaSiteKey && <TurnstileWidget siteKey={captchaSiteKey} containerId="wac-turnstile-login" />}
      <Container className="flex min-h-[80vh] max-w-md flex-col justify-center py-16">
        <LoginCard className="glass p-8">
        <h1 className="text-2xl font-bold text-slate-900">Area team</h1>
        <p className="mt-1 text-sm text-slate-500">
          Accesso riservato al team: gli account sono creati dai super admin in Utenti.
        </p>
        {error && (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}
        <form action={loginAction} className="mt-6 space-y-4">
          {captchaSiteKey && <TurnstileLoginField />}
          <div>
            <label htmlFor="email" className="text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="mt-1 w-full rounded-2xl border border-white/50 bg-white/50 px-3 py-2.5 text-sm outline-none backdrop-blur-xl transition focus:border-brand-400/70 focus:bg-white/70"
            />
          </div>
          <div>
            <label htmlFor="password" className="text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="mt-1 w-full rounded-2xl border border-white/50 bg-white/50 px-3 py-2.5 text-sm outline-none backdrop-blur-xl transition focus:border-brand-400/70 focus:bg-white/70"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-full bg-brand-600/90 px-5 py-3 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-brand-500/90"
          >
            Entra
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-500">
          <Link href="/admin/password-dimenticata" className="font-medium text-brand-700 hover:underline">
            Password dimenticata?
          </Link>
        </p>
        </LoginCard>
      </Container>
    </main>
  );
}
