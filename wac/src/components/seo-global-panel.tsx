"use client";

import { useState } from "react";
import { Globe2, LoaderCircle, Save } from "lucide-react";
import { GlassButton, GlassSectionHeader } from "@/components/glass";
import { saveSeoGlobalAction } from "@/app/admin/actions";
import { UiIcon } from "@/components/icon-registry";

/**
 * Meta globali del sito: title e description della home (il risultato più
 * visibile di tutta la SEO), le keyword sitewide e og:site_name. Contatori
 * con le soglie Google e anteprima SERP live, come nell'editor di landing.
 */

export default function SeoGlobalPanel({
  homeTitle,
  homeDescription,
  siteKeywords,
  ogSiteName,
  siteUrl,
}: {
  homeTitle: string;
  homeDescription: string;
  siteKeywords: string;
  ogSiteName: string;
  siteUrl: string;
}) {
  const [title, setTitle] = useState(homeTitle);
  const [description, setDescription] = useState(homeDescription);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const titleOk = title.length <= 60;
  const descOk = description.length >= 70 && description.length <= 160;

  return (
    <div className="space-y-4">
      <GlassSectionHeader
        icon={Globe2}
        title="Meta globali del sito"
        subtitle="Home, keyword sitewide e nome che appare nelle condivisioni social."
      />

      <div className="rounded-2xl bg-white/70 px-4 py-3 ring-1 ring-white/70">
        <p className="text-[11px] uppercase tracking-wide text-slate-400">Anteprima su Google — home</p>
        <p className="mt-1 truncate text-xs text-emerald-700">{siteUrl}</p>
        <p className="mt-0.5 truncate text-[15px] font-medium text-[#1a0dab]">{title || "Titolo della home"}</p>
        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-600">
          {description || "Descrizione della home: è lo snippet che Google mostra sotto il titolo."}
        </p>
      </div>

      <form
        action={async (fd: FormData) => {
          setSaving(true);
          await saveSeoGlobalAction(fd);
          setSaving(false);
          setSaved(true);
          setTimeout(() => setSaved(false), 2500);
        }}
        className="space-y-3"
      >
        <div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="seo-home-title" className="block text-xs font-semibold text-slate-600">
              Title della home
            </label>
            <span className={`text-[11px] font-semibold tabular-nums ${titleOk ? "text-emerald-600" : "text-amber-600"}`}>
              {title.length}/60
            </span>
          </div>
          <input
            id="seo-home-title"
            name="homeTitle"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={70}
            className="mt-1 w-full rounded-2xl border border-white/70 bg-white/65 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-brand-400 focus:bg-white"
          />
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="seo-home-desc" className="block text-xs font-semibold text-slate-600">
              Meta description della home
            </label>
            <span className={`text-[11px] font-semibold tabular-nums ${descOk ? "text-emerald-600" : "text-amber-600"}`}>
              {description.length}/160 {description.length < 70 ? "· troppo corta" : ""}
            </span>
            </div>
          <textarea
            id="seo-home-desc"
            name="homeDescription"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={200}
            className="mt-1 w-full rounded-2xl border border-white/70 bg-white/65 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-brand-400 focus:bg-white"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label htmlFor="seo-keywords" className="block text-xs font-semibold text-slate-600">
            Keyword globali del sito <span className="font-normal text-slate-400">(separate da virgola)</span>
            <textarea
              id="seo-keywords"
              name="siteKeywords"
              defaultValue={siteKeywords}
              rows={2}
              className="mt-1 w-full rounded-2xl border border-white/70 bg-white/65 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-brand-400 focus:bg-white"
            />
          </label>
          <label htmlFor="seo-ogname" className="block text-xs font-semibold text-slate-600">
            Nome del sito (og:site_name)
            <input
              id="seo-ogname"
              name="ogSiteName"
              defaultValue={ogSiteName}
              maxLength={80}
              className="mt-1 w-full rounded-2xl border border-white/70 bg-white/65 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-brand-400 focus:bg-white"
            />
          </label>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-white/60 pt-3">
          <span aria-live="polite" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
            {saved ? (
              <>
                Salvato
                <UiIcon name="check" size={12} />
              </>
            ) : (
              ""
            )}
          </span>
          <GlassButton type="submit" disabled={saving}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            Salva meta globali
          </GlassButton>
        </div>
      </form>
    </div>
  );
}
