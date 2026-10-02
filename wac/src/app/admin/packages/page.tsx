import Link from "next/link";
import { Camera, Copy, Package, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { listPackages, type CatalogKind, type PackageRow } from "@/lib/packages";
import { deletePackage, duplicatePackage, savePackage, togglePackage } from "../actions";
import { GlassButton, GlassCard as Card } from "@/components/glass";

export const dynamic = "force-dynamic";

function PackageForm({ pkg, kind = "package" }: { pkg?: PackageRow; kind?: CatalogKind }) {
  const effectiveKind = pkg?.kind ?? kind;
  const isService = effectiveKind === "service";
  return (
    <form action={savePackage} className="space-y-2.5">
      {pkg?.id && <input type="hidden" name="id" value={pkg.id} />}
      <input type="hidden" name="kind" value={effectiveKind} />
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="block text-xs font-medium text-slate-500">
          Nome*
          <input
            name="name"
            required
            defaultValue={pkg?.name ?? ""}
            placeholder={isService ? "Es. Servizio Fotografico" : "Es. Sito Vetrina"}
            className="mt-1 w-full rounded-xl border border-white/60 bg-white/70 px-3 py-2 text-sm text-slate-800 outline-none backdrop-blur-xl focus:border-brand-400"
          />
        </label>
        <label className="block text-xs font-medium text-slate-500">
          Prezzo*
          <input
            name="price_text"
            required
            defaultValue={pkg?.price_text ?? ""}
            placeholder='Es. da 800 € una tantum'
            className="mt-1 w-full rounded-xl border border-white/60 bg-white/70 px-3 py-2 text-sm text-slate-800 outline-none backdrop-blur-xl focus:border-brand-400"
          />
        </label>
      </div>
      <label className="block text-xs font-medium text-slate-500">
        Frase di vendita (cosa dice Ambrosio in chat)
        <input
          name="tagline"
          defaultValue={pkg?.tagline ?? ""}
          placeholder="Es. Il biglietto da visita online, pronto in 7 giorni."
          className="mt-1 w-full rounded-xl border border-white/60 bg-white/70 px-3 py-2 text-sm text-slate-800 outline-none backdrop-blur-xl focus:border-brand-400"
        />
      </label>
      <label className="block text-xs font-medium text-slate-500">
        Cosa include (una voce per riga, max 8)
        <textarea
          name="includes"
          rows={3}
          defaultValue={pkg?.includes?.join("\n") ?? ""}
          placeholder={"fino a 5 pagine\ndesign responsive\nSEO base"}
          className="mt-1 w-full resize-none rounded-xl border border-white/60 bg-white/70 px-3 py-2 text-sm text-slate-800 outline-none backdrop-blur-xl focus:border-brand-400"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          Ordine
          <input
            name="sort_order"
            type="number"
            defaultValue={pkg?.sort_order ?? 50}
            className="w-16 rounded-lg border border-white/60 bg-white/70 px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-brand-400"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <input
            name="active"
            type="checkbox"
            defaultChecked={pkg ? pkg.active : true}
            className="h-4 w-4 accent-[#34C759]"
          />
          Attivo (Ambrosio lo propone)
        </label>
        <GlassButton type="submit" size="sm" className="ml-auto">
          {pkg ? "Salva modifiche" : isService ? "Crea servizio" : "Crea pacchetto"}
        </GlassButton>
      </div>
    </form>
  );
}

export default async function PackagesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireAdmin();
  const pool = db();
  if (!pool)
    return <p className="text-sm text-red-600">Database non configurato (vedi SETUP.md → Neon).</p>;

  const { tab } = await searchParams;
  const kind: CatalogKind = tab === "servizi" ? "service" : "package";
  const isServiceTab = kind === "service";
  const rows = await listPackages(false, kind);
  // la modifica usa i <details> per pacchetto: nessun id in editing

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold text-slate-900">
          <Package className="h-6 w-6 text-brand-600" aria-hidden />
          {isServiceTab ? "Servizi da vendere" : "Pacchetti da vendere"}
        </h1>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
          <Sparkles className="h-3.5 w-3.5 text-violet-500" aria-hidden />
          {isServiceTab
            ? "Ambrosio propone questi servizi quando il cliente cerca un'attività da eseguire: foto, video, assistenza."
            : "Ambrosio propone questi pacchetti in chat quando il cliente valuta un preventivo."}
        </p>
      </div>

      {/* Tab dei due cataloghi (server-side, statali via searchParam) */}
      <div className="flex gap-2" role="tablist" aria-label="Cataloghi">
        <Link
          href="/admin/packages"
          role="tab"
          aria-selected={!isServiceTab}
          className={isServiceTab ? "glass rounded-full px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-white/70" : "rounded-full bg-brand-600/90 px-4 py-2 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl"}
        >
          <Package className="mr-1.5 inline h-4 w-4" aria-hidden />
          Pacchetti
        </Link>
        <Link
          href="/admin/packages?tab=servizi"
          role="tab"
          aria-selected={isServiceTab}
          className={isServiceTab ? "rounded-full bg-brand-600/90 px-4 py-2 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl" : "glass rounded-full px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-white/70"}
        >
          <Camera className="mr-1.5 inline h-4 w-4" aria-hidden />
          Servizi
        </Link>
      </div>

      <div className="grid gap-3">
        {rows.map((p) => (
          <Card key={p.id} className={p.active ? "" : "opacity-70"}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">
                  {p.name}
                  <span className="ml-2 rounded-full bg-brand-50/90 px-2 py-0.5 text-xs font-semibold text-brand-700">
                    {p.price_text}
                  </span>
                  {!p.active && (
                    <span className="ml-2 rounded-full bg-slate-200/90 px-2 py-0.5 text-xs font-semibold text-slate-500">
                      spento
                    </span>
                  )}
                </p>
                {p.tagline && <p className="mt-0.5 text-sm text-slate-600">{p.tagline}</p>}
                {!!p.includes?.length && (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {p.includes.map((inc, i) => (
                      <li
                        key={i}
                        className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-white/60"
                      >
                        {inc}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex items-center gap-2">
                <form action={togglePackage}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="next" value={p.active ? "false" : "true"} />
                  <GlassButton type="submit" variant="glass" size="sm" className={p.active ? "bg-green-100/90 text-green-700 hover:bg-green-200" : "bg-slate-200/90 text-slate-500 hover:bg-slate-300"}>
                    {p.active ? "Attivo" : "Spento"}
                  </GlassButton>
                </form>
                <form action={duplicatePackage}>
                  <input type="hidden" name="id" value={p.id} />
                  <button
                    aria-label={`Duplica ${p.name}`}
                    title="Duplica (spento, da modificare)"
                    className="rounded-full p-2 text-slate-400 transition hover:bg-brand-50 hover:text-brand-600"
                  >
                    <Copy className="h-4 w-4" aria-hidden />
                  </button>
                </form>
                <form action={deletePackage}>
                  <input type="hidden" name="id" value={p.id} />
                  <button
                    aria-label={`Elimina ${p.name}`}
                    className="rounded-full p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </form>
              </div>
            </div>
            <details className="mt-3">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-brand-700">
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                Modifica
              </summary>
              <div className="mt-3 border-t border-white/60 pt-3">
                <PackageForm pkg={p} />
              </div>
            </details>
          </Card>
        ))}
        {!rows.length && (
          <p className="rounded-2xl glass-solid p-4 text-sm text-slate-500">
            {isServiceTab
              ? "Nessun servizio: i 4 di esempio arrivano con la migration 035 al primo avvio, oppure creane uno qui sotto."
              : "Nessun pacchetto: creane il primo qui sotto."}
          </p>
        )}
      </div>

      <Card>
        <h2 className="flex items-center gap-1.5 text-base font-bold text-slate-900">
          <Plus className="h-4 w-4 text-brand-600" aria-hidden />
          {isServiceTab ? "Nuovo servizio" : "Nuovo pacchetto"}
        </h2>
        <div className="mt-3">
          <PackageForm kind={kind} />
        </div>
      </Card>

      <p className="text-xs text-slate-400">
        {isServiceTab
          ? "I servizi attivi vengono letti da Ambrosio a ogni risposta: li propone quando il cliente cerca un'attività da eseguire."
          : "I pacchetti attivi vengono letti da Ambrosio a ogni risposta: le modifiche valgono subito, senza riavvii."}
      </p>
    </div>
  );
}
