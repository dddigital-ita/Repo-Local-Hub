import { dedupeByKey, hubSummary, pendingOf, type HubCardStatus } from "@/lib/settings-status";
import { getSettingsStatuses } from "@/lib/settings-status-server";
import { getToolsStatuses } from "@/lib/tools-status-server";
import { getAmbrosioStatuses } from "@/lib/ambrosio-status-server";
import type { IntegrationStatus } from "@/lib/integrations-status";
import { getIntegrationStatuses } from "@/lib/integrations-status";
import { destinationLabel } from "@/lib/admin-destinations";

/**
 * RIEPILOGO DELLA CONFIGURAZIONE PER LA PANORAMICA: una riga per hub, letta
 * DAGLI STESSI layer dati che alimentano le pill degli header. Qui non vive
 * nessuna regola di stato: quali schede sono incomplete è deciso dalle
 * funzioni pure (hubSummary/pendingOf), quali letture fare dai reader —
 * la Panoramica compone e presenta.
 *
 * Robustezza: ogni lettura degredisce da sola (i reader sono già safe) —
 * un hub che fallisce non spezza gli altri né la pagina.
 */

export type ConfigRow = {
  label: string;
  href: string;
  ok: boolean;
  warn: boolean;
  /** Etichetta della pill di riepilogo («N schede da completare»). */
  summary: string;
  /** Schede ambra come salti diretti: nome canonico (dal catalogo condiviso
      con la palette) + href. L'ordine segue le chiavi di `pendingOf`. */
  pending: { label: string; href: string }[];
};

/**
 * Le schede ambra di un hub, come salti diretti nominati. Dedup per href
 * (più chiavi → stessa pagina, es. «chiave» e «provider»); le chiavi senza
 * href spariscono; il nome viene dal catalogo condiviso con la palette —
 * se un href non è catalogato resta l'href (mai un nome inventato).
 */
function pendingHrefs(
  statuses: readonly (HubCardStatus | null)[],
  hrefs: Record<string, string>,
): { label: string; href: string }[] {
  const keys = pendingOf(statuses.filter((s): s is HubCardStatus => s !== null));
  const hrefSet = new Set(
    keys.flatMap((key) => (hrefs[key] ? [hrefs[key]] : [])),
  );
  return [...hrefSet].map((href) => ({ label: destinationLabel(href), href }));
}

function hubRow(
  label: string,
  href: string,
  statuses: readonly (HubCardStatus | null)[],
  hrefs: Record<string, string>,
): ConfigRow {
  const valid = statuses.filter((s): s is HubCardStatus => s !== null);
  const summary = hubSummary(valid);
  return {
    label,
    href,
    ok: summary.ok,
    warn: summary.warn,
    summary: summary.label,
    pending: pendingHrefs(valid, hrefs),
  };
}

/**
 * Una integrazione dal registro, come stato dell'hub (chiave = key della def).
 * Le def senza reader (stato neutro «Presente») sono escluse: nessuna azione,
 * non è un'incompletezza — coerente con l'hub Tools che le lascia senza pill.
 */
function asHubStatus(integration: IntegrationStatus | null): HubCardStatus | null {
  if (!integration) return null;
  return { key: integration.def.key, ok: !integration.warn, warn: integration.warn, label: integration.def.label, counts: [] };
}

/** Le integrazioni del registro, come stati dell'hub (chiave = key della def). */
function asHubStatuses(integrations: IntegrationStatus[]): HubCardStatus[] {
  return integrations.flatMap((i) => {
    const s = asHubStatus(i);
    return s ? [s] : [];
  });
}

const SETTINGS_HREFS: Record<string, string> = {
  email: "/admin/settings/email",
  whatsapp: "/admin/settings/whatsapp",
  cloudflare: "/admin/settings/cloudflare",
  "lead-followup": "/admin/settings/lead-followup",
  notion: "/admin/notion",
  google: "/admin/settings/google",
  drive: "/admin/settings/drive",
};
// Le integrazioni contano nella riga Impostazioni (che mostra la
// sezione Integrazioni completa); Notion compare anche nella riga
// Tools perché l'hub Tools la espone ancora tra le pagine di sistema.
// I link di ogni riga sono univoci (pendingHrefs).

const TOOLS_HREFS: Record<string, string> = {
  tema: "/admin/tools/theme",
  hero: "/admin/tools/hero",
  backup: "/admin/tools/backup",
  notion: "/admin/notion",
};

const AI_HREFS: Record<string, string> = {
  addestramento: "/admin/ai/addestramento",
  configurazione: "/admin/ai/configurazione",
  provider: "/admin/ai/provider",
  chiave: "/admin/ai/provider",
  attivazione: "/admin/ai/configurazione",
};

/** Le tre righe di riepilogo per la Panoramica: una per hub. */
export async function getOverviewConfig(): Promise<ConfigRow[]> {
  const [settings, tools, ai, integrations] = await Promise.all([
    getSettingsStatuses(),
    getToolsStatuses(),
    getAmbrosioStatuses(),
    getIntegrationStatuses(),
  ]);

  return [
    hubRow(
      "Impostazioni",
      "/admin/settings",
      // Stessa composizione della pill dell'hub Impostazioni: le
      // integrazioni del registro contano lì e qui.
      [settings.email, settings.whatsapp, settings.followup, settings.cloudflare, ...asHubStatuses(integrations)],
      SETTINGS_HREFS,
    ),
    hubRow(
      "Tools",
      "/admin/tools",
      [tools.theme, tools.hero, tools.backup, asHubStatus(tools.notion)],
      TOOLS_HREFS,
    ),
    hubRow(
      "Ambrosio",
      "/admin/ai",
      // Stessa composizione della pill dell'hub AI, dedup incluso: gli
      // stati con la stessa chiave contano una volta sola.
      dedupeByKey([
        ai.statuses.training,
        ai.statuses.config,
        ai.statuses.provider,
        // Stato vitale con chiave stabile, come nella pill dell'hub AI.
        { key: "chiave", ok: ai.view.hasKey, warn: !ai.view.hasKey, label: "", counts: [] },
        {
          key: "attivazione",
          ok: ai.view.enabled,
          warn: !ai.view.enabled && ai.view.hasKey,
          label: "",
          counts: [],
        },
      ]),
      AI_HREFS,
    ),
  ];
}
