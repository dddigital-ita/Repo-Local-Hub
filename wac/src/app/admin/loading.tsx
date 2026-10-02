export default function AdminLoading() {
  return (
    <div className="admin-skeleton space-y-6" aria-busy="true" aria-live="polite">
      {/* Header: icona + titolo come le pagine reali, senza testo che cambia. */}
      <div className="flex items-center gap-2.5">
        <span className="h-6 w-6 animate-pulse rounded-lg bg-white/60 ring-1 ring-white/60" />
        <span className="h-7 w-40 animate-pulse rounded-lg bg-white/60 ring-1 ring-white/60" />
      </div>

      {/* Hub di schede (Panoramica, Gestione, Impostazioni, Tools): stesse
          proporzioni delle card reali, così il passaggio skeleton → pagina
          non «salta». Due righe bastano: il contenuto vero sostituisce il
          resto senza reposizionamenti percepiti. */}
      <div className="space-y-3">
        {[0, 1].map((row) => (
          <div
            key={row}
            className="rounded-3xl bg-white/55 p-4 ring-1 ring-white/60"
            style={{ animation: "wac-pulse 1.6s ease-in-out infinite", animationDelay: `${row * 0.15}s` }}
            data-skeleton
          >
            <div className="flex items-center gap-2">
              <span className="h-8 w-8 rounded-2xl bg-white ring-1 ring-slate-900/5" />
              <span className="h-4 w-44 rounded-md bg-white/80" />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[0, 1, 2, 3].map((card) => (
                <div
                  key={card}
                  className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/60"
                  style={{ animation: "wac-pulse 1.6s ease-in-out infinite", animationDelay: `${0.1 * card}s` }}
                  data-skeleton
                >
                  <span className="block h-4 w-2/3 rounded-md bg-white/80" />
                  <span className="mt-2 block h-3 w-full rounded-md bg-white/50" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <span className="sr-only">Caricamento…</span>
    </div>
  );
}
