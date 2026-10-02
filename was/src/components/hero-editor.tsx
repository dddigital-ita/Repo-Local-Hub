"use client";

import { useEffect, useState } from "react";
import { saveHeroAction } from "@/app/admin/actions";
import { GlassButton } from "@/components/glass";
import {
  DEFAULT_HERO,
  HERO_CURSOR_META,
  HERO_CURSORS,
  HERO_FONT_LABELS,
  HERO_FONTS,
  HERO_GRADIENT_DIRECTIONS,
  HERO_GRADIENT_LABELS,
  HERO_TEMPLATES,
  HERO_TEMPLATE_META,
  heroVars,
} from "@/lib/hero-shared";
import type { HeroConfig, HeroFont, HeroGradientDirection, HeroTemplate } from "@/lib/hero-shared";
import { cn } from "@/components/ui";
import HeroCursorGlow from "./hero-cursor-glow";

/**
 * Editor dell'hero animato (tools → hero): 8 template (i 4 «serissimi» più
 * i 4 di nuova generazione con particelle, parallasse, dot-grid e aurora),
 * testi modificabili, font del titolo, colore accento, direzione della
 * sfumatura — e in fondo la sezione CURSORE con 4 temi minimali, colore
 * personalizzato e box di prova dal vivo. Anteprima live sulla home dietro
 * (variabili + data-attribute su documentElement, come fa ThemeEditor).
 * Salvataggio esplicito.
 */

interface Props {
  saved: HeroConfig;
  dbOk: boolean;
}

export default function HeroEditor({ saved, dbOk }: Props) {
  const [cfg, setCfg] = useState<HeroConfig>(saved);
  const [applied, setApplied] = useState(false); // l'utente ha toccato qualcosa

  // All'ingresso si riparte SEMPRE dal salvato (l'anteprima non persiste):
  // con i dati che arrivano dal server il load non richiede risincronizzazione
  // (router.refresh ricrea l'albero con le nuove props), quindi niente reset
  // in effect — lo stato inizializzato da `saved` è già la verità.

  /** Anteprima live: accende/spegne l'hero dietro e applica le variabili. */
  const applyPreview = (c: HeroConfig) => {
    const root = document.documentElement;
    if (c.enabled) {
      root.setAttribute("data-hero-preview", c.template);
      root.setAttribute("data-gradient-dir", c.gradient);
      const vars = heroVars(c);
      for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
      if (c.font === "inter") root.style.setProperty("--hero-font-preview", "var(--font-hero-inter)");
      else if (c.font === "manrope") root.style.setProperty("--hero-font-preview", "var(--font-hero-manrope)");
      else if (c.font === "playfair") root.style.setProperty("--hero-font-preview", "var(--font-hero-playfair)");
      else root.style.removeProperty("--hero-font-preview");
    } else {
      root.removeAttribute("data-hero-preview");
      root.removeAttribute("data-gradient-dir");
      root.style.removeProperty("--hero-accent");
      root.style.removeProperty("--hero-font-preview");
    }
  };

  // Ripristino all'uscita: l'admin vede l'anteprima ma la pagina pubblica
  // segue solo il salvataggio (il layout rilegge dal DB server-side).
  useEffect(() => {
    applyPreview(saved.enabled ? saved : { ...saved, enabled: false });
    return () => {
      const root = document.documentElement;
      root.removeAttribute("data-hero-preview");
      root.removeAttribute("data-gradient-dir");
      root.removeAttribute("data-hero"); // chiude anche la prova cursore
      root.style.removeProperty("--hero-accent");
      root.style.removeProperty("--hero-font-preview");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // setState funzionale: modifiche ravvicinate (o batched da React) si
  // concatenano sempre sull'ultimo stato reale, mai su una closure vecchia.
  const update = (patch: Partial<HeroConfig>) => {
    setCfg((prev) => {
      const next = { ...prev, ...patch };
      queueMicrotask(() => applyPreview(next));
      return next;
    });
    setApplied(true);
  };

  const toggleEnabled = (on: boolean) => update({ enabled: on });
  const pickTemplate = (t: HeroTemplate) => update({ template: t });

  const resetAll = () => update({ ...DEFAULT_HERO, enabled: cfg.enabled });

  return (
    <div className="space-y-5">
      {!dbOk && (
        <p className="rounded-xl bg-amber-50/90 px-3 py-2 text-xs font-medium text-amber-800 ring-1 ring-amber-200/60">
          Database non configurato: l&apos;anteprima funziona ma non può essere salvata.
        </p>
      )}

      {/* ── Interruttore: attivo sostituisce l'hero statico ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/55 p-4 ring-1 ring-white/60">
        <div>
          <p className="text-sm font-semibold text-slate-900">Hero animato</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {cfg.abTest === "on"
              ? "Test A/B attivo: la scelta sotto vale solo per il gruppo «animato»."
              : cfg.enabled
                ? "Attivo: sulla home sostituisce l'hero statico."
                : "Spento: la home resta esattamente com'è ora."}
          </p>
        </div>
        <div className="flex rounded-full bg-slate-100 p-0.5" role="group" aria-label="Attiva o disattiva l'hero animato">
          {(
            [
              { id: false, label: "Statico" },
              { id: true, label: "Animato" },
            ] as const
          ).map((o) => (
            <button
              key={String(o.id)}
              type="button"
              aria-pressed={cfg.enabled === o.id}
              onClick={() => toggleEnabled(o.id)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold transition",
                cfg.enabled === o.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Test A/B: metà statico, metà animato, confronto su GA4 ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/55 p-4 ring-1 ring-white/60">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">Test A/B (GA4)</p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
            Metà dei visitatori vede l&apos;hero statico, l&apos;altra l&apos;animato (assegnazione stabile per
            cookie first-party). Ogni ricerca nella barra invia a GA4 l&apos;evento
            <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">search_start</code>
            con la dimensione
            <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">hero_variant</code>
            («statico» / «animato») e ogni impression manda
            <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">hero_animated_view</code>:
            nel report GA4 confronti le ricerche per variante.
          </p>
        </div>
        <div className="flex rounded-full bg-slate-100 p-0.5" role="group" aria-label="Attiva o disattiva il test A/B">
          {(
            [
              { id: "off", label: "Off" },
              { id: "on", label: "On 50/50" },
            ] as const
          ).map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={cfg.abTest === o.id}
              onClick={() => update({ abTest: o.id })}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold transition",
                cfg.abTest === o.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scelta template: 4 card con mini-anteprima ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {HERO_TEMPLATES.map((t) => {
          const meta = HERO_TEMPLATE_META[t];
          const active = cfg.template === t;
          return (
            <button
              key={t}
              type="button"
              aria-pressed={active}
              onClick={() => pickTemplate(t)}
              className={cn(
                "relative rounded-2xl bg-white/60 p-3 text-left ring-1 transition",
                active ? "ring-2 ring-brand-500" : "ring-black/10 hover:ring-brand-300",
              )}
            >
              {active && (
                <span className="step-dot absolute right-2 top-2 rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white">
                  Attivo
                </span>
              )}
              {/* Mini-mockup del template (CSS puro, nessuna animazione reale) */}
              <div className="pointer-events-none relative h-16 overflow-hidden rounded-xl bg-gradient-to-br from-[#f6f9ff] to-[#eef4ff] p-2">
                {t === "spotlight" && (
                  <div className="absolute inset-0 bg-[linear-gradient(105deg,transparent_40%,rgba(255,255,255,0.8)_50%,transparent_60%)] bg-[length:250%_100%]" />
                )}
                {t === "lens" && (
                  <div className="absolute left-1/2 top-1/2 h-10 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand-400/60 shadow-[0_0_12px_rgba(61,114,236,0.45)]" />
                )}
                {t === "gradient-flow" && (
                  <div className="absolute inset-x-2 top-3 h-2 rounded bg-gradient-to-r from-brand-600 via-brand-300 to-brand-600" />
                )}
                {t === "caret" && (
                  <div className="absolute left-3 top-3 flex items-center gap-0.5 text-[10px] text-slate-500">
                    sito web per…
                    <span className="inline-block h-3 w-[2px] animate-pulse bg-brand-600" />
                  </div>
                )}
                {t === "particles" && (
                  <>
                    <span className="absolute left-[22%] top-[38%] h-1 w-1 rounded-full bg-brand-500/80" />
                    <span className="absolute left-[55%] top-[24%] h-1 w-1 rounded-full bg-brand-400/70" />
                    <span className="absolute left-[74%] top-[58%] h-1 w-1 rounded-full bg-brand-600/70" />
                    <span className="absolute left-[38%] top-[64%] h-1 w-1 rounded-full bg-brand-300" />
                    <span className="absolute left-[24%] top-[41%] h-px w-8 rotate-[24deg] bg-brand-400/50" />
                    <span className="absolute left-[57%] top-[27%] h-px w-10 rotate-[38deg] bg-brand-400/40" />
                  </>
                )}
                {t === "parallax-orbit" && (
                  <>
                    <span className="absolute left-[18%] top-[30%] h-9 w-9 rounded-full bg-brand-300/25 blur-[6px]" />
                    <span className="absolute left-[48%] top-[42%] h-5 w-5 rounded-full bg-brand-400/35 blur-[3px]" />
                    <span className="absolute left-[70%] top-[22%] h-12 w-12 rounded-full bg-brand-200/40 blur-[8px]" />
                  </>
                )}
                {t === "dot-grid" && (
                  <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(61,114,236,0.4)_1px,transparent_1.6px)] bg-[length:9px_9px] [mask-image:radial-gradient(60%_80%_at_50%_50%,black,transparent)]" />
                )}
                {t === "aurora" && (
                  <div className="absolute inset-0 bg-[radial-gradient(60%_90%_at_28%_40%,rgba(61,114,236,0.22),transparent_70%),radial-gradient(50%_80%_at_76%_60%,rgba(125,171,247,0.3),transparent_72%)]" />
                )}
                <div className="absolute bottom-2 left-1/2 h-4 w-3/4 -translate-x-1/2 rounded-full bg-white/80 shadow-sm" />
              </div>
              <p className="mt-2 text-sm font-semibold text-slate-800">
                {meta.name} <span className="font-normal text-slate-500">· {meta.sub}</span>
              </p>
              <p className="mt-1 block text-xs leading-relaxed text-slate-500">{meta.description}</p>
            </button>
          );
        })}
      </div>

      {/* ── Testi ── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Badge sopra il titolo" hint="Es. «Web agency con base nel Salento»">
          <input
            type="text"
            value={cfg.eyebrow}
            onChange={(e) => update({ eyebrow: e.target.value })}
            maxLength={90}
            className="hero-field"
          />
        </Field>
        <Field label="Font del titolo">
          <select
            value={cfg.font}
            onChange={(e) => update({ font: e.target.value as HeroFont })}
            className="hero-field"
          >
            {HERO_FONTS.map((f) => (
              <option key={f} value={f}>
                {HERO_FONT_LABELS[f]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Titolo (riga principale)" hint="Il titolo ha un peso e una misura pensati per una riga: resta corto.">
          <input
            type="text"
            value={cfg.title}
            onChange={(e) => update({ title: e.target.value })}
            maxLength={120}
            className="hero-field"
          />
        </Field>
        <Field label="Titolo evidenziato (seconda riga)" hint="Colorato con l'accento o con la sfumatura animata.">
          <input
            type="text"
            value={cfg.titleHighlight}
            onChange={(e) => update({ titleHighlight: e.target.value })}
            maxLength={160}
            className="hero-field"
          />
        </Field>
        <Field label="Sottotitolo" hint="Una o due frasi: promessa + come funziona.">
          <textarea
            value={cfg.subtitle}
            onChange={(e) => update({ subtitle: e.target.value })}
            maxLength={280}
            rows={3}
            className="hero-field resize-none"
          />
        </Field>
        <Field label="Placeholder della barra" hint="Nel template «Caret» si scrive da solo.">
          <input
            type="text"
            value={cfg.placeholder}
            onChange={(e) => update({ placeholder: e.target.value })}
            maxLength={90}
            className="hero-field"
          />
        </Field>
      </div>

      {/* ── Colori e sfumatura ── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-slate-500" htmlFor="hero-accent">
            Colore accento (vuoto = blu del tema)
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="hero-accent"
              type="color"
              value={cfg.accent || "#3d72ec"}
              onChange={(e) => update({ accent: e.target.value })}
              className="h-10 w-14 cursor-pointer rounded-lg border border-white/60 bg-white/70"
            />
            <input
              type="text"
              value={cfg.accent}
              onChange={(e) => {
                if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) update({ accent: e.target.value });
              }}
              placeholder="#3d72ec"
              aria-label="Hex colore accento"
              className="w-24 rounded-lg border border-white/60 bg-white/70 px-2 py-1.5 text-xs text-slate-700"
            />
            {cfg.accent && (
              <GlassButton type="button" variant="ghost" size="sm" onClick={() => update({ accent: "" })}>
                Azzera
              </GlassButton>
            )}
          </div>
        </div>
        <div className={cfg.template === "gradient-flow" ? "" : "opacity-50"}>
          <span className="block text-xs font-medium text-slate-500">Direzione sfumatura (solo Gradient flow)</span>
          <div className="mt-2 flex rounded-full bg-slate-100 p-0.5" role="group" aria-label="Direzione della sfumatura">
            {HERO_GRADIENT_DIRECTIONS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={cfg.gradient === d}
                disabled={cfg.template !== "gradient-flow"}
                onClick={() => update({ gradient: d as HeroGradientDirection })}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-semibold transition",
                  cfg.gradient === d ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
                )}
              >
                {HERO_GRADIENT_LABELS[d]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-end">
          <GlassButton type="button" variant="glass" size="sm" onClick={resetAll}>
            Ripristina testi predefiniti
          </GlassButton>
        </div>
      </div>

      {/* ── Cursore: toggle statico/dinamico, 5 temi, colore e prova ── */}
      <div className="rounded-2xl bg-white/55 p-4 ring-1 ring-white/60">
        <HeroCursorGlow cursor={cfg.cursor} cursorAccent={cfg.cursorAccent} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Cursore interattivo</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              Come si muove il puntatore mentre l&apos;hero è a schermo: temi minimali e
              professionali, pensati per guidare senza distrarre. Su touch e con «movimento
              ridotto» resta comunque il cursore standard.
            </p>
          </div>
          {/* Toggle «ripristina il puntatore senza effetti»: i cinque temi
              dinamici qui sotto valgono solo in modalità «Dinamico». */}
          <div className="flex rounded-full bg-slate-100 p-0.5" role="group" aria-label="Puntatore statico o dinamico">
            {([
              { id: "none", label: "Statico" },
              { id: "glow", label: "Dinamico" },
            ] as const).map((o) => {
              const active = o.id === "none" ? cfg.cursor === "none" : cfg.cursor !== "none";
              return (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => update({ cursor: o.id })}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold transition",
                    active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {HERO_CURSORS.map((cu) => {
            const meta = HERO_CURSOR_META[cu];
            const active = cfg.cursor === cu;
            return (
              <button
                key={cu}
                type="button"
                aria-pressed={active}
                onClick={() => update({ cursor: cu })}
                className={cn(
                  "relative rounded-2xl bg-white/60 p-3 text-left ring-1 transition",
                  active ? "ring-2 ring-brand-500" : "ring-black/10 hover:ring-brand-300",
                )}
              >
                {active && (
                  <span className="step-dot absolute right-2 top-2 rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white">
                    Attivo
                  </span>
                )}
                {/* Mini-mockup del tema (CSS puro) */}
                <div className="pointer-events-none relative h-14 overflow-hidden rounded-xl bg-gradient-to-br from-[#f6f9ff] to-[#eef4ff]">
                  {cu === "glow" && (
                    <span className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(61,114,236,0.35),rgba(61,114,236,0.12)_45%,transparent_70%)]" />
                  )}
                  {cu === "lens" && (
                    <span className="absolute left-[42%] top-1/2 -translate-y-1/2">
                      <span className="block h-6 w-6 rounded-full border-[1.5px] border-brand-600/60 bg-white/30 shadow-[0_0_10px_rgba(61,114,236,0.25)]" />
                      <span className="absolute left-[19px] top-[19px] h-[10px] w-[2px] rotate-[-45deg] rounded-full bg-brand-600/60" />
                    </span>
                  )}
                  {cu === "comet" && (
                    <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_9px_rgba(61,114,236,0.9)]">
                      <span className="absolute right-2 top-1/2 h-1.5 w-12 -translate-y-1/2 rounded-full bg-gradient-to-l from-brand-400/80 via-brand-300/40 to-transparent" />
                    </span>
                  )}
                  {cu === "elastic" && (
                    <span className="absolute left-1/2 top-1/2 h-2.5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500/80" />
                  )}
                  {cu === "none" && (
                    <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px] font-medium text-slate-400">
                      puntatore standard
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm font-semibold text-slate-800">
                  {meta.name} <span className="font-normal text-slate-500">· {meta.sub}</span>
                </p>
                <p className="mt-1 block text-xs leading-relaxed text-slate-500">{meta.description}</p>
              </button>
            );
          })}
        </div>
        <div className="mt-4 grid items-end gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-slate-500" htmlFor="hero-cursor-accent">
              Colore del cursore (vuoto = blu del tema)
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id="hero-cursor-accent"
                type="color"
                value={cfg.cursorAccent || "#3d72ec"}
                onChange={(e) => update({ cursorAccent: e.target.value })}
                className="h-10 w-14 cursor-pointer rounded-lg border border-white/60 bg-white/70"
              />
              <input
                type="text"
                value={cfg.cursorAccent}
                onChange={(e) => {
                  if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) update({ cursorAccent: e.target.value });
                }}
                placeholder="#3d72ec"
                aria-label="Hex colore cursore"
                className="w-24 rounded-lg border border-white/60 bg-white/70 px-2 py-1.5 text-xs text-slate-700"
              />
              {cfg.cursorAccent && (
                <GlassButton type="button" variant="ghost" size="sm" onClick={() => update({ cursorAccent: "" })}>
                  Azzera
                </GlassButton>
              )}
            </div>
          </div>
          {/* Prova dal vivo: mentre il mouse è qui, il cursore scelto prende vita
              (data-hero su <html> è il gate condiviso col componente pubblico). */}
          <div
            onMouseEnter={() => {
              if (cfg.cursor !== "none") document.documentElement.setAttribute("data-hero", "1");
            }}
            onMouseLeave={() => document.documentElement.removeAttribute("data-hero")}
            className="grid h-16 place-items-center rounded-2xl border border-dashed border-slate-300/80 bg-white/40"
          >
            <p className="text-xs text-slate-400">
              {cfg.cursor === "none"
                ? "Puntatore statico: nessun effetto da provare"
                : "Passa qui per provare il cursore scelto"}
            </p>
          </div>
        </div>
      </div>

      {/* ── Salvataggio esplicito ── */}
      <form action={saveHeroAction} className="flex items-center gap-3 pt-1">
        <input type="hidden" name="enabled" value={cfg.enabled ? "1" : "0"} />
        <input type="hidden" name="abTest" value={cfg.abTest} />
        <input type="hidden" name="template" value={cfg.template} />
        <input type="hidden" name="eyebrow" value={cfg.eyebrow} />
        <input type="hidden" name="title" value={cfg.title} />
        <input type="hidden" name="titleHighlight" value={cfg.titleHighlight} />
        <input type="hidden" name="subtitle" value={cfg.subtitle} />
        <input type="hidden" name="placeholder" value={cfg.placeholder} />
        <input type="hidden" name="font" value={cfg.font} />
        <input type="hidden" name="accent" value={cfg.accent} />
        <input type="hidden" name="gradient" value={cfg.gradient} />
        <input type="hidden" name="cursor" value={cfg.cursor} />
        <input type="hidden" name="cursorAccent" value={cfg.cursorAccent} />
        <GlassButton type="submit" size="sm" disabled={!dbOk || !applied}>
          Salva hero
        </GlassButton>
        <span className="text-[11px] text-slate-400">
          {applied
            ? "Anteprima live sulla home dietro: salva per renderla definitiva."
            : "Tutto com'era: tocca template, testi o colori per modificare."}
        </span>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="block text-xs font-medium text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{hint}</p>}
    </div>
  );
}
