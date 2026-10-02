import { db } from "@/lib/db";
import { cache } from "react";
import { readThroughDbConfig } from "@/lib/db-config-cache";
import { getSiteTheme } from "@/lib/theme";
import { getHeroConfig } from "@/lib/hero";
import { heroStatus } from "@/lib/hero-shared";
import { getIntegrationStatus } from "@/lib/integrations-status";
import { backupStatus, themeStatus } from "@/lib/tools-status";
import type { HubCardStatus } from "@/lib/settings-status";
import type { IntegrationStatus } from "@/lib/integrations-status";

/**
 * STATO DELL'HUB TOOLS (server-only): carica i dati grezzi e delega ogni
 * decisione alle funzioni pure di `tools-status.ts`. La scheda Notion
 * riusa gli STESSI reader del registro integrazioni
 * (`getIntegrationStatus`) — una sola fonte di verità per quel servizio.
 * (Il Google growth kit vive in Impostazioni › Integrazioni: il suo
 * stato lo legge solo il layer delle integrazioni.)
 * Ogni lettura degredisce da sola: mai un 500 dell'hub.
 */

export type ToolsStatuses = {
  theme: HubCardStatus;
  hero: HubCardStatus;
  backup: HubCardStatus;
  /** Stato dal registro (def inclusa): null se la def non esiste più. */
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

/** Memoizzato per richiesta (cache() di React, ADR-005): la Panoramica compone
 *  questo layer insieme a Impostazioni e Integrazioni nella STESSA richiesta —
 *  senza dedup tema/hero/backup/integrazioni sarebbero letti il doppio. Le
 *  config di tema e hero passano dal TTL condiviso (60s, ADR-005 esteso:
 *  cambiano solo a salvataggio; l'età del backup resta letta dal DB — è
 *  operationale, non configurazione). */
export const getToolsStatuses = cache(async (): Promise<ToolsStatuses> => {
  const [theme, hero, backup, notion] = await Promise.all([
    readThroughDbConfig("site_theme", getSiteTheme)
      .then((t) => themeStatus(t))
      .catch(() => themeStatus(null)),
    readThroughDbConfig("hero_config", getHeroConfig)
      .then((h) => heroStatus(h))
      .catch(() => heroStatus(null)),
    readBackupStatus(),
    getIntegrationStatus("notion").catch(() => null),
  ]);    return { theme, hero, backup, notion };
});
