import { redirect } from "next/navigation";
import Link from "next/link";
import { Mail, Phone, MapPin, BadgeCheck, ShieldCheck, KeyRound, Users, AtSign } from "lucide-react";
import { getAppUser } from "@/lib/users";
import { GlassCard as Card } from "@/components/glass";
import ProfileForm from "@/components/profile-form";
import { changeEmailAction } from "./actions";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin — gestisce il sito e gli utenti",
  admin: "Admin — accesso al pannello",
};

const EMAIL_ERRORS: Record<string, string> = {
  email_credenziali: "Password non corretta: l'email non è stata cambiata.",
  email_formato: "La nuova email non ha un formato valido.",
  email_esiste: "Esiste già un account con questa email.",
  email_db: "Database non disponibile, riprova.",
};

export default async function ProfiloPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; ok?: string }>;
}) {
  // getAppUser copre anche la non-autenticazione e l'account disattivato:
  // getAdminUser (dentro) vale null in entrambi i casi → redirect al login.
  const { err, ok } = await searchParams;
  const user = await getAppUser();
  if (!user) redirect("/admin/login");

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-white to-slate-50 shadow-sm ring-1 ring-slate-900/5">
          <BadgeCheck className="size-5 text-brand-600" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Area personale</h1>
          <p className="text-sm text-slate-500">
            I tuoi dati: restano sul tuo account e servono a fatturazione, contatti e firma dei documenti.
          </p>
        </div>
      </div>

      {/* Scheda identità: email, ruolo, stato — non editabili qui */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-semibold text-slate-900">
              <Mail className="size-4 text-slate-400" aria-hidden />
              {user.email}
            </p>
            <p className="mt-1.5 flex items-center gap-2 text-sm text-slate-600">
              <ShieldCheck className="size-4 text-slate-400" aria-hidden />
              {ROLE_LABEL[user.role] ?? user.role}
            </p>
            <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">
              <Phone className="size-4 text-slate-400" aria-hidden />
              {user.phone ? user.phone : <span className="text-slate-400">Telefono non compilato</span>}
            </p>
            <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">
              <MapPin className="size-4 text-slate-400" aria-hidden />
              {user.address || user.city ? (
                <span>
                  {user.address}
                  {user.address && user.city ? ", " : ""}
                  {user.city} {user.province && `(${user.province})`}
                </span>
              ) : (
                <span className="text-slate-400">Indirizzo non compilato</span>
              )}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2 text-xs">
            <span
              className={`rounded-full px-3 py-1.5 font-semibold ring-1 ${
                user.role === "super_admin"
                  ? "bg-violet-50/90 text-violet-700 ring-violet-200/70"
                  : "bg-slate-100/90 text-slate-600 ring-slate-200/70"
              }`}
            >
              {user.role === "super_admin" ? "Super admin" : "Admin"}
            </span>
            <span className="rounded-full bg-emerald-50/90 px-3 py-1.5 font-semibold text-emerald-700 ring-1 ring-emerald-200/70">
              Account attivo
            </span>
          </div>
        </div>
      </Card>

      {ok === "email" && (
        <p className="rounded-2xl bg-emerald-50/80 px-4 py-3 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200/70">
          Email aggiornata: da ora entri con la nuova (questa sessione è già stata rinnovata).
        </p>
      )}
      {err && EMAIL_ERRORS[err] && (
        <p className="rounded-2xl bg-red-50/80 px-4 py-3 text-sm font-medium text-red-800 ring-1 ring-red-200/70">
          {EMAIL_ERRORS[err]}
        </p>
      )}

      {/* Cambio email: per TUTTI gli utenti (serve la password corrente). */}
      <Card className="p-6">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          <AtSign className="size-4" aria-hidden /> Cambia email di accesso
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          L&apos;email è il tuo nome utente: per cambiarla confermi la password attuale. Al termine questa sessione viene
          rinnovata con la nuova email; le altre sessioni scadono da sole.
        </p>
        <form action={changeEmailAction} className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="newEmail" className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Nuova email
            </label>
            <input
              id="newEmail"
              name="newEmail"
              type="email"
              required
              autoComplete="email"
              placeholder="nuova@email.it"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div>
            <label htmlFor="emailPassword" className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Password attuale
            </label>
            <input
              id="emailPassword"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              <Mail className="size-4" aria-hidden />
              Cambia email
            </button>
          </div>
        </form>
      </Card>

      {/* Anagrafica editabile */}
      <Card className="p-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Dati personali</h2>
        <ProfileForm
          initial={{
            firstName: user.firstName,
            lastName: user.lastName,
            vatNumber: user.vatNumber,
            fiscalCode: user.fiscalCode,
            phone: user.phone,
            address: user.address,
            city: user.city,
            province: user.province,
            postalCode: user.postalCode,
            bio: user.bio,
          }}
        />
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <KeyRound className="size-4 text-slate-400" aria-hidden /> Password e sessioni
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Cambia la password e controlla le sessioni attive del tuo account.
          </p>
          <Link href="/admin/sicurezza" className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline">
            Vai a Sicurezza →
          </Link>
        </Card>
        {user.role === "super_admin" && (
          <Card className="p-5">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Users className="size-4 text-slate-400" aria-hidden /> Gestione utenti
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Crea account, assegna ruoli, disattiva accessi e resetta le password del team.
            </p>
            <Link href="/admin/utenti" className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline">
              Vai a Utenti →
            </Link>
          </Card>
        )}
      </div>
    </div>
  );
}
