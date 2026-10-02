import { db } from "./db";
import { getSeoConfig, type SeoConfig } from "./seo";

/**
 * Backup AUTOMATICI settimanali della config SEO: il cron tick archivia la
 * config corrente in content_settings (key `seo_backups`, max 4 snapshot —
 * i più vecchi cadono). Nessuna nuova tabella: stesso pattern key-value di
 * seo_config. Differenza dall'export manuale: questi restano nel DB e si
 * scaricano dalla pagina SEO, pronti per il confronto/ripristino.
 *
 * Dedup settimanale: non si archivia se l'ultimo snapshot è più recente di
 * 7 giorni E la config non è cambiata da allora (confronto JSON). Se è
 * cambiata, si archivia comunque (ogni evoluzione settimanale è preziosa).
 */

const KEY = "seo_backups";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const SEO_BACKUPS_MAX = 4;

export interface SeoBackupEntry {
  /** ISO dello snapshot. */
  takenAt: string;
  /** Sistema o operatore (per i backup manuali promossi a storici, se mai). */
  takenBy: string;
  /** Config COMPLETA al momento dello snapshot. */
  config: SeoConfig;
}

/** Legge gli snapshot automatici (il più recente in testa). */
export async function listSeoBackups(): Promise<SeoBackupEntry[]> {
  const pool = db();
  if (!pool) return [];
  try {
    const { rows } = await pool.query<{ value: unknown }>(
      "select value from content_settings where key = $1",
      [KEY],
    );
    const raw = rows[0]?.value;
    if (!Array.isArray(raw)) return [];
    return (raw as unknown[])
      .slice(0, SEO_BACKUPS_MAX)
      .map((x): SeoBackupEntry | null => {
        const e = (x ?? {}) as Record<string, unknown>;
        if (typeof e.takenAt !== "string" || !e.config || typeof e.config !== "object") return null;
        return {
          takenAt: e.takenAt.slice(0, 40),
          takenBy: typeof e.takenBy === "string" ? e.takenBy.slice(0, 200) : "system",
          config: e.config as SeoConfig,
        };
      })
      .filter((e): e is SeoBackupEntry => e !== null);
  } catch {
    return [];
  }
}

/**
 * Serializzazione CANONICA (chiavi ordinate ricorsivamente): il confronto
 * di dedup non può usare JSON.stringify diretto perché jsonb riordina le
 * chiavi al salvataggio — due config identiche produrrebbero stringhe
 * diverse e lo snapshot verrebbe duplicato a ogni tick.
 */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * Punto del cron: se è passato almeno una settimana dall'ultimo snapshot
 * (o la config è cambiata da allora) archivia la config corrente. Mai
 * bloccante: gli errori sono loggati, il tick continua.
 */
export async function takeSeoBackup(): Promise<boolean> {
  const pool = db();
  if (!pool) return false;
  try {
    const config = await getSeoConfig();
    const configJson = stableStringify(config);
    const existing = await listSeoBackups();
    const last = existing[0];
    if (last) {
      const age = Date.now() - new Date(last.takenAt).getTime();
      const unchanged = stableStringify(last.config) === configJson;
      if (age < WEEK_MS && unchanged) return false; // già coperta: niente da fare
    }
    const entry: SeoBackupEntry = {
      takenAt: new Date().toISOString(),
      takenBy: "system",
      config,
    };
    const next = [entry, ...existing].slice(0, SEO_BACKUPS_MAX);
    await pool.query(
      `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
       on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
      [KEY, JSON.stringify(next)],
    );
    return true;
  } catch (e) {
    console.error("[seo-backups]", e instanceof Error ? e.message : e);
    return false;
  }
}
