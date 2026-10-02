import { Users, UserPlus, KeyRound, ShieldOff, Trash2, ShieldCheck, Info, Mail, CircleAlert } from "lucide-react";
import { listUsers, requireSuperAdmin } from "@/lib/users";
import { claimNote } from "@/lib/note";
import { CopyNoteButton, ClaimCleanup } from "@/components/note-claim-client";
import { GlassCard as Card } from "@/components/glass";
import { createUserAction, setUserRoleAction, setUserActiveAction, setUserEmailAction, resetUserPasswordAction, deleteUserAction } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  email: "Email non valida.",
  corta: "La password deve avere almeno 8 caratteri.",
  esiste: "Esiste già un account con questa email.",
  self: "Non puoi compiere questa azione sul tuo stesso account.",
  ultimo_super: "Operazione negata: è l'ultimo super admin attivo.",
  inesistente: "Utente non trovato: forse è stato già cancellato.",
  permessi: "Azione riservata ai super admin.",
  db: "Database non disponibile, riprova.",
};

const OK: Record<string, string> = {
  creato: "Account creato: comunicalo all'interessato.",
  ruolo: "Ruolo aggiornato.",
  attivato: "Account riattivato: può rientrare subito.",
  disattivato: "Account disattivato: le sue sessioni sono morte all'istante.",
  email: "Email aggiornata: l'utente entra con la nuova (le sue sessioni precedenti sono scadute).",
  cancellato: "Account cancellato.",
  reset_senza_nota:
    "Password reimpostata, ma la nota temporanea non è stata generata (database momentaneamente occupato): rilancia il reset per riceverla.",
};

export default async function UtentiPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; ok?: string; note?: string; email?: string }>;
}) {
  // Guardia server-side: questa pagina è solo per super admin (i non abilitati
  // vengono reindirizzati — redirect di requireSuperAdmin, MAI avvolto in
  // try/catch: intercetterebbe il NEXT_REDIRECT stesso).
  const me = await requireSuperAdmin();
  const { err, ok, note, email } = await searchParams;
  // Rivendica la nota UNA sola volta (delete atomico): solo l'attore che ha
  // compiuto il reset (audience = la sua email, verificata nel claim). Il
  // flag ?note=<id> nell'URL è opaco: nessun segreto viaggia in query.
  const noteClaim = note ? await claimNote(note, [me.email]) : null;
  const users = await listUsers();

  return (
    <div className="space-y-4">
      {/* Dopo il claim l'URL viene ripulito (replaceState): il flag ?note=
          consumato non resta in cronologia né riappare al refresh. */}
      {note && <ClaimCleanup />}
      <div className="flex items-start gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-white to-slate-50 shadow-sm ring-1 ring-slate-900/5">
          <Users className="size-5 text-brand-600" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Utenti</h1>
          <p className="text-sm text-slate-500">
            Chi entra al pannello, con quale ruolo. Le azioni qui finiscono nel registro di audit.
          </p>
        </div>
      </div>

      {err && (
        <p className="rounded-2xl bg-red-50/80 px-4 py-3 text-sm font-medium text-red-800 ring-1 ring-red-200/70">
          {ERRORS[err] ?? "Operazione non riuscita."}
        </p>
      )}

      {noteClaim?.ok && noteClaim.payload ? (
        <div className="rounded-2xl bg-amber-50/90 px-4 py-4 ring-1 ring-amber-200/80">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-900">
            <KeyRound className="size-4" aria-hidden /> Password temporanea per {email ?? "l’utente"}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            Copiala ora e comunicala in modo sicuro: <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono font-bold">{noteClaim.payload}</code>{" "}
            — non verrà mostrata di nuovo.
          </p>
          <CopyNoteButton value={noteClaim.payload} />
        </div>
      ) : noteClaim && !noteClaim.ok ? (
        <p className="flex items-start gap-2 rounded-2xl bg-amber-50/80 px-4 py-3 text-sm font-medium text-amber-800 ring-1 ring-amber-200/70">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          La nota con la password temporanea non è più disponibile: scaduta, già vista o aperta da un’altra scheda.
          Reimposta la password per generarne una nuova.
        </p>
      ) : (
        ok && (
          <p className="rounded-2xl bg-emerald-50/80 px-4 py-3 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200/70">
            {OK[ok] ?? "Operazione completata."}
          </p>
        )
      )}

      {/* Crea account */}
      <Card className="p-6">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          <UserPlus className="size-4" aria-hidden /> Crea un account
        </h2>
        <form action={createUserAction} className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label htmlFor="nuova-email" className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Email
            </label>
            <input
              id="nuova-email"
              name="email"
              type="email"
              required
              autoComplete="off"
              placeholder="nome@webagencycrema.com"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div>
            <label htmlFor="nuova-pwd" className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Password iniziale
            </label>
            <input
              id="nuova-pwd"
              name="password"
              type="text"
              required
              minLength={8}
              autoComplete="off"
              placeholder="minimo 8 caratteri"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div>
            <label htmlFor="nuova-ruolo" className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Ruolo
            </label>
            <select
              id="nuova-ruolo"
              name="role"
              defaultValue="admin"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-brand-400"
            >
              <option value="admin">Admin</option>
              <option value="super_admin">Super admin</option>
            </select>
          </div>
          <div className="sm:col-span-4">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-500"
            >
              <UserPlus className="size-4" aria-hidden /> Crea account
            </button>
          </div>
        </form>
      </Card>

      {/* Lista utenti */}
      <div className="grid gap-3">
        {users.map((u) => {
          const self = u.email === me.email;
          // Nota: nessun «bottone disabilitato per l'ultimo super admin» qui:
          // sarebbe irraggiungibile (chi guarda è sempre lui stesso un super
          // attivo, e la propria card non offre azioni). La protezione vive
          // nel server (lib/users): backstop contro race e chiamate dirette.
          return (
            // data-user: aggancio stabile per i test E2E (un locator generico
            // su div annidati rischierebbe di beccare la card sbagliata).
            <Card key={u.email} className="p-5" data-user={u.email}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                    {u.displayName}
                    <span className="text-sm font-normal text-slate-400">{u.email}</span>
                    {self && (
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-brand-200/70">
                        tu
                      </span>
                    )}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`rounded-full px-2.5 py-1 font-semibold ring-1 ${
                        u.role === "super_admin"
                          ? "bg-violet-50/90 text-violet-700 ring-violet-200/70"
                          : "bg-slate-100/90 text-slate-600 ring-slate-200/70"
                      }`}
                    >
                      {u.role === "super_admin" ? "Super admin" : "Admin"}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 font-semibold ring-1 ${
                        u.active
                          ? "bg-emerald-50/90 text-emerald-700 ring-emerald-200/70"
                          : "bg-red-50/90 text-red-700 ring-red-200/70"
                      }`}
                    >
                      {u.active ? "attivo" : "disattivato"}
                    </span>
                    <span className="text-slate-400">dal {new Date(u.createdAt).toLocaleDateString("it-IT")}</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {u.firstName || u.lastName
                      ? `${u.firstName} ${u.lastName}`.trim()
                      : <span className="text-slate-400">anagrafica non compilata</span>}
                    {u.phone && <span> · {u.phone}</span>}
                  </p>
                </div>

                {/* Azioni: mai sul proprio account (server le rifiuta comunque) */}
                {!self && (
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={setUserRoleAction}>
                      <input type="hidden" name="email" value={u.email} />
                      <input type="hidden" name="role" value={u.role === "super_admin" ? "admin" : "super_admin"} />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-white"
                      >
                        <ShieldCheck className="size-3.5" aria-hidden />
                        {u.role === "super_admin" ? "Declassa ad admin" : "Promuovi a super admin"}
                      </button>
                    </form>
                    <form action={setUserActiveAction}>
                      <input type="hidden" name="email" value={u.email} />
                      <input type="hidden" name="active" value={u.active ? "0" : "1"} />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-white"
                      >
                        <ShieldOff className="size-3.5" aria-hidden />
                        {u.active ? "Disattiva" : "Riattiva"}
                      </button>
                    </form>
                    {/* Cambia email: inline, una per card (l'email è l'identità
                        di login; le sessioni dell’utente muoiono col vecchio payload). */}
                    <details className="w-full sm:w-auto">
                      <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-white">
                        <Mail className="size-3.5" aria-hidden /> Cambia email
                      </summary>
                      <form action={setUserEmailAction} className="mt-2 flex items-center gap-2 rounded-2xl bg-white/70 p-2 ring-1 ring-slate-200">
                        <input type="hidden" name="email" value={u.email} />
                        <input
                          type="email"
                          name="newEmail"
                          required
                          defaultValue=""
                          placeholder="nuova@email.it"
                          aria-label={`Nuova email per ${u.email}`}
                          className="w-48 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
                        />
                        <button
                          type="submit"
                          className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700"
                        >
                          Salva
                        </button>
                      </form>
                    </details>
                    <form action={resetUserPasswordAction}>
                      <input type="hidden" name="email" value={u.email} />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-white"
                      >
                        <KeyRound className="size-3.5" aria-hidden /> Reset password
                      </button>
                    </form>
                    <form action={deleteUserAction}>
                      <input type="hidden" name="email" value={u.email} />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1.5 rounded-full bg-red-50/90 px-3 py-1.5 text-xs font-semibold text-red-700 ring-1 ring-red-200/80 transition hover:bg-red-100/90"
                      >
                        <Trash2 className="size-3.5" aria-hidden /> Cancella
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <p className="flex items-start gap-2 text-xs text-slate-400">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Un account disattivato non può più fare login e le sue sessioni muoiono subito. La cancellazione è definitiva:
        l&apos;audit log conserva le azioni fatte con quell&apos;account.
      </p>
    </div>
  );
}
