"use client";

import { useState } from "react";
import { saveNotionSyncConfigAction } from "@/app/admin/actions";
import { SYNCABLE_LEAD_FIELDS, type NotionSyncConfig, type MappingField } from "@/lib/notion-config-shared";

/**
 * Editor della config di sincronizzazione Notion (FASE 3).
 *
 * L'utente modifica mapping, titolo e comportamento con controlli
 * strutturati (nessun JSON grezzo da scrivere a mano): al salvataggio
 * la server action rivalida tutto lato server con sanitizeSyncConfig.
 */

const TYPES: MappingField["type"][] = [
  "title",
  "rich_text",
  "select",
  "multi_select",
  "number",
  "url",
  "date",
  "checkbox",
  "email",
  "phone_number",
];

const TRANSFORMS: { value: string; label: string }[] = [
  { value: "", label: "— nessuna —" },
  { value: "mappa_sorgente", label: "mappa sorgente (ai → etichetta)" },
  { value: "solo_http", label: "solo URL http(s)" },
  { value: "iso8601", label: "data ISO 8601" },
];

export default function NotionConfigEditor({ config }: { config: NotionSyncConfig }) {
  const [mapping, setMapping] = useState<MappingField[]>(config.leadMapping);
  const [titleTemplate, setTitleTemplate] = useState(config.titleTemplate);
  const [titleFallback, setTitleFallback] = useState(config.titleFallback);
  const [batchMax, setBatchMax] = useState(config.sync.batchMax);
  const [onCreate, setOnCreate] = useState(config.sync.onCreate);
  const [onUpdate, setOnUpdate] = useState(config.sync.onUpdate);
  const [retryAttempts, setRetryAttempts] = useState(config.sync.retryAttempts);
  const [sourceAi, setSourceAi] = useState(config.selectMapping.Sorgente?.ai ?? "Ambrosio AI");
  const [sourceDefault, setSourceDefault] = useState(config.selectMapping.Sorgente?.["*"] ?? "Script chat");

  const update = (i: number, patch: Partial<MappingField>) =>
    setMapping((m) => m.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const addField = () => setMapping((m) => [...m, { from: "notes", to: "Nuova proprietà", type: "rich_text" }]);
  const removeField = (i: number) => setMapping((m) => m.filter((_, j) => j !== i));

  const buildPayload = (): NotionSyncConfig => ({
    ...config,
    leadMapping: mapping,
    titleTemplate,
    titleFallback,
    selectMapping: { Sorgente: { ai: sourceAi, "*": sourceDefault } },
    sync: { ...config.sync, batchMax, onCreate, onUpdate, retryAttempts },
  });

  return (
    <form action={saveNotionSyncConfigAction} className="space-y-4">
      <input type="hidden" name="configJson" value={JSON.stringify(buildPayload())} />

      {/* Template titolo */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-slate-500">
          Template titolo (placeholder {"{{campo}}"}; vuoto → fallback)
          <input
            value={titleTemplate}
            onChange={(e) => setTitleTemplate(e.target.value)}
            className="mt-1 w-full rounded-xl border border-white/60 bg-white/70 px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-400"
          />
        </label>
        <label className="block text-xs font-medium text-slate-500">
          Fallback titolo
          <input
            value={titleFallback}
            onChange={(e) => setTitleFallback(e.target.value)}
            className="mt-1 w-full rounded-xl border border-white/60 bg-white/70 px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-400"
          />
        </label>
      </div>

      {/* Mapping */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Mapping lead → proprietà Notion
        </p>
        {mapping.map((f, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-white/50 p-2 ring-1 ring-white/60">
            <select
              value={f.from}
              onChange={(e) => update(i, { from: e.target.value })}
              aria-label={`Campo DB riga ${i + 1}`}
              className="rounded-lg border border-white/60 bg-white/80 px-2 py-1.5 text-xs text-slate-700"
            >
              {SYNCABLE_LEAD_FIELDS.map((c) => (
                <option key={c.from} value={c.from}>
                  {c.label} ({c.from})
                </option>
              ))}
            </select>
            <span className="text-slate-400">→</span>
            <input
              value={f.to}
              onChange={(e) => update(i, { to: e.target.value })}
              aria-label={`Proprietà Notion riga ${i + 1}`}
              className="w-36 rounded-lg border border-white/60 bg-white/80 px-2 py-1.5 text-xs text-slate-700"
            />
            <select
              value={f.type}
              onChange={(e) => update(i, { type: e.target.value as MappingField["type"] })}
              aria-label={`Tipo riga ${i + 1}`}
              className="rounded-lg border border-white/60 bg-white/80 px-2 py-1.5 text-xs text-slate-700"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={f.transform ?? ""}
              onChange={(e) => update(i, { transform: (e.target.value || undefined) as MappingField["transform"] })}
              aria-label={`Trasformazione riga ${i + 1}`}
              className="rounded-lg border border-white/60 bg-white/80 px-2 py-1.5 text-xs text-slate-700"
            >
              {TRANSFORMS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => removeField(i)}
              aria-label={`Rimuovi riga ${i + 1}`}
              className="ml-auto rounded-full px-2 py-1 text-xs font-semibold text-red-500 hover:bg-red-50"
            >
              Rimuovi
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addField}
          className="rounded-full border border-white/50 bg-white/60 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white"
        >
          + Aggiungi campo
        </button>
      </div>

      {/* Mapping select Sorgente */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-slate-500">
          Sorgente «ai» → etichetta Notion
          <input
            value={sourceAi}
            onChange={(e) => setSourceAi(e.target.value)}
            className="mt-1 w-full rounded-xl border border-white/60 bg-white/70 px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-400"
          />
        </label>
        <label className="block text-xs font-medium text-slate-500">
          Sorgente (default) → etichetta Notion
          <input
            value={sourceDefault}
            onChange={(e) => setSourceDefault(e.target.value)}
            className="mt-1 w-full rounded-xl border border-white/60 bg-white/70 px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-400"
          />
        </label>
      </div>

      {/* Opzioni sync */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs font-medium text-slate-500">
          Batch max
          <input
            type="number"
            min={1}
            max={100}
            value={batchMax}
            onChange={(e) => setBatchMax(Number(e.target.value))}
            className="mt-1 w-full rounded-xl border border-white/60 bg-white/70 px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-xs font-medium text-slate-500">
          Tentativi retry
          <input
            type="number"
            min={0}
            max={10}
            value={retryAttempts}
            onChange={(e) => setRetryAttempts(Number(e.target.value))}
            className="mt-1 w-full rounded-xl border border-white/60 bg-white/70 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex items-end gap-2 pb-2 text-xs font-medium text-slate-600">
          <input type="checkbox" checked={onCreate} onChange={(e) => setOnCreate(e.target.checked)} className="h-4 w-4 accent-[#34C759]" />
          Sync automatica alla creazione
        </label>
        <label className="flex items-end gap-2 pb-2 text-xs font-medium text-slate-600">
          <input type="checkbox" checked={onUpdate} onChange={(e) => setOnUpdate(e.target.checked)} className="h-4 w-4 accent-[#34C759]" />
          Aggiorna pagina se il lead cambia
        </label>
      </div>

      <button
        type="submit"
        className="rounded-full bg-brand-600/90 px-4 py-1.5 text-xs font-semibold text-white shadow-glass-btn transition hover:bg-brand-500/90"
      >
        Salva config
      </button>
    </form>
  );
}
