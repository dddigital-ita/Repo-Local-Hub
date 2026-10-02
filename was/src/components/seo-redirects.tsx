"use client";

import { useState } from "react";
import { ArrowRight, Link2, Trash2 } from "lucide-react";
import { GlassButton, GlassStatus } from "@/components/glass";
import { addSeoRedirectAction, deleteSeoRedirectAction } from "@/app/admin/actions";

/**
 * Gestione redirect 301: la mappa «vecchio URL → nuovo URL» che tiene il
 * posizionamento quando una pagina cambia indirizzo. Solo path interni
 * (la validazione server blocca domini esterni: open redirect).
 */

export interface RedirectRow {
  from: string;
  to: string;
  createdAt: string;
}

export default function SeoRedirects({ redirects }: { redirects: RedirectRow[] }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const fromSlug = from.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
  const valid = fromSlug.length > 0 && to.startsWith("/") && !to.includes(" ");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-brand-600" aria-hidden />
          <h3 className="font-semibold text-slate-900">Redirect 301</h3>
          <GlassStatus ok={redirects.length > 0} label={redirects.length > 0 ? `${redirects.length} attivi` : "nessuno"} />
        </div>
      </div>
      <p className="text-xs leading-relaxed text-slate-500">
        Quando una pagina cambia indirizzo, il redirect 301 dice a Google «si è trasferita qui» e trasferisce il
        posizionamento. Scrivi la sorgente senza barra iniziale; la destinazione deve iniziare con «/».
      </p>

      {redirects.length > 0 && (
        <ul className="space-y-1.5">
          {redirects.map((r) => (
            <li
              key={r.from}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/55 px-3 py-2 text-sm ring-1 ring-white/60"
            >
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{r.from}</code>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-brand-500" aria-hidden />
                <code className="rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-800">{r.to}</code>
              </span>
              <form action={deleteSeoRedirectAction}>
                <input type="hidden" name="from" value={r.from} />
                <button
                  type="submit"
                  aria-label={`Elimina il redirect da ${r.from}`}
                  className="rounded-full p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={addSeoRedirectAction} className="rounded-2xl bg-white/45 p-3 ring-1 ring-white/50">
        <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
          <label className="block text-xs font-semibold text-slate-600">
            Vecchio URL
            <div className="mt-1 flex items-center gap-1.5">
              <span className="text-xs text-slate-400">/</span>
              <input
                name="from"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="vecchia-pagina"
                className="w-full rounded-xl border border-white/70 bg-white/65 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:bg-white"
              />
            </div>
          </label>
          <ArrowRight className="mb-2.5 hidden h-4 w-4 text-slate-400 sm:block" aria-hidden />
          <label className="block text-xs font-semibold text-slate-600">
            Nuovo URL
            <input
              name="to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="/nuova-pagina"
              className="mt-1 w-full rounded-xl border border-white/70 bg-white/65 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:bg-white"
            />
          </label>
          <GlassButton type="submit" size="sm" disabled={!valid}>
            Aggiungi
          </GlassButton>
        </div>
        {!valid && (from.length > 0 || to.length > 0) && (
          <p className="mt-2 text-[11px] text-amber-600">
            {to && !to.startsWith("/") ? "La destinazione deve iniziare con «/»." : "Compila entrambi i campi."}
          </p>
        )}
      </form>
    </div>
  );
}
