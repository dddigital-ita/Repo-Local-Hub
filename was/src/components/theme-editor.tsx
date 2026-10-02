"use client";

import { useMemo, useState, useEffect } from "react";
import { saveThemeAction } from "@/app/admin/actions";
import { brandScale, adjustScaleForDark, toRgbTriplet } from "@/lib/theme-shared";
import type { ThemeName, ThemeMode } from "@/lib/theme-shared";
import { GlassButton } from "@/components/glass";
import { UiIcon } from "@/components/icon-registry";

/**
 * Editor del tema grafico (PROMPT-TEMI-GRAFICI.md — Prompt 3).
 *
 * Selettore Classic/Zendesk + colori personalizzati con ANTEPRIMA LIVE:
 * mentre l'utente sceglie, le CSS variables sono applicate su
 * documentElement → tutto il sito visibile dietro cambia all'istante.
 * Il salvataggio è esplicito (bottone): all'ingresso si riparte SEMPRE
 * dal tema salvato. Nessuna dipendenza: input color nativo + funzioni
 * pure di derivazione scala.
 */

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

/** Luminanza relativa WCAG (nessuna dipendenza). */
function relativeLuminance(r: number, g: number, b: number): number {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(hex1: string, hex2: string): number {
  const parse = (h: string) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff] as const;
  };
  const [r1, g1, b1] = parse(hex1);
  const [r2, g2, b2] = parse(hex2);
  const l1 = relativeLuminance(r1, g1, b1);
  const l2 = relativeLuminance(r2, g2, b2);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Tripletti "r g b" → hex (per i confronti di contrasto sulla scala derivata). */
function tripletToHex(triplet: string): string {
  const [r, g, b] = triplet.split(" ").map(Number);
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}

interface Props {
  saved: { theme: ThemeName; mode?: ThemeMode; primary?: string; accent?: string };
  dbOk: boolean;
}

export default function ThemeEditor({ saved, dbOk }: Props) {
  const [theme, setTheme] = useState<ThemeName>(saved.theme);
  const [mode, setMode] = useState<ThemeMode>(saved.mode ?? "light");
  const [primary, setPrimary] = useState(saved.primary ?? "");
  const [accent, setAccent] = useState(saved.accent ?? "");
  const [applied, setApplied] = useState(false); // l'utente ha toccato qualcosa

  const scale = useMemo(() => (primary ? brandScale(primary) : null), [primary]);
  const contrast = useMemo(
    () => (primary ? contrastRatio("#ffffff", primary) : 4.6),
    [primary],
  );
  const contrastBad = contrast < 4.5;

  /* Anteprima live: CSS vars su <html>, sempre ripartendo dal salvato.
     In dark la scala è aggiustata come farà il server (adjustScaleForDark). */
  const applyPreview = (t: ThemeName, m: ThemeMode, p: string, a: string) => {
    const el = document.documentElement;
    el.setAttribute("data-theme", t);
    el.setAttribute("data-mode", m);
    if (p) {
      const base = brandScale(p);
      const s = m === "dark" ? adjustScaleForDark(base) : base;
      for (const n of STEPS) el.style.setProperty(`--brand-${n}`, s[n]);
    } else {
      for (const n of STEPS) el.style.removeProperty(`--brand-${n}`);
    }
    if (a) el.style.setProperty("--accent", toRgbTriplet(a));
    else el.style.removeProperty("--accent");
  };

  useEffect(() => {
    // All'ingresso: riparte SEMPRE dal tema salvato (l'anteprima non è persistente).
    applyPreview(saved.theme, saved.mode ?? "light", saved.primary ?? "", saved.accent ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPick = (t: ThemeName) => {
    setTheme(t);
    setApplied(true);
    applyPreview(t, mode, primary, accent);
  };
  const onMode = (m: ThemeMode) => {
    setMode(m);
    setApplied(true);
    applyPreview(theme, m, primary, accent);
  };
  const onColor = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setApplied(true);
  };
  const onPrimary = (v: string) => {
    onColor(setPrimary)(v);
    applyPreview(theme, mode, v, accent);
  };
  const onAccent = (v: string) => {
    onColor(setAccent)(v);
    applyPreview(theme, mode, primary, v);
  };
  const resetColors = () => {
    setPrimary("");
    setAccent("");
    setApplied(true);
    applyPreview(theme, mode, "", "");
  };

  return (
    <div className="space-y-4">
      {!dbOk && (
        <p className="rounded-xl bg-amber-50/90 px-3 py-2 text-xs font-medium text-amber-800 ring-1 ring-amber-200/60">
          Database non configurato: il tema può essere provato in anteprima ma non salvato.
        </p>
      )}

      {/* Selettore tema: due card-anteprima con mini-mockup in CSS puro */}
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            {
              id: "classic" as ThemeName,
              name: "Classic",
              sub: "Liquid Glass",
              card: "rgba(255,255,255,.78)",
              border: "rgba(255,255,255,.65)",
              radius: 24,
              bg: "linear-gradient(135deg,#f6f9ff,#eef4ff)",
            },
            {
              id: "zendesk" as ThemeName,
              name: "Zendesk",
              sub: "Glossy",
              card: "#ffffff",
              border: "#d8dcde",
              radius: 10,
              bg: "#f8f9f9",
            },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={theme === t.id}
            onClick={() => onPick(t.id)}
            className={`relative rounded-2xl p-3 text-left ring-1 transition ${
              theme === t.id ? "ring-2 ring-brand-500" : "ring-black/10 hover:ring-brand-300"
            }`}
            style={{ background: t.bg }}
          >
            {theme === t.id && (
              <span className="step-dot absolute right-2 top-2 rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white">
                Attivo
              </span>
            )}
            {/* Mini-mockup: barra + card + bottone, rappresentativi del tema */}
            <div className="pointer-events-none space-y-1.5">
              <div className="h-2 w-2/3 rounded" style={{ background: "rgb(var(--brand-500))", borderRadius: t.id === "zendesk" ? 2 : 4 }} />
              <div
                style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: t.radius, boxShadow: "0 1px 2px rgba(0,0,0,.06)" }}
                className="h-10 p-1.5"
              >
                <div className="h-1.5 w-1/2 rounded bg-slate-300" />
                <div className="mt-1 h-1.5 w-2/3 rounded bg-slate-200" />
              </div>
              <div
                className="inline-block px-2 py-0.5 text-[9px] font-bold text-white"
                style={{ background: "rgb(var(--brand-600))", borderRadius: t.id === "zendesk" ? 8 : 9999 }}
              >
                Bottone
              </div>
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-800">
              {t.name} <span className="font-normal text-slate-500">· {t.sub}</span>
            </p>
          </button>
        ))}
      </div>

      {/* Colori personalizzati */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-slate-500" htmlFor="theme-primary">
            Colore primario (default blu #3d72ec)
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="theme-primary"
              type="color"
              value={primary || "#3d72ec"}
              onChange={(e) => onPrimary(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded-lg border border-white/60 bg-white/70"
            />
            <input
              type="text"
              value={primary}
              onChange={(e) => {
                if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) onPrimary(e.target.value);
              }}
              placeholder="#3d72ec"
              aria-label="Hex colore primario"
              className="w-28 rounded-lg border border-white/60 bg-white/70 px-2 py-1.5 text-xs text-slate-700"
            />
          </div>
          {scale && (
            <div className="mt-2 flex flex-wrap gap-0.5" aria-label="Scala derivate 50-950">
              {STEPS.map((n) => (
                <span
                  key={n}
                  title={`${n}: ${tripletToHex(scale[n])}`}
                  className="h-5 w-5 rounded"
                  style={{ background: `rgb(${scale[n]})` }}
                />
              ))}
            </div>
          )}
          {contrastBad && (
            <p className="mt-2 rounded-lg bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700 ring-1 ring-red-200">
              Attenzione: bianco su {primary} ha contrasto {contrast.toFixed(2)}:1 (&lt; 4,5:1 AA). Scegli un tono più scuro.
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500" htmlFor="theme-accent">
            Colore accento (opzionale)
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="theme-accent"
              type="color"
              value={accent || "#94b8f8"}
              onChange={(e) => onAccent(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded-lg border border-white/60 bg-white/70"
            />
            <input
              type="text"
              value={accent}
              onChange={(e) => {
                if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) onAccent(e.target.value);
              }}
              placeholder="#94b8f8"
              aria-label="Hex colore accento"
              className="w-28 rounded-lg border border-white/60 bg-white/70 px-2 py-1.5 text-xs text-slate-700"
            />
          </div>
          <GlassButton type="button" variant="glass" size="sm" onClick={resetColors}>
            Ripristina colori predefiniti
          </GlassButton>
        </div>
      </div>

      {/* Modalità chiaro/scuro: dimensione ortogonale al tema (Fase dark) */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500">Modalità</span>
        <div className="flex rounded-full bg-slate-100 p-0.5" role="group" aria-label="Modalità chiaro o scuro">
          {          (
            [
              {
                id: "light" as ThemeMode,
                label: "Chiaro",
                icon: <UiIcon name="sun" size={12} />,
              },
              {
                id: "dark" as ThemeMode,
                label: "Scuro",
                icon: <UiIcon name="moon" size={12} />,
              },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={mode === m.id}
              onClick={() => onMode(m.id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
                mode === m.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Salvataggio esplicito */}
      <form action={saveThemeAction} className="flex items-center gap-3 pt-1">
        <input type="hidden" name="theme" value={theme} />
        <input type="hidden" name="mode" value={mode} />
        <input type="hidden" name="primary" value={primary} />
        <input type="hidden" name="accent" value={accent} />
        <GlassButton type="submit" size="sm" disabled={!dbOk || !applied} className="mt-3">
          Salva tema
        </GlassButton>
        <span className="text-[11px] text-slate-400">
          {applied ? "Le modifiche sono solo in anteprima finché non salvi." : "Tutto com'era: tocca tema o colori per modificare."}
        </span>
      </form>
    </div>
  );
}
