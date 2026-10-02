"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowRight, CornerDownLeft, Search, X } from "lucide-react";
import { filterDestinations } from "@/lib/admin-destinations";

/**
 * Command palette dell'admin (⌘K / Ctrl+K): salto diretto a qualsiasi
 * scheda di Tools, Impostazioni e Ambrosio più le aree della nav.
 *
 * PORTALE SU document.body — decisione del 2026-09-26: il dialogo è montato
 * nella nav, dentro `.glass-strong` che ha backdrop-filter; per spec CSS un
 * antenato con backdrop-filter (o filter/transform) diventa CONTAINING BLOCK
 * dei figli position:fixed, quindi l'overlay «fixed inset-0» si dimensionava
 * sulla sola nav invece che sul viewport (bug visibile: la pagina sotto
 * restava brillante e cliccabile). Il portale sposta il dialogo fuori da
 * ogni antenato «contaminante»: fixed vale di nuovo il viewport.
 *
 * Accessibilità (WCAG, pattern dialog+combobox): ruolo dialog con aria-modal,
 * focus intrappolato nell'input, lista aria-activedescendant, ↓/↑ per muoversi,
 * Enter per aprire, Esc per chiudere, click fuori per chiudere. Il body smette
 * di scrollare mentre è aperta; al ritorno il focus torna al trigger.
 */

const GROUP_ORDER = ["Panoramica", "Gestione", "Ambrosio AI", "Impostazioni", "Tools", "Integrazioni", "Sistema"] as const;

export default function AdminCommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const results = useMemo(() => filterDestinations(query), [query]);

  // Raggruppa mantenendo l'ordine canonico del catalogo.
  const grouped = useMemo(() => {
    const map = new Map<string, typeof results>();
    for (const d of results) {
      const arr = map.get(d.group) ?? [];
      arr.push(d);
      map.set(d.group, arr);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ group: g, items: map.get(g)! }));
  }, [results]);

  // Apertura: il reset di query/attivo non serve (query parte "" e la
  // selezione si riallinea da sola all'apertura — useEffect sotto); il focus
  // nell'input è nativo via autoFocus sul campo (nessun setState in effect).
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    // Il focus torna al trigger (pattern dialog): chi è arrivato da tastiera
    // non resta «perso» nel vuoto.
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  // Scorciatoia globale ⌘K / Ctrl+K (esclusi i campi testo: ⌘K in un input
  // dell'app resta libero per le sue funzioni native).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      go(results[active].href);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  // Selezione DERIVATA con firma (open + query): cambia la firma (riapertura
  // o nuova ricerca) → l'attivo torna 0 senza setState in effect; le frecce
  // tengono la firma corrente, quindi la selezione dell'utente persiste.
  const [sel, setSel] = useState<{ sig: string; active: number }>({ sig: "closed", active: 0 });
  const sig = open ? `o:${query}` : "closed";
  const active = sel.sig === sig ? sel.active : 0;
  const moveActive = (dir: 1 | -1) =>
    setSel((s) => {
      const base = s.sig === sig ? s.active : 0;
      return { sig, active: Math.max(0, Math.min(base + dir, results.length - 1)) };
    });

  // Scroll della voce attiva in vista quando ci si muove da tastiera.
  useEffect(() => {
    document.getElementById(`cmd-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/50 bg-white/55 px-3 py-1.5 text-xs font-medium text-slate-500 backdrop-blur-xl transition hover:bg-white/85 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        title="Cerca una scheda (⌘K)"
      >
        <Search className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden sm:inline">Vai a…</span>
        <kbd className="hidden rounded-md border border-slate-200/80 bg-white/80 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-slate-500 sm:inline">⌘K</kbd>
      </button>

      {open &&
        createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-900/40 px-4 pt-[12vh] backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label="Vai a una scheda dell'admin"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          onKeyDown={onKeyDown}
        >
          {/* Due livelli: la base opaca porta la leggibilità (glass-strong
              è al 72% e da mobile lascia trasparire la pagina), il vetro sopra
              dà il look del design system senza rinunciare al contrasto. */}
          <div className="w-full max-w-lg overflow-hidden rounded-3xl shadow-glass ring-1 ring-slate-900/10">
            <div className="rounded-3xl bg-white">
            {/* Campo di ricerca */}
            <div className="flex items-center gap-2.5 border-b border-white/50 px-4 py-3">
              <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                autoFocus
                aria-expanded="true"
                aria-controls="admin-command-list"
                aria-activedescendant={results[active] ? `cmd-opt-${active}` : undefined}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cerca una scheda: sla, smtp, faq, tema…"
                className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-500 outline-none"
              />
              <button
                type="button"
                onClick={close}
                aria-label="Chiudi la ricerca"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-white/70 hover:text-slate-900"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {/* Risultati raggruppati */}
            <div id="admin-command-list" role="listbox" aria-label="Destinazioni" className="max-h-[52vh] overflow-y-auto p-2">
              {grouped.map(({ group, items }) => (
                <div key={group} className="relative">
                  <p className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">{group}</p>
                  {items.map((d) => {
                    const i = results.indexOf(d);
                    const isActive = i === active;
                    return (
                      <div
                        key={d.href}
                        id={`cmd-opt-${i}`}
                        role="option"
                        aria-selected={isActive}
                        tabIndex={-1}
                        onMouseEnter={() => setSel({ sig, active: i })}
                        // onMouseDown (non onClick): evita che il blur dell'input
                        // «mangia» il click su touch e rende il gesto più reattivo.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          go(d.href);
                        }}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-2xl px-2.5 py-2 text-sm transition ${
                          isActive ? "bg-white font-semibold text-slate-900 ring-1 ring-slate-200/70" : "text-slate-600"
                        }`}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/70 text-slate-700 ring-1 ring-slate-900/5">
                          <d.Icon className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{d.label}</span>
                        <ArrowRight
                          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition ${isActive ? "opacity-100" : "opacity-0"}`}
                          aria-hidden
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
              {results.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-slate-500">
                  Nessuna scheda per «{query}»: prova con «sla», «smtp» o «faq».
                </p>
              )}
            </div>

            {/* Footer: i gesti, chiari */}
            <div className="flex items-center gap-4 border-t border-white/50 px-4 py-2.5 text-[10px] font-medium text-slate-500">
              <span className="inline-flex items-center gap-1">
                <kbd className="rounded-md border border-slate-200/80 bg-white/80 px-1 py-0.5 font-sans">↑↓</kbd> scegli
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd className="rounded-md border border-slate-200/80 bg-white/80 px-1 py-0.5 font-sans">
                  <CornerDownLeft className="h-2.5 w-2.5" aria-hidden />
                </kbd> apri
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd className="rounded-md border border-slate-200/80 bg-white/80 px-1 py-0.5 font-sans">esc</kbd> chiudi
              </span>
            </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
