import LogoutForm from "@/components/logout-form";

/**
 * Logout SENZA side-effect sul GET — la radice del bug visto su
 * WebAgencyCrema: qui prima viveva un Route Handler GET che cancellava il
 * cookie. Next prefetcha i link visibili quando il browser è idle: il
 * prefetch eseguiva il GET → logout() → la sessione moriva da sola pochi
 * secondi dopo ogni pagina caricata (rimbalzi silenziosi al login, nulla
 * in audit perché il cookie non c'era più).
 *
 * Ora il GET rende solo una pagina con form verso la server action
 * (POST): il prefetch può arrivare quanto vuole, non cancella niente.
 * Il JS auto-invia il form per chi arriva da qui di proposito (vecchi
 * link, segnalibri, test): senza JS resta il bottone «Esci» da premere.
 */
export const metadata = { robots: { index: false } };

export default function LogoutPage() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-bold text-slate-900">Uscita dall&apos;area team</h1>
      <p className="mt-2 text-sm text-slate-500">Chiusura della sessione in corso…</p>
      <LogoutForm />
    </div>
  );
}
