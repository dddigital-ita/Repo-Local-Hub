import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { db } from "./db";
import { logAudit } from "./audit";
import { notifyAdmin } from "./notify";
import { buildBackupPayload, recordBackup } from "./maintenance";
import { oggiRoma, allarmeBackupCloudPure, CLOUD_BACKUP_ALARM_KEY, ALARM_DOPO_GIORNI, CLOUD_BACKUP_PREFIX, parseCloudKey, type CloudKeyInfo } from "./backup-cloud-shared";
import type { CloudBackupInfo } from "./restore-shared";

/**
 * BACKUP AUTOMATICO NEL CLOUD (senza Mac acceso) — l'esecuzione vive qui,
 * il comando resta in [scripts/backup-full.mjs](../../scripts/backup-full.mjs).
 *
 * Veicolo: il cron tick già esistente (/api/cron/tick, ogni 15 minuti da
 * cron-job.org). A ogni tick decide SE è il momento del backup giornaliero
 * (dedup su content_settings: UNO al giorno, il primo tick utile dopo la
 * mezzanotte Roma) e, se sì:
 *   1. costruisce il payload col=formato restore JSON già testato
 *      (buildBackupPayload — stessa pipeline del download manuale);
 *   2. lo comprime (gzip) e calcola sha256;
 *   3. lo deposita su Neon Object Storage (bucket `backups`, chiave
 *      datata, private);
 *   4. lo RILEGGE dal bucket e verifica byte e sha256: il backup esiste
 *      solo se il file depositato è IDENTICO a quello generato;
 *   5. registra backup_history (actor system) + audit cron.backup-cloud;
 *   6. applica la retention (mantieni gli ultimi RETENTION, cancella il
 *      resto: il DB non può dipendere da Mac spenti o dimenticanze).
 *
 * Credenziali: le env AWS_* iniettate da Neon (branch-scoped) vengono
 * lette dall'SDK dalla catena standard; il bucket è privato. Le regole
 * del progetto non cambiano: niente credenziali nei log (redact), audit
 * con actor system, best-effort (un errore qui non tocca gli altri
 * automatismi del tick).
 */

const BUCKET = "backups";
const PREFIX = "auto/db-";
/** Backup automatici da mantenere nel bucket (i più recenti). */
export const RETENTION = 14;

/** Chiave content_settings della dedup giornaliera. */
export const BACKUP_CLOUD_STATE_KEY = "backup_cloud_last_day";

/* oggiRoma() e la regola dell'allarme vivono in backup-cloud-shared (pure, testate). */

function s3(): S3Client | null {
  // In assenza di credenziali (dev locale senza Neon Storage) il backup
  // automatico è spento: la funzione torna null e il chiamante salta.
  // NB: si legge process.env DIRETTO, non il parser `/^([A-Z_]+)=/` in uso
  // negli script — quella classe esclude le CIFRE e salterebbe
  // AWS_ENDPOINT_URL_S3 (il "3"!). Bug beccato dal test E2E.
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !process.env.AWS_ENDPOINT_URL_S3) {
    return null;
  }
  return new S3Client({
    forcePathStyle: true, // Neon richiede path-style addressing
    region: process.env.AWS_REGION ?? "eu-central-1",
    // L'endpoint del branch è OBBLIGATORIO: senza, l'SKD va su aws.amazon.com
    // e il bucket risponde PermanentRedirect (301) — visto dal vivo.
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
  });
}

/** true se il backup di oggi non è ancora stato fatto (lettura dedup). */
async function backupDiOggiDaFare(today: string): Promise<boolean> {
  const pool = db();
  if (!pool) return false;
  try {
    const { rows } = await pool.query<{ value: unknown }>(
      "select value from content_settings where key = $1",
      [BACKUP_CLOUD_STATE_KEY],
    );
    return rows[0]?.value !== today;
  } catch {
    return false;
  }
}

async function segnaFattoOggi(today: string): Promise<void> {
  const pool = db();
  if (!pool) return;
  await pool.query(
    `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [BACKUP_CLOUD_STATE_KEY, JSON.stringify(today)],
  );
}

/** sha256 di un Buffer (formattato come shasum, per il MANIFEST). */
function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export interface CloudBackupResult {
  done: boolean;
  reason?: "config_mancante" | "gia_fatto_oggi" | "errore";
  key?: string;
  bytes?: number;
  sha256?: string;
  error?: string;
}

/**
 * Il backup automatico giornaliero. Mai un throw: il tick lo chiama
 * best-effort come tutti gli altri automatismi.
 */
export async function runCloudBackup(actor = "system"): Promise<CloudBackupResult> {
  const client = s3();
  if (!client) return { done: false, reason: "config_mancante" };

  const today = oggiRoma();
  if (!(await backupDiOggiDaFare(today))) return { done: false, reason: "gia_fatto_oggi" };

  try {
    // 1-2. Payload nel formato restore JSON già testato, poi gzip.
    const payload = await buildBackupPayload(actor);
    const gz = gzipSync(Buffer.from(payload.json, "utf8"), { level: 9 });
    const digest = sha256(gz);
    const key = `${PREFIX}${today}-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.json.gz`;

    // 3. Deposit su Neon Object Storage (bucket privato, chiave datata).
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: gz,
        ContentType: "application/gzip",
        Metadata: { sha256: digest, rows: String(Object.values(payload.counts).reduce((a, b) => a + b, 0)) },
      }),
    );

    // 4. VERIFICA: rilegge il depositato e confronta byte e sha256.
    const back = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const backBuf = Buffer.from(await back.Body!.transformToByteArray());
    if (!backBuf.equals(gz) || sha256(backBuf) !== digest) {
      throw new Error("verifica del file depositato FALLITA: il backup non è valido");
    }

    // 5. Storico (append-only) + audit: stesso formato del backup manuale,
    //    così l'elenco in Tools → Backup mostra anche questi.
    await recordBackup({
      createdBy: "system",
      sizeBytes: payload.sizeBytes,
      counts: payload.counts,
    });
    await logAudit(actor, "cron.backup-cloud", key, `${(gz.length / 1024).toFixed(0)} KB gzip · sha256 ${digest.slice(0, 12)}… · tabelle ${Object.keys(payload.counts).length}`);

    // 6. Retention: mantieni gli ultimi RETENTION backup automatici.
    await applyRetention(client);

    await segnaFattoOggi(today);
    return { done: true, key, bytes: gz.length, sha256: digest };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Il motivo arriva in audit (senza credenziali: i messaggi SDK non le
    // contengono, ma per disciplina si tronca e si evita qualunque env).
    await logAudit(actor, "cron.backup-cloud-errore", null, msg.slice(0, 200)).catch(() => {});
    return { done: false, reason: "errore", error: msg.slice(0, 200) };
  }
}

/**
 * Retention: elenca i backup automatici nel bucket, cancella oltre i più
 * recenti RETENTION. Best-effort: un errore qui non invalida il backup
 * appena fatto (è già verificato e depositato).
 */
async function applyRetention(client: S3Client): Promise<number> {
  const list = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX }));
  const objs = (list.Contents ?? [])
    .filter((o) => o.Key && o.Key.startsWith(PREFIX))
    .sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0));
  const daEliminare = objs.slice(RETENTION).map((o) => ({ Key: o.Key! }));
  if (!daEliminare.length) return 0;
  await client.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: daEliminare } }));
  return daEliminare.length;
}

/** Ripristino di EMERGENZA: legge un backup automatico dal bucket. */
export async function readCloudBackup(key: string): Promise<Buffer | null> {
  const client = s3();
  if (!client) return null;
  try {
    const back = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return Buffer.from(await back.Body!.transformToByteArray());
  } catch {
    return null;
  }
}

/* ── Inventario e lettura dei backup nel bucket ───────────────────── */

function cloudEntry(
  o: { Key?: string; Size?: number; LastModified?: Date },
  head?: { Metadata?: Record<string, string> },
): CloudBackupInfo | null {
  const key = o.Key;
  if (!key) return null;
  const info: CloudKeyInfo | null = parseCloudKey(key);
  if (!info) return null;
  return {
    key,
    day: info.day,
    time: info.time,
    bytes: o.Size ?? 0,
    sha256: head?.Metadata?.sha256 ?? "",
    lastModified: (o.LastModified ?? new Date(0)).toISOString(),
  };
}

/**
 * Elenco dei backup automatici depositati nel bucket Neon, dal più recente.
 * Dimensione e ultima modifica arrivano da ListObjectsV2; sha256 (calcolato
 * al deposito e scritto nei metadata) e righe totali da HeadObject.
 * Solo le chiavi della forma attesa (parseCloudKey): l'imprevisto non
 * entra nella UI, il ripristino d'emergenza non propone ciò che non è.
 */
export async function listCloudBackups(): Promise<CloudBackupInfo[]> {
  const client = s3();
  if (!client) return [];
  const list = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: CLOUD_BACKUP_PREFIX }));
  const objs = (list.Contents ?? []).filter((o) => o.Key && parseCloudKey(o.Key));
  const heads = await Promise.all(
    objs.map(async (o) => {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: o.Key! }));
        return { key: o.Key!, meta: head.Metadata };
      } catch {
        // Un oggetto sparito tra list e head: un solo backup in meno in elenco.
        return null;
      }
    }),
  );
  const byKey = new Map(heads.filter((h): h is NonNullable<typeof h> => h !== null).map((h) => [h.key, { Metadata: h.meta }] as const));
  return objs
    .map((o) => cloudEntry(o, byKey.get(o.Key!)))
    .filter((e): e is CloudBackupInfo => e !== null)
    .sort((a, b) => (b.day + b.time).localeCompare(a.day + a.time));
}

/**
 * Il backup automatico scompattato, pronto per planRestore: gzip → JSON
 * stringa, con la verifica dell'identità (sha256 nei metadata vs calcolato
 * sulla lettura) prima di decomprimere: un file corrotto non passa.
 */
export async function readCloudBackupJson(
  key: string,
): Promise<{ ok: true; json: string; info: CloudBackupInfo } | { ok: false; error: string }> {
  if (!parseCloudKey(key)) return { ok: false, error: "Chiave non riconosciuta come backup automatico." };
  const client = s3();
  if (!client) return { ok: false, error: "Storage cloud non configurato (env AWS_* assenti)." };
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    const expected = head.Metadata?.sha256 ?? "";
    const gz = await readCloudBackup(key);
    if (!gz) return { ok: false, error: "Backup non trovato nel bucket (potrebbe essere stato rimosso)." };
    const digest = sha256(gz);
    if (expected && digest !== expected) {
      await logAudit("system", "cron.backup-cloud-corrotto", key, `sha256 atteso ${expected.slice(0, 12)}…, letto ${digest.slice(0, 12)}…`);
      return { ok: false, error: "Il file nel bucket non corrisponde al suo sha256: backup corrotto, restore bloccato." };
    }
    const json = gunzipSync(gz).toString("utf8");
    const probe = JSON.parse(json) as { meta?: { kind?: unknown } };
    if (probe?.meta?.kind !== "webagencysalento-backup") {
      return { ok: false, error: "Il file nel bucket non è un backup di questa applicazione." };
    }
    const size = head.ContentLength ?? gz.length;
    return {
      ok: true,
      json,
      info: {
        key,
        day: parseCloudKey(key)!.day,
        time: parseCloudKey(key)!.time,
        bytes: size,
        sha256: expected || digest,
        lastModified: head.LastModified?.toISOString() ?? new Date().toISOString(),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `Lettura del backup dal cloud non riuscita: ${e.message}` : "Lettura del backup dal cloud non riuscita." };
  }
}

/* ── Allarme: il backup cloud tace da troppo tempo ────────────────── */

/**
 * Rete di sicurezza del backup automatico. Il backup «non riesce» in modo
 * silenzioso (env storage mai configurate, S3 irraggiungibile, qualunque
 * cosa): con una copia al giorno promessa, il SILENZIO è lui stesso il
 * guasto. Suona quando non ci sono riusciti da ALMENO 2 giorni di fila
 * (o mai), al massimo UN messaggio al giorno (dedup su content_settings).
 *
 * Fonte dei dati: backup_history — runCloudBackup ci scrive SOLO dopo la
 * verifica del file, quindi l'ultimo created_by='system' È l'ultimo
 * successo; nessuna riga = mai riuscito. La logica di decisione è la
 * funzione PURA allarmeBackupCloudPure (testata in suite node).
 */
export async function allarmeBackupCloudSeDovuto(actor = "system"): Promise<boolean> {
  const pool = db();
  if (!pool) return false;
  let lastOkDay: string | null = null;
  let suonatoIl: string | null = null;
  try {
    const { rows } = await pool.query<{ created_at: string | Date }>(
      "select created_at from backup_history where created_by = 'system' order by created_at desc limit 1",
    );
    if (rows[0]) lastOkDay = oggiRoma(new Date(rows[0].created_at).getTime());
    const { rows: stato } = await pool.query<{ value: unknown }>("select value from content_settings where key = $1", [CLOUD_BACKUP_ALARM_KEY]);
    const v = stato[0]?.value;
    if (typeof v === "string") suonatoIl = v;
  } catch (e) {
    console.warn("[backup-cloud] allarme: stato illeggibile", e instanceof Error ? e.message : e);
    return false;
  }

  const d = allarmeBackupCloudPure({ lastOkDay, oggi: oggiRoma(), suonatoIl });
  if (!d.due) return false;

  const quando =
    d.giorni == null
      ? "mai riuscito: nessun backup automatico registrato in backup_history"
      : `ultimo riuscito ${d.giorni} giorni fa (${lastOkDay}) — soglia ${ALARM_DOPO_GIORNI} giorni`;
  const consegnato = await notifyAdmin(
    "🚨 Backup automatico nel cloud: tace da troppo",
    [
      `Il backup giornaliero del DB NON riesce: ${quando}.`,
      "Il database resta senza copia nel cloud: il Mac spento non è più una rete di sicurezza.",
      "Da guardare: audit (cerca cron.backup-cloud-errore) e credenziali storage del branch.",
    ].join("\n"),
  ).catch(() => false);
  if (!consegnato) return false;

  // Dedup SOLO dopo la consegna: se Telegram ed email non rispondono, il
  // prossimo tick (15 minuti dopo) riprova a suonare.
  await pool
    .query(
      `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
       on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
      [CLOUD_BACKUP_ALARM_KEY, JSON.stringify(d.oggi)],
    )
    .catch(() => {});
  await logAudit(actor, "cron.backup-cloud-allarme", d.oggi, d.giorni == null ? "mai riuscito" : `${d.giorni} giorni dall'ultimo backup riuscito`);
  return true;
}
