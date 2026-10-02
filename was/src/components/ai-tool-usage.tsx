/**
 * Fase 5 — statistiche d'uso dei tool di Ambrosio: quante azioni ha davvero
 * compiuto (lead salvati, callback fissate, priorità alzate, note, handoff),
 * ripartite per lingua e canale. Fonte: audit log (già scritto da ogni
 * azione), quindi le cifre sono azioni CONFERMATE e non falsabili dal modello.
 */

import { UiIcon } from "@/components/icon-registry";

const FN_LABEL: Record<string, string> = {
  salva_lead: "Lead salvati",
  fissa_callback: "Callback fissate",
  aggiorna_ticket: "Priorità alzate",
  nota_interna: "Note al team",
  handoff: "Handoff",
};

const LANG_LABEL: Record<string, string> = {
  it: "Italiano",
  en: "Inglese",
  de: "Tedesco",
  fr: "Francese",
  es: "Spagnolo",
};

const CHANNEL_LABEL: Record<string, string> = {
  web: "Chat web",
  whatsapp: "WhatsApp",
};

export default function ToolUsageTable({ stats }: { stats: import("@/lib/ai-tools").ToolUsageStats }) {
  const total = stats.totals.reduce((s, t) => s + t.n, 0);

  if (total === 0) {
    return (
      <div className="mt-4 rounded-2xl bg-white/50 p-3.5 ring-1 ring-slate-100">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Azioni di Ambrosio (ultimi {stats.days} giorni)
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
          Nessuna azione ancora: quando Ambrosio salva un lead, fissa una callback o passa un ticket al
          team, ogni azione compare qui — con lingua e canale. (Le verifiche fatte durante lo sviluppo
          restano nell&apos;audit completo di /admin/audit.)
        </p>
      </div>
    );
  }

  // Raggruppa per lingua/canale mantenendo l'ordine per volume
  const collapse = (rows: { key: string; fn: string; n: number }[]) => {
    const m = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (!m.has(r.key)) m.set(r.key, new Map());
      const inner = m.get(r.key)!;
      inner.set(r.fn, (inner.get(r.fn) ?? 0) + r.n);
    }
    return [...m.entries()].sort((a, b) => {
      const sa = [...a[1].values()].reduce((x, y) => x + y, 0);
      const sb = [...b[1].values()].reduce((x, y) => x + y, 0);
      return sb - sa;
    });
  };

  const langs = collapse(stats.byLanguage.map((r) => ({ key: r.lang, fn: r.fn, n: r.n })));
  const channels = collapse(stats.byChannel.map((r) => ({ key: r.channel, fn: r.fn, n: r.n })));

  return (
    <div className="mt-4 rounded-2xl bg-white/50 p-3.5 ring-1 ring-slate-100">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Azioni di Ambrosio (ultimi {stats.days} giorni)
      </p>

      {/* Riepilogo per funzione */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {stats.totals.map((t) => (
          <span
            key={t.fn}
            title={`azioni confermate nell'audit log`}
            className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-800 ring-1 ring-violet-100"
          >
            {FN_LABEL[t.fn] ?? t.fn}
            <span className="rounded-full bg-violet-600 px-1.5 text-[10px] font-bold text-white">{t.n}</span>
          </span>
        ))}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {/* Per lingua */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Per lingua</p>
          <ul className="mt-1 space-y-1">
            {langs.map(([lang, fns]) => (
              <li key={lang} className="rounded-xl bg-white/70 px-2.5 py-1.5 text-[11px] ring-1 ring-slate-100">
                <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                  {LANG_LABEL[lang] && <UiIcon name="flag" size={11} />}
                  {LANG_LABEL[lang] ?? lang}
                </span>
                <span className="ml-1.5 text-slate-400">
                  {([...fns.entries()].sort((a, b) => b[1] - a[1]))
                    .map(([fn, n]) => `${FN_LABEL[fn] ?? fn} ${n}`)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
        {/* Per canale */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Per canale</p>
          <ul className="mt-1 space-y-1">
            {channels.map(([ch, fns]) => (
              <li key={ch} className="rounded-xl bg-white/70 px-2.5 py-1.5 text-[11px] ring-1 ring-slate-100">
                <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                  <UiIcon name={ch === "whatsapp" ? "whatsapp" : "chat"} size={11} />
                  {CHANNEL_LABEL[ch] ?? ch}
                </span>
                <span className="ml-1.5 text-slate-400">
                  {([...fns.entries()].sort((a, b) => b[1] - a[1]))
                    .map(([fn, n]) => `${FN_LABEL[fn] ?? fn} ${n}`)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-2.5 text-[10px] leading-relaxed text-slate-400">
        Solo azioni confermate nell&apos;audit log (actor ambrosio@ai): le richieste non valide o i test
        del «Prova dal vivo» non contano. Elenco completo in /admin/audit.
      </p>
    </div>
  );
}
