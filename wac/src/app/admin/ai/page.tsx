import { BookOpen, Bot, FileText, FlaskConical, Gauge, GraduationCap, KeyRound, Moon, MessageSquareDashed, Settings2, Sparkles, TrendingUp, HelpCircle, Activity } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { PROVIDERS } from "@/lib/ai";
import { hubSummary, dedupeByKey } from "@/lib/settings-status";
import { getAmbrosioStatuses } from "@/lib/ambrosio-status-server";
import { GlassCard as Card, GlassSectionHeader } from "@/components/glass";
import { HubCard, HubStatus } from "@/components/settings-hub";

export const dynamic = "force-dynamic";

/**
 * AMBROSIO · AI — hub di schede (stesso pattern di Impostazioni e Tools).
 * La pagina è PURA PRESENTAZIONE: stato e statistiche arrivano dalla `view`
 * del reader (`ambrosio-status-server`), i badge delle schede dagli stati del
 * layer dati testabile (`settings-status.ts`). UNA scheda = UNA pagina:
 * apri, regoli, chiudi.
 */
export default async function AiPage() {
  await requireAdmin();
  const { statuses, view } = await getAmbrosioStatuses();
  const { training, config, provider, autonomy, documents, proposals } = statuses;
  /** Riepilogo nell'header: le tre schede + lo stato vitale di Ambrosio.
      Chiavi stabili su tutti gli stati: il dedup by-key evita di contare
      due volte la chiave (`providerStatus` e `hasKey` dicono la stessa
      cosa) — con l'ID condiviso, Panoramica e hub non possono divergere. */
  const summary = hubSummary(
    dedupeByKey([
      training,
      config,
      provider,
      autonomy,
      documents,
      proposals,
      { key: "chiave", ok: view.hasKey, warn: !view.hasKey, label: "", counts: [] },
      { key: "attivazione", ok: view.enabled, warn: !view.enabled && view.hasKey, label: "", counts: [] },
    ]),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold text-slate-900">
            <Sparkles className="h-6 w-6 text-violet-600" aria-hidden />
            Ambrosio · operatore AI
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Risponde ai clienti in tempo reale quando Daniele e Michele sono fuori turno (notte inclusa).
            La qualificazione a bottoni resta quella: Ambrosio interviene sulle domande libere.
          </p>
        </div>
        <HubStatus ok={summary.ok} warn={summary.warn} label={summary.label} />
      </div>

      {/* Stato attuale — dati dalla view del reader */}
      <div className="glass-solid rounded-3xl p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${
              view.enabled
                ? "bg-emerald-50/90 text-emerald-700 ring-emerald-200/70"
                : "bg-slate-100/80 text-slate-500 ring-slate-200/70"
            }`}
          >
            <Bot className="h-3.5 w-3.5" aria-hidden />
            {view.enabled ? "Attiva: risponde quando il team è offline" : "Disattivata: callback e WhatsApp come fallback"}
          </span>
          {view.hasKey ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50/90 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200/70">
              <KeyRound className="h-3.5 w-3.5" aria-hidden />
              Chiave salvata (cifrata)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50/90 px-3 py-1.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200/70">
              <KeyRound className="h-3.5 w-3.5" aria-hidden />
              Chiave API mancante
            </span>
          )}
          {view.provider && (
            <span className="rounded-full bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-white/50">
              {PROVIDERS.find((p) => p.key === view.provider)?.label} · {view.model}
            </span>
          )}
        </div>
      </div>

      {/* Statistiche ultimi 30 giorni */}
      <section className="glass-solid rounded-3xl p-5">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <TrendingUp className="h-4 w-4 text-violet-600" aria-hidden />
          Ambrosio negli ultimi 30 giorni
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <MessageSquareDashed className="h-3.5 w-3.5" aria-hidden />
              Conversazioni gestite
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{view.stats.conversations}</p>
            <p className="text-[11px] text-slate-500">{view.stats.replies} risposte · {view.stats.repliesPerConv} per chat</p>
          </div>
          <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <Moon className="h-3.5 w-3.5" aria-hidden />
              Di notte o weekend
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{view.stats.nightConversations}</p>
            <p className="text-[11px] text-slate-500">fuori dai turni del team</p>
          </div>
          <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Lead generati
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{view.stats.leads}</p>
            <p className="text-[11px] text-slate-500">dalle chat con Ambrosio</p>
          </div>
          <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <HelpCircle className="h-3.5 w-3.5" aria-hidden />
              Domande ricevute
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{view.stats.questions.length || "—"}</p>
            <p className="text-[11px] text-slate-500">vedi l&apos;elenco in «Addestramento»</p>
          </div>
        </div>
        {view.stats.conversations === 0 && (
          <p className="mt-3 text-xs text-slate-500">
            Nessuna conversazione gestita ancora: le statistiche compaiono alla prima risposta di Ambrosio.
          </p>
        )}
      </section>

      {/* Gestione: una scheda = una pagina dedicata — badge dal layer dati */}
      <Card>
        <GlassSectionHeader
          icon={Settings2}
          title="Gestione di Ambrosio"
          subtitle="Una scheda per argomento: apri, regoli, chiudi."
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <HubCard
            href="/admin/ai/autonomia"
            Icon={Gauge}
            tone="bg-white/70 text-violet-600"
            title="Autonomia"
            text="I 3 livelli di gestione: dal solo contatto alla proposta con preventivo. Tetto mosse, take-over SLA e accessi."
            right={<HubStatus ok={autonomy.ok} warn={autonomy.warn} label={autonomy.label} />}
          />
          <HubCard
            href="/admin/ai/documenti"
            Icon={BookOpen}
            tone="bg-white/70 text-brand-700"
            title="Documenti"
            text="La biblioteca che istruisce Ambrosio: procedure, politiche e prezzi come verità dell'agenzia."
            right={<HubStatus ok={documents.ok} warn={documents.warn} label={documents.label} />}
          />
          <HubCard
            href="/admin/ai/proposte"
            Icon={FileText}
            tone="bg-white/70 text-emerald-700"
            title="Proposte"
            text="Le bozze con preventivo preparate da Ambrosio: le revisioni il team, poi si inviano."
            right={<HubStatus ok={proposals.ok} warn={proposals.warn} label={proposals.label} />}
          />
          <HubCard
            href="/admin/ai/addestramento"
            Icon={GraduationCap}
            tone="bg-white/70 text-violet-600"
            title="Addestramento"
            text="Le domande vere dei clienti diventano risposte ufficiali, con bozze AI da verificare. Qui anche l'uso reale di risposte e azioni."
            right={
              <span className="flex flex-wrap items-center justify-end gap-1.5">
                {training.counts.map((c) => (
                  <span
                    key={c.label}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200/70 tabular-nums"
                  >
                    {c.n} {c.label}
                  </span>
                ))}
                <HubStatus ok={training.ok} warn={training.warn} label={training.label} />
              </span>
            }
          />
          <HubCard
            href="/admin/ai/configurazione"
            Icon={Settings2}
            tone="bg-white/70 text-slate-600"
            title="Configurazione"
            text="On/off, provider, modello, chiave API, prompt di sistema e creatività: il carattere di Ambrosio."
            right={<HubStatus ok={config.ok} warn={config.warn} label={config.label} />}
          />
          <HubCard
            href="/admin/ai/provider"
            Icon={KeyRound}
            tone="bg-white/70 text-brand-700"
            title="Intelligenze multiple"
            text="Più chiavi con fallback automatico: se un provider va in errore, Ambrosio passa da sola al successivo."
            right={<HubStatus ok={provider.ok} warn={provider.warn} label={provider.label} />}
          />
          <HubCard
            href="/admin/ai/test"
            Icon={FlaskConical}
            tone="bg-white/70 text-violet-600"
            title="Prova dal vivo"
            text="Simula una domanda cliente e leggi la risposta: serve chiave salvata e Ambrosio attiva."
          />
          <HubCard
            href="/admin/ai/inventario"
            Icon={Activity}
            tone="bg-white/70 text-violet-600"
            title="Inventario AI"
            text="La mappa completa di funzioni e salute: moduli, gate dei livelli, provider attivi, ultimo audit — in una pagina sola."
          />
        </div>
      </Card>

      <p className="px-1 text-[11px] leading-relaxed text-slate-500">
        Sicurezza: la chiave API è cifrata (AES-256-GCM) e resta sul server; il browser del cliente non la vede mai.
        Il rate limit anti-spam copre anche l&apos;endpoint AI (10 domande/min per IP).
      </p>
    </div>
  );
}