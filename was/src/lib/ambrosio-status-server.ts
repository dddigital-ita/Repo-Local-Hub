import {
  getAiFaqs,
  getAiSettings,
  getAiStats,
  rankFaqSuggestions,
  type AiFaq,
  type AiStats,
} from "@/lib/ai";
import { getAutonomyConfig, listDocuments, listProposals } from "@/lib/ambrosio-server";
import {
  aiConfigStatus,
  autonomyStatus,
  documentsStatus,
  proposalsStatus,
  providerStatus,
  trainingStatus,
  type HubCardStatus,
} from "@/lib/settings-status";

/**
 * STATO DELL'HUB AMBROSIO (server-only): UN SOLO punto di caricamento che
 * restituisce sia gli stati per i badge delle schede sia i dati della
 * dashboard (stato corrente + statistiche 30 giorni). Prima la pagina
 * derivava i badge inline DOPPIO-caricando le stesse fonti (settings-status
 * + getAiStats/getAiFaqs per la dashboard): qui la lettura avviene una
 * volta sola e ogni decisione di badge vive nella funzione pura di
 * `settings-status.ts` (testabile con import diretto del .ts).
 *
 * Robustezza: ogni lettura degredisce da sola — DB assente o tabelle non
 * migrate producono i default sicuri, mai un 500 dell'hub.
 */

export type AmbrosioStatuses = {
  statuses: {
    training: HubCardStatus;
    config: HubCardStatus;
    provider: HubCardStatus;
    autonomy: HubCardStatus;
    documents: HubCardStatus;
    proposals: HubCardStatus;
  };
  /** Dati di visualizzazione per la dashboard in cima alla pagina. */
  view: {
    enabled: boolean;
    hasKey: boolean;
    provider: string | null;
    model: string | null;
    stats: AiStats;
    faqs: AiFaq[];
    activeFaqs: number;
    uncovered: number;
    level: number;
    movesCap: number;
    /** Take-over SLA L3 attivo (switch dell'autonomia, migration 028). */
    takeoverSla: boolean;
  };
};

export async function getAmbrosioStatuses(): Promise<AmbrosioStatuses> {
  const [ai, stats, faqs, auto, docs, proposals] = await Promise.all([
    getAiSettings().catch(() => null),
    getAiStats(30).catch(() => null),
    getAiFaqs().catch(() => [] as AiFaq[]),
    getAutonomyConfig().catch(() => null),
    listDocuments(true).catch(() => []),
    listProposals(50).catch(() => []),
  ]);

  const activeFaqs = (faqs ?? []).filter((f) => f.active).length;
  /** Domande vere degli ultimi 30 giorni non ancora coperte da una FAQ. */
  const uncovered = rankFaqSuggestions(stats?.questionCounts ?? [], faqs ?? []).filter(
    (s) => !s.covered,
  ).length;

  const level = auto?.level ?? ai?.level ?? 1;
  const activeDocs = (docs ?? []).filter((d) => d.active).length;
  const drafts = (proposals ?? []).filter((p) => p.status === "draft").length;

  return {
    statuses: {
      training: trainingStatus(activeFaqs, uncovered),
      config: aiConfigStatus(Boolean(ai?.enabled), Boolean(ai?.hasKey)),
      provider: providerStatus(Boolean(ai?.hasKey)),
      autonomy: autonomyStatus(level),
      documents: documentsStatus(activeDocs),
      proposals: proposalsStatus(drafts),
    },
    view: {
      enabled: Boolean(ai?.enabled),
      hasKey: Boolean(ai?.hasKey),
      provider: ai?.provider ?? null,
      model: ai?.model ?? null,
      stats: stats ?? {
        conversations: 0,
        replies: 0,
        nightConversations: 0,
        questions: [],
        questionCounts: [],
        leads: 0,
        repliesPerConv: "—",
      },
      faqs: faqs ?? [],
      activeFaqs,
      uncovered,
      level,
      movesCap: auto?.movesCap ?? ai?.movesCap ?? 4,
      takeoverSla: auto?.takeoverSla ?? true,
    },
  };
}
