import { db } from "@/lib/db";
import { cache } from "react";
import { readThroughDbConfig } from "@/lib/db-config-cache";
import { getNotionSettings } from "@/lib/notion";
import { getGoogleToolsConfig } from "@/lib/google-tools";
import { getDriveConfig } from "@/lib/drive";
import { getOneDriveConfig } from "@/lib/onedrive";
import { getGCalConfig } from "@/lib/google-calendar";
import { getHubConfig } from "@/lib/calendar-hub";
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

/** 「in coda」+ «Ultimo sync» per Notion. La config passa dal TTL condiviso
 *  (60s, ADR-005 esteso: cambia solo a salvataggio); la coda e l'ultimo sync
 *  restano letture DB vive (operationale, non configurazione). */
async function readNotion(): Promise<Pick<IntegrationStatus, "ok" | "warn" | "label" | "counts" | "meta">> {
  const notion = await readThroughDbConfig("notion_settings", getNotionSettings);
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

/** Google: collegato solo con credenziali Search Console API (le query reali di /admin/seo). La regola vive nella funzione pura condivisa con l'hub Tools. Config via TTL condiviso (60s, cambia solo a salvataggio). */
async function readGoogle(): Promise<Pick<IntegrationStatus, "ok" | "warn" | "label" | "counts" | "meta">> {
  const google = await readThroughDbConfig("google_tools", getGoogleToolsConfig);
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
  // Config (credenziali + esiti test) via TTL condiviso: cambia a salvataggio o test esplicito.
  const drive = await readThroughDbConfig("drive_config", getDriveConfig);
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
  // Config (credenziali + esiti test) via TTL condiviso: cambia a salvataggio o test esplicito.
  const gcal = await readThroughDbConfig("gcal_config", getGCalConfig);
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

/**
 * OneDrive: stessa semantica di Drive — credenziali salvate =
 * «Da verificare» (il salvataggio da solo non dimostra che
 * l'app sia registrata, i permessi concessi e Graph raggiungibile);
 * dopo un test riuscito diventa «Collegato».
 */
async function readOneDrive(): Promise<Pick<IntegrationStatus, "ok" | "warn" | "label" | "counts" | "meta">> {
  // Config (credenziali + esiti test) via TTL condiviso: cambia a salvataggio o test esplicito.
  const od = await readThroughDbConfig("onedrive_config", getOneDriveConfig);
  if (!od.hasCreds) {
    return { ok: false, warn: true, label: "Da collegare", counts: [], meta: [] };
  }
  const ok = od.lastTestOk === true;
  return {
    ok,
    warn: !ok,
    label: ok ? "Collegato" : "Da verificare",
    counts: [],
    meta: od.lastTestAt
      ? [
          `Ultimo test: ${new Date(od.lastTestAt).toLocaleDateString("it-IT", { day: "numeric", month: "short" })}`,
          od.clientId ?? "",
        ].filter(Boolean)
      : od.clientId
        ? [od.clientId]
        : [],
  };
}

/**
 * iCal (modello calendar-board del gemello, divergenza
 * dichiarata): le sorgenti esterne sono RIGHE di
 * `calendar_sources` (kind='ics', toggle `visible`) — non
 * l'array `icalUrls` in config di Crema — e il feed del
 * team è `/api/calendar/export` con `export_token` in
 * `calendar_hub_config` (qui `getHubConfig`, non
 * `exportTokenHash`). Nessuna chiave da incollare: la
 * configurazione sono le righe sorgente e il token.
 */
async function readIcal(): Promise<Pick<IntegrationStatus, "ok" | "warn" | "label" | "counts" | "meta">> {
  // Config via TTL condiviso (60s, ADR-005): cambia a salvataggio o rotazione token.
  const cfg = await readThroughDbConfig("calendar_hub_config", getHubConfig);
  const pool = db();
  let total = 0;
  let active = 0;
  let imported = 0;
  if (pool) {
    try {
      const q = await pool.query<{ n: string; a: string }>(
        "select count(*) filter (where kind = 'ics') as n, count(*) filter (where kind = 'ics' and visible) as a from calendar_sources",
      );
      total = Number(q.rows[0]?.n ?? 0);
      active = Number(q.rows[0]?.a ?? 0);
    } catch {
      // tabella non ancora migrata
    }
    try {
      const q = await pool.query<{ n: string }>(
        "select count(*) as n from calendar_items ci join calendar_sources cs on cs.id = ci.source_id where cs.kind = 'ics'",
      );
      imported = Number(q.rows[0]?.n ?? 0);
    } catch {
      // tabella non ancora migrata
    }
  }
  const feed = cfg.export_token ? "feed esportazione attivo" : "";
  if (total === 0) {
    return { ok: false, warn: true, label: "Da collegare", counts: [], meta: feed ? [feed] : [] };
  }
  return {
    ok: active > 0,
    warn: false,
    label: active > 0 ? "Attivo" : "Collegato",
    counts: [{ n: active, label: "sorgenti" }],
    meta: [
      imported > 0 ? `${imported} eventi importati` : "",
      active > 0 ? "pull attivo" : "pull spento",
      feed,
    ].filter(Boolean),
  };
}

const READERS: Record<string, () => Promise<Partial<IntegrationStatus>>> = {
  notion: readNotion,
  google: readGoogle,
  drive: readDrive,
  gcal: readGCal,
  onedrive: readOneDrive,
  ical: readIcal,
};

/**
 * Stato di UNA integrazione per chiave — il modo pulito per un'altra pagina
 * (es. hub Tools) di riusare gli stessi reader senza duplicare query.
 *
 * ADR-005 (fan-out): esegue SOLO il reader richiesto. La versione precedente
 * delegava a getIntegrationStatuses() e pagava TUTTI i reader (Notion, Google,
 * Drive, GCal) per tornare UNA pill: l'hub Tools eseguiva così il registro due
 * volte (due chiamate = otto reader). Le funzioni memoizzate sono precostruite
 * per chiave (identità stabile = dedup di cache() funzionante): le richieste
 * che chiedono la STESSA chiave condividono la Promise, i diversi reader
 * restano indipendenti.
 */
export async function getIntegrationStatus(key: string): Promise<IntegrationStatus | null> {
  const def = INTEGRATION_DEFS.find((d) => d.key === key);
  if (!def) return null;
  const single = CACHED_SINGLE[key];
  if (!single) {
    return { def, ok: false, warn: false, label: "Presente", counts: [], meta: [] };
  }
  try {
    return await single();
  } catch {
    return { def, ok: false, warn: false, label: "Presente", counts: [], meta: [] };
  }
}

/**
 * UNA funzione memoizzata per richiesta (cache() di React) PER OGNI def del
 * registro, precostruita a livello modulo: l'identità stabile della funzione
 * è ciò che rende effettiva la dedup dentro la stessa richiesta. Il corpo
 * ricalcola con lo stesso contratto di getIntegrationStatuses per quella def
 * sola (fallback «Presente» senza reader, degradazione al chiamante).
 */
const CACHED_SINGLE: Record<string, () => Promise<IntegrationStatus>> = Object.fromEntries(
  INTEGRATION_DEFS.map((def) => [
    def.key,
    cache(async (): Promise<IntegrationStatus> => {
      const reader = READERS[def.key];
      if (!reader) {
        return { def, ok: false, warn: false, label: "Presente", counts: [], meta: [] };
      }
      const s = await reader();
      return { def, ok: s.ok ?? false, warn: s.warn ?? false, label: s.label ?? "Presente", counts: s.counts ?? [], meta: s.meta ?? [] };
    }),
  ]),
);

/** Stato di TUTTE le integrazioni del registro, in ordine di definizione.
 *  Memoizzato per richiesta (cache() di React): chi compone più hub nella
 *  STESSA richiesta (Panoramica) paga una sola serie di letture. */
export const getIntegrationStatuses = cache(async (): Promise<IntegrationStatus[]> => {
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
});
