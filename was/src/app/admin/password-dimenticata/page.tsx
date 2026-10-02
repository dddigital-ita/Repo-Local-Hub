import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, MailCheck } from "lucide-react";
import { Container } from "@/components/ui";
import LoginCard from "@/components/login-card";
import TurnstileWidget from "@/components/turnstile-widget";
import TurnstileLoginField from "@/components/turnstile-login-field";
import { activeTurnstileSiteKey } from "@/lib/turnstile";
import { requestResetAction, confirmResetAction } from "./actions";

export const metadata: Metadata = { title: "Recupera password", robots: { index: false } };

const ERRORS: Record<string, string> = {
  token: "Link non valido o già usato: richiedine uno nuovo.",
  scaduto: "Il link è scaduto (dura 1 ora): richiedine uno nuovo.",
  validazione: "La password deve avere almeno 8 caratteri.",
  rate: "Troppe richieste da questo dispositivo: riprova più tardi.",
  // Neutro come le altre: non dice nulla sull'account, solo di riprovare.
  captcha: "Verifica di sicurezza non riuscita: ricarica la pagina e riprova.",
  db: "Servizio temporaneamente non disponibile: riprova.",
};

export default async function PasswordDimenticataPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; sent?: string; done?: string; err?: string }>;
}) {
  const { token, sent, done, err } = await searchParams;
  // L'endpoint è pubblico e invia email: bersaglio di spam. Il captcha
  // invisibile copre il form di richiesta (il form col token privato, no).
  const captchaSiteKey = await activeTurnstileSiteKey();

  return (
    <main>
      {captchaSiteKey && !token && (
        <TurnstileWidget siteKey={captchaSiteKey} containerId="wac-turnstile-reset" />
      )}
      <Container className="flex min-h-[80vh] max-w-md flex-col justify-center py-16">
        <LoginCard className="glass p-8">
          <h1 className="text-2xl font-bold text-slate-900">
            {token ? "Scegli una nuova password" : "Password dimenticata"}
          </h1>

          {done ? (
            <>
              <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                Password aggiornata. Ora entra con la nuova: le vecchie sessioni sono state disconnesse.
              </p>
              <Link
                href="/admin/login"
                className="mt-6 block w-full rounded-full bg-brand-600/90 px-5 py-3 text-center text-sm font-semibold text-white shadow-glass-btn transition hover:bg-brand-500/90"
              >
                Vai al login
              </Link>
            </>
          ) : token ? (
            <>
              <p className="mt-1 text-sm text-slate-500">Imposta la nuova password per il tuo account.</p>
              {err && (
                <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{ERRORS[err] ?? "Operazione non riuscita."}</p>
              )}
              <form action={confirmResetAction} className="mt-6 space-y-4">
                <input type="hidden" name="token" value={token} />
                <div>
                  <label htmlFor="newPassword" className="text-sm font-medium text-slate-700">
                    Nuova password
                  </label>
                  <input
                    id="newPassword"
                    name="newPassword"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-2xl border border-white/50 bg-white/50 px-3 py-2.5 text-sm outline-none backdrop-blur-xl transition focus:border-brand-400/70 focus:bg-white/70"
                  />
                </div>
                <div>
                  <label htmlFor="confirmPassword" className="text-sm font-medium text-slate-700">
                    Conferma nuova password
                  </label>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-2xl border border-white/50 bg-white/50 px-3 py-2.5 text-sm outline-none backdrop-blur-xl transition focus:border-brand-400/70 focus:bg-white/70"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full rounded-full bg-brand-600/90 px-5 py-3 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-brand-500/90"
                >
                  <KeyRound className="mr-1.5 inline size-4" aria-hidden />
                  Imposta password
                </button>
              </form>
            </>
          ) : sent ? (
            <>
              {/* Risposta NEUTRA: identica che l'email esista o no (anti-enumerazione). */}
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                Se questa email corrisponde a un account, dentro pochi minuti arriva il link per scegliere una nuova
                password (vale 1 ora, si usa una volta sola). Controlla anche lo spam.
              </p>
              <Link
                href="/admin/login"
                className="mt-6 block w-full rounded-full bg-brand-600/90 px-5 py-3 text-center text-sm font-semibold text-white shadow-glass-btn transition hover:bg-brand-500/90"
              >
                Torna al login
              </Link>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-slate-500">
                Inserisci la email dell&apos;account: ti mandiamo un link per scegliere una nuova password.
              </p>
              {err && (
                <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{ERRORS[err] ?? "Operazione non riuscita."}</p>
              )}
              <form action={requestResetAction} className="mt-6 space-y-4">
                {captchaSiteKey && <TurnstileLoginField />}
                <div>
                  <label htmlFor="email" className="text-sm font-medium text-slate-700">
                    Email dell&apos;account
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    className="mt-1 w-full rounded-2xl border border-white/50 bg-white/50 px-3 py-2.5 text-sm outline-none backdrop-blur-xl transition focus:border-brand-400/70 focus:bg-white/70"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full rounded-full bg-brand-600/90 px-5 py-3 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-brand-500/90"
                >
                  Inviami il link
                </button>
              </form>
              <p className="mt-4 text-center text-sm text-slate-500">
                <Link href="/admin/login" className="font-medium text-brand-700 hover:underline">
                  Torna al login
                </Link>
              </p>
            </>
          )}
        </LoginCard>
      </Container>
    </main>
  );
}
