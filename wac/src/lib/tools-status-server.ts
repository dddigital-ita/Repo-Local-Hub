import { db } from "@/lib/db";
import { getSiteTheme } from "@/lib/theme";
import { getHeroConfig } from "@/lib/hero";
import { heroStatus } from "@/lib/hero-shared";
import { getIntegrationStatus } from "@/lib/integrations-status";
import { backupStatus, themeStatus } from "@/lib/tools-status";
import type { HubCardStatus } from "@/lib/settings-status";
import type { IntegrationStatus } from "@/lib/integrations-status";

/**
 * STATO DELL'HUB TOOLS (server-only): carica i dati grezzi e delega ogni
 * decisione alle funzioni pure di `tools-status.ts`. Le schede Google e
 * Notion riusano gli STESSI reader del registro integrazioni
 * (`getIntegrationStatus`) — una sola fonte di verità per quei servizi.
 * Ogni lettura degredisce da sola: mai un 500 dell'hub.
 */

export type ToolsStatuses = {
  theme: HubCardStatus;
  hero: HubCardStatus;
  backup: HubCardStatus;
  /** Stato dal registro (def inclusa): null se la def non esiste più. */
  google: IntegrationStatus | null;
  notion: IntegrationStatus | null;
};

async function readBackupStatus(): Promise<HubCardStatus> {
  const pool = db();
  if (!pool) return backupStatus({ available: false, lastCreated: null, lastError: null });
  try {
    const { rows } = await pool.query<{ action: string; created_at: string }>(
      `select action, created_at from audit_log
       where action in ('backup.creato', 'backup.errore')
       order by created_at desc limit 1`,
    );
    const last = rows[0];
    return backupStatus({
      available: true,
      lastCreated: last?.action === "backup.creato" ? last.created_at : null,
      lastError: last?.action === "backup.errore" ? last.created_at : null,
    });
  } catch {
    // audit non ancora migrato: nessuna informazione, stato neutro.
    return backupStatus({ available: false, lastCreated: null, lastError: null });
  }
}

export async function getToolsStatuses(): Promise<ToolsStatuses> {
  const [theme, hero, backup, google, notion] = await Promise.all([
    getSiteTheme()
      .then((t) => themeStatus(t))
      .catch(() => themeStatus(null)),
    getHeroConfig()
      .then((h) => heroStatus(h))
      .catch(() => heroStatus(null)),
    readBackupStatus(),
    getIntegrationStatus("google").catch(() => null),
    getIntegrationStatus("notion").catch(() => null),
  ]);
  return { theme, hero, backup, google, notion };
}
