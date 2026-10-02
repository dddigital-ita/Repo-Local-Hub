import type { Metadata } from "next";
import { KeyRound, LogOut, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { requireAdmin, getAdminSessions } from "@/lib/admin";
import { changePasswordAction, refreshSessionAction } from "../actions";
import { Container, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Sicurezza", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Messaggi post-azione (redirect con query param, pattern delle altre schede). */
const ERRORS: Record<string, string> = {
  match: "Le due password nuove non coincido.",
  credenziali: "La password attuale non è corretta.",
  corta: "La nuova password è troppo corta: almeno 8 caratteri.",
  db: "Database non raggiungibile: riprova tra poco.",
};

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const user = await requireAdmin();
  const { ok, err } = await searchParams;
  const sessions = await getAdminSessions();

  return (
    <Container className="py-10">
      <div className="flex flex-wrap items-center gap-3 gap-y-2">
        <div className="grid size-11 place-items-center rounded-2xl bg-gradient-to-b from-white to-slate-50 shadow-sm ring-1 ring-slate-900/5">
          <ShieldCheck className="size-5 text-brand-600" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sicurezza dell&apos;account</h1>
          <p className="text-sm text-slate-500">
            Password e sessioni di {user.email}. Le sessioni portano l&apos;impronta della password: cambiarla disconnette
            subito tutte le altre.
          </p>
        </div>
      </div>

      {ok && (
        <p className="mt-6 rounded-2xl bg-emerald-50/80 px-4 py-3 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200/70">
          {ok === "1"
            ? "Password aggiornata: questa sessione è stata rinnovata, le altre sono state disconnesse."
            : "Sessione corrente rinnovata. Le altre restano valide finché non cambi la password."}
        </p>
      )}
      {err && (
        <p className="mt-6 rounded-2xl bg-red-50/80 px-4 py-3 text-sm font-medium text-red-800 ring-1 ring-red-200/70">
          {ERRORS[err] ?? "Operazione non riuscita."}
        </p>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Cambio password: la revoca delle altre sessioni è implicita nel
            fingerprint — nessun token da inseguire. */}
        <Card className="p-6">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            <KeyRound className="size-4" aria-hidden /> Cambia password
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Verifica la password attuale e ne imposta una nuova (minimo 8 caratteri). Al termine resti connesso da
            questa sessione; <strong className="text-slate-800">le altre sessioni del tuo account vengono disconnesse</strong>.
          </p>
          <form action={changePasswordAction} className="mt-4 space-y-3">
            <div>
              <label htmlFor="currentPassword" className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Password attuale
              </label>
              <input
                id="currentPassword"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                className="mt-1 w-full rounded-2xl border border-white/50 bg-white/70 px-3 py-2.5 text-sm outline-none backdrop-blur-xl focus:border-brand-400/70"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="newPassword" className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Nuova password
                </label>
                <input
                  id="newPassword"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  className="mt-1 w-full rounded-2xl border border-white/50 bg-white/70 px-3 py-2.5 text-sm outline-none backdrop-blur-xl focus:border-brand-400/70"
                />
              </div>
              <div>
                <label htmlFor="confirmPassword" className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Conferma nuova password
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  className="mt-1 w-full rounded-2xl border border-white/50 bg-white/70 px-3 py-2.5 text-sm outline-none backdrop-blur-xl focus:border-brand-400/70"
                />
              </div>
            </div>
            <button
              type="submit"
              className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
            >
              Aggiorna password
            </button>
          </form>
        </Card>

        {/* Sessioni attive: materie prime = log di audit (admin.login con
            impronta) + verifica contro la password_hash attuale. */}
        <Card className="p-6">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            <MonitorSmartphone className="size-4" aria-hidden /> Sessioni attive (ultime 12 ore)
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Un cookie firmato vale finché la sua impronta corrisponde alla password attuale: dopo un cambio password
            le righe restano qui ma sono già morte.
          </p>
          {sessions.length === 0 ? (
            <p className="mt-4 rounded-2xl bg-slate-50/80 px-4 py-3 text-sm text-slate-500">
              Nessuna sessione registrata: entra di nuovo dopo il prossimo login (le sessioni appaiono dal log di audit).
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {sessions.map((s) => (
                <li key={s.email} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/60 px-4 py-3 ring-1 ring-slate-900/5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{s.email}</p>
                    <p className="text-xs text-slate-500">
                      login delle {new Date(s.expiresAt - 12 * 60 * 60 * 1000).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })} ·
                      scade alle {new Date(s.expiresAt).toLocaleString("it-IT", { timeStyle: "short" })}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      s.current ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500 line-through"
                    }`}
                    title={
                      s.current
                        ? "l'impronta di questo login corrisponde alla password attuale: quel cookie, se esiste ancora, funziona"
                        : "la password è cambiata dopo questo login: quel cookie non vale più"
                    }
                  >
                    {s.current ? "valida" : "revocata dal cambio password"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form action={refreshSessionAction} className="mt-4">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white"
            >
              <LogOut className="size-4" aria-hidden />
              Rinnova solo questa sessione
            </button>
          </form>
        </Card>
      </div>
    </Container>
  );
}
