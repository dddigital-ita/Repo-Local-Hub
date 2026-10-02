import { db } from "@/lib/db";
import { getNotionSettings } from "@/lib/notion";
import { getGoogleToolsConfig } from "@/lib/google-tools";
import { getDriveConfig } from "@/lib/drive";
import { getGCalConfig } from "@/lib/google-calendar";
import { googleKitStatus } from "@/lib/tools-status";
import { INTEGRATION_DEFS, type IntegrationDef } from "@/lib/integrations-registry";

/**
 * STATO DELLE INTEGRAZIONI (server-only): per ogni def del registro carica
 * la config dal DB e calcola lo stato mostrato dall'hub (pill + conteggi).
 * Una def senza reader → stato neutro «Presente»: l'hub si popola comunque
 * (self-healing UI), il badge dettagliato è opzionale.
 */

export type IntegrationStatus = {
  def: IntegrationDef;
  ok: boolean;
  warn: boolean;
  label: string;
  /** Conteggi live opzionali: { n, label } o testo libero (es. «Ultimo sync: …»). */
  counts: { n: number; label: string }[];
  meta: string[];
};

/** 「in coda」+ «Ultimo sync» per Notion, letti come già faceva l'hub. */
async function readNotion(): Promise<Pick<IntegrationStatus, "ok" | "warn" | "label" | "counts" | "meta">> {
  const notion = await getNotionSettings();
  const ok = Boolean(notion?.enabled && notion.hasKey);
  const pool = db();
  let pending: number | null = null;
  let lastSync: string | null = null;
  if (pool) {
    try {
      const q = await pool.query<{ n: string }>(
        "select count(*) as n from leads where notion_synced_at is null",
      );
      pending = Number(q.rows[0]?.n ?? 0);
    } catch {
      // colonna non ancora migrata
    }
    try {
      const last = await pool.query<{ created_at: string }>(
        "select created_at from audit_log where action = 'notion.sync' order by created_at desc limit 1",
      );
      lastSync = last.rows[0]?.created_at ?? null;
    } catch {
      // audit non ancora migrato
    }
  }
  return {
    ok,
    warn: !ok,
    label: ok ? "Pronto" : "In attesa chiavi",
    counts: pending !== null ? [{ n: pending, label: "in coda" }] : [],
    meta: lastSync
      ? [`Ultimo sync: ${new Date(lastSync).toLocaleDateString("it-IT", { day: "numeric", month: "short" })}`]
      : [],
  };
}

/** Google: collegato solo con credenziali Search Console API (le query reali di /admin/seo). La regola vive nella funzione pura condivisa con l'hub Tools. */
async function readGoogle(): Promise<Pick<IntegrationStatus, "ok" | "warn" | "label" | "counts" | "meta">> {
  const google = await getGoogleToolsConfig();
  const s = googleKitStatus(google.hasGscCreds, [google.ga4Id, google.gtmId].filter(Boolean).length);
  return { ok: s.ok, warn: s.warn, label: s.label, counts: s.counts, meta: [] };
}

/**
 * Drive: credenziali salvate = configurato ma NON ancora verificato («Da
 * verificare», ambra); dopo un test riuscito diventa «Collegato». Il salvataggio
 * da solo non basta: il JSON potrebbe avere la API spenta o la cartella non
 * condivisa — solo il test reale lo dimostra.
 */
async function readDrive(): Promise<Pick<IntegrationStatus, "ok" | "warn" | "label" | "counts" | "meta">> {
  const drive = await getDriveConfig();
  if (!drive.hasCreds) {
    return { ok: false, warn: true, label: "Da collegare", counts: [], meta: [] };
  }
  const ok = drive.lastTestOk === true;
  return {
    ok,
    warn: !ok,
    label: ok ? "Collegato" : "Da verificare",
    counts: [],
    meta: drive.lastTestAt
      ? [
          `Ultimo test: ${new Date(drive.lastTestAt).toLocaleDateString("it-IT", { day: "numeric", month: "short" })}`,
          drive.clientEmail ?? "",
        ].filter(Boolean)
      : drive.clientEmail
        ? [drive.clientEmail]
        : [],
  };
}

/**
 * Google Calendar: stessa semantica di Drive — credenziali salvate =
 * «Da verificare» (il salvataggio da solo non dimostra che l'API sia
 * attiva e il calendario condiviso); dopo un test riuscito diventa
 * «Collegato» (o «Attivo» col toggle della sync acceso). Con il mirror
 * Notion attivo, un meta lo dice: chi guarda la pill sa che la callback
 * finisce in due posti, non uno.
 */
async function readGCal(): Promise<Pick<IntegrationStatus, "ok" | "warn" | "label" | "counts" | "meta">> {
  const gcal = await getGCalConfig();
  if (!gcal.hasCreds || !gcal.calendarId) {
    return { ok: false, warn: true, label: "Da collegare", counts: [], meta: [] };
  }
  const tested = gcal.lastTestOk === true;
  const label = !tested ? "Da verificare" : gcal.enabled ? "Attivo" : "Collegato";
  const pool = db();
  let created24h: number | null = null;
  if (pool) {
    try {
      const q = await pool.query<{ n: string }>(
        "select count(*) as n from gcal_sync_log where action = 'create' and created_at > now() - interval '24 hours'",
      );
      created24h = Number(q.rows[0]?.n ?? 0);
    } catch {
      // tabella non ancora migrata
    }
  }
  return {
    ok: tested,
    warn: !tested,
    label,
    counts: created24h !== null && created24h > 0 ? [{ n: created24h, label: "eventi 24h" }] : [],
    meta: gcal.syncToNotion ? ["mirror Notion"] : [],
  };
}

const READERS: Record<string, () => Promise<Partial<IntegrationStatus>>> = {
  notion: readNotion,
  google: readGoogle,
  drive: readDrive,
  gcal: readGCal,
};

/**
 * Stato di UNA integrazione per chiave — il modo pulito per un'altra pagina
 * (es. hub Tools) di riusare gli stessi reader senza duplicare query.
 */
export async function getIntegrationStatus(key: string): Promise<IntegrationStatus | null> {
  const def = INTEGRATION_DEFS.find((d) => d.key === key);
  if (!def) return null;
  const statuses = await getIntegrationStatuses();
  return statuses.find((s) => s.def.key === key) ?? null;
}

/** Stato di TUTTE le integrazioni del registro, in ordine di definizione. */
export async function getIntegrationStatuses(): Promise<IntegrationStatus[]> {
  return Promise.all(
    INTEGRATION_DEFS.map(async (def): Promise<IntegrationStatus> => {
      const reader = READERS[def.key];
      if (!reader) {
        // Nessun reader: l'integrazione esiste ma non ha stato dettagliato.
        return { def, ok: false, warn: false, label: "Presente", counts: [], meta: [] };
      }
      try {
        const s = await reader();
        return { def, ok: s.ok ?? false, warn: s.warn ?? false, label: s.label ?? "Presente", counts: s.counts ?? [], meta: s.meta ?? [] };
      } catch {
        return { def, ok: false, warn: false, label: "Presente", counts: [], meta: [] };
      }
    }),
  );
}
