import { db } from "./db";
import { backupReminderDecidiPure, DAY_MS, BACKUP_REMINDER_STATE_KEY } from "./maintenance-shared";
import { RESTORE_ORDER, RESTORABLE, RESTORE_DEPS, isBackupNever, missingCascadeChildren } from "./restore-shared";

/**
 * Strumento BACKUP E AGGIORNAMENTI VERSIONE (/admin/tools).
 *
 * Backup: export JSON completo del database (schema + dati) generato
 * lato server — niente credenziali o tabelle di sistema nel file. I file
 * NON contengono NEANCHE admin_users: hash delle password e anagrafica
 * privata degli account (incluso il super admin) non lasciano mai il server
 * (vedi BACKUP_NEVER in restore-shared.ts). Lo
 * storage è il file scaricato: la repository di verità resta Neon
 * (backup gestiti da Neon.tech), qui c'è la storia e il gesto operativo.
 *
 * Aggiornamenti versione: la versione corrente è quella del package.json
 * letta al runtime (onesta, sempre allineata al codice deployato); il
 * confronto con npm registry dice solo se esiste una versione più recente
 * — il codice si aggiorna da Git/Vercel, NON da qui (per design).
 *
 * Promemoria: il cron (blocco 7) avvisa quando l'ultimo backup ha più di
 * N giorni (default 7, chiave backup_reminder_days).
 */

export const BACKUP_REMINDER_KEY = "backup_reminder_days";
// BACKUP_REMINDER_STATE_KEY (stato dedup) vive in maintenance-shared:
// la chiave è parte della regola, e la regola è testata lì.
export const DEFAULT_BACKUP_REMINDER_DAYS = 7;

/** Dimensione leggibile («1,2 MB») per lo storico e i messaggi. */
export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 100 || u === 0 ? 0 : 1).replace(".", ",")} ${units[u]}`;
}

/**
 * Entità di business incluste nell'export: la lista condivisa con il
 * restore (restore-shared.ts) è in ordine topologico parents→children,
 * che è anche l'ordine di ripristino. Escluso BACKUP_NEVER (admin_users):
 * hash delle password e anagrafica privata non finiscono mai nei file.
 */
const BACKUP_TABLES = RESTORE_ORDER.filter((t) => !isBackupNever(t));

interface TableStatus {
  table: string;
  exists: boolean;
  rows: number;
}

/** Quali tabelle esistono davvero (deploy progressivi, DB vecchi). */
export async function backupTableStatus(): Promise<TableStatus[]> {
  const pool = db();
  if (!pool) return [];
  const out: TableStatus[] = [];
  for (const table of BACKUP_TABLES) {
    try {
      const { rows } = await pool.query<{ n: string }>(`select count(*)::text as n from ${table}`);
      out.push({ table, exists: true, rows: Number(rows[0]?.n ?? 0) });
    } catch {
      out.push({ table, exists: false, rows: 0 });
    }
  }
  return out;
}

/** Versione corrente dal package.json letto a runtime (sempre quella deployata). */
export function currentVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("../../package.json") as { version?: string };
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Versione di Next.js effettivamente installata (o "" se non rilevabile). */
export function installedNextVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("next/package.json") as { version?: string };
    return pkg.version || "";
  } catch {
    return "";
  }
}

/**
 * Ultima versione pubblicata su npm per un pacchetto (oggi: solo «next»,
 * la dipendenza che guida il resto dello stack). Con timeout corto: il
 * check non deve mai impallare la pagina. L'app è privata: il confronto
 * utile è sulle dipendenze, non su se stessa.
 */
export async function checkLatestVersion(pkgName: "next"): Promise<{ ok: boolean; latest: string | null }> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkgName}/latest`, {
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { ok: false, latest: null };
    const data = (await res.json()) as { version?: string };
    return { ok: Boolean(data.version), latest: data.version ?? null };
  } catch {
    return { ok: false, latest: null };
  }
}

/** Elenco storico backup (soft-deleted esclusi). */
export interface BackupEntry {
  id: string;
  createdAt: Date;
  createdBy: string;
  sizeBytes: number;
  counts: Record<string, number>;
}

export async function listBackups(limit = 8): Promise<BackupEntry[]> {
  const pool = db();
  if (!pool) return [];
  try {
    const { rows } = await pool.query<{
      id: string;
      created_at: Date;
      created_by: string;
      size_bytes: number;
      counts: Record<string, number> | null;
    }>(
      `select id, created_at, created_by, size_bytes, counts
       from backup_history where deleted_at is null
       order by created_at desc limit $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      createdBy: r.created_by,
      sizeBytes: Number(r.size_bytes ?? 0),
      counts: r.counts ?? {},
    }));
  } catch {
    return []; // migration 024 non ancora eseguita: pannello vuoto, non 500
  }
}

export async function recordBackup(input: {
  createdBy: string;
  sizeBytes: number;
  counts: Record<string, number>;
}): Promise<string | null> {
  const pool = db();
  if (!pool) return null;
  try {
    const { rows } = await pool.query<{ id: string }>(
      `insert into backup_history (created_by, size_bytes, counts) values ($1, $2, $3::jsonb) returning id`,
      [input.createdBy, Math.min(input.sizeBytes, 2_000_000_000), JSON.stringify(input.counts)],
    );
    return rows[0]?.id ?? null;
  } catch {
    return null; // l'export non fallisce perché la storia non si scrive
  }
}

/** Soft-delete: la storia resta, la riga sparisce dall'elenco. */
export async function softDeleteBackup(id: string): Promise<boolean> {
  const pool = db();
  if (!pool) return false;
  try {
    const { rowCount } = await pool.query(
      `update backup_history set deleted_at = now() where id = $1 and deleted_at is null`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Giorni di promemoria configurati (default 7; 0 = promemoria OFF). */
export async function getBackupReminderDays(): Promise<number> {
  const pool = db();
  if (!pool) return DEFAULT_BACKUP_REMINDER_DAYS;
  try {
    const { rows } = await pool.query<{ value: unknown }>(
      "select value from content_settings where key = $1",
      [BACKUP_REMINDER_KEY],
    );
    const n = Number(rows[0]?.value);
    return Number.isFinite(n) && n >= 0 && n <= 180 ? Math.round(n) : DEFAULT_BACKUP_REMINDER_DAYS;
  } catch {
    return DEFAULT_BACKUP_REMINDER_DAYS;
  }
}

export async function setBackupReminderDays(days: number): Promise<void> {
  const pool = db();
  if (!pool) throw new Error("database non configurato");
  const value = Math.max(0, Math.min(180, Math.round(days)));
  await pool.query(
    `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [BACKUP_REMINDER_KEY, JSON.stringify(value)],
  );
}

/**
 * Il promemoria deve suonare? La regola vive in maintenance-shared
 * (backupReminderDecidiPure, testata): qui solo il recupero dati —
 * soglia, ultimo backup e stato del dedup.
 */
export async function backupReminderDue(): Promise<{ due: boolean; lastAt: Date | null; days: number }> {
  const days = await getBackupReminderDays();
  if (days <= 0) return { due: false, lastAt: null, days };
  const pool = db();
  if (!pool) return { due: false, lastAt: null, days };
  try {
    const { rows } = await pool.query<{ last_at: Date | null }>(
      "select max(created_at) as last_at from backup_history",
    );
    const lastAt = rows[0]?.last_at ?? null;
    const { rows: st } = await pool.query<{ value: unknown }>(
      "select value from content_settings where key = $1",
      [BACKUP_REMINDER_STATE_KEY],
    );
    const giàRaw = st[0]?.value;
    const giàSuonatoA = giàRaw == null ? null : Number(giàRaw);
    const d = backupReminderDecidiPure({
      days,
      lastAtMs: lastAt ? new Date(lastAt).getTime() : null,
      nowMs: Date.now(),
      giàSuonatoA,
    });
    return { due: d.due, lastAt, days };
  } catch {
    return { due: false, lastAt: null, days };
  }
}

/**
 * Registra che il promemoria È suonato (dedup): salva l'età in giorni
 * interi — o il sentinella 999_999 se non c'è mai stato un backup. La
 * riarma non serve esplicita: al primo tick con età > ultima suonata,
 * backupReminderDue torna true da sé (vedi backupReminderDecidiPure).
 */
export async function markBackupReminderSent(lastAt: Date | null): Promise<void> {
  const pool = db();
  if (!pool) return;
  const etàGiorni = lastAt ? Math.floor((Date.now() - lastAt.getTime()) / DAY_MS) : 999_999;
  await pool.query(
    `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [BACKUP_REMINDER_STATE_KEY, JSON.stringify(etàGiorni)],
  );
}

/**
 * Costruisce il payload di backup COMPLETO (schema SQL + dati JSON).
 * Niente credenziali: la connection string resta nel server. Audit e
 * shield sono inclusi come dati di business (il log è append-only:
 * perderlo = perdere la storia delle azioni).
 */
export async function buildBackupPayload(actor: string): Promise<{
  json: string;
  counts: Record<string, number>;
  sizeBytes: number;
}> {
  const pool = db();
  if (!pool) throw new Error("database non configurato");
  const status = await backupTableStatus();
  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const t of status) {
    if (!t.exists) continue;
    const { rows } = await pool.query(`select * from ${t.table}`);
    data[t.table] = rows;
    counts[t.table] = rows.length;
  }
  // Schema: NOTA BENE — query di sola lettura su information_schema, mai
  // interpolazioni da input utente (i nomi tabella sono la costante sopra).
  const schemaRes = await pool.query<{ schema_sql: string }>(
    `select coalesce(string_agg(
       format('CREATE TABLE IF NOT EXISTS %I (%s);',
         c.table_name,
         (select string_agg(column_name || ' ' || data_type, ', ') from information_schema.columns c2 where c2.table_name = c.table_name)
       ), E'\n')
     , '') as schema_sql
     from information_schema.tables c
     where c.table_schema = 'public'`,
  );
  const payload = {
    meta: {
      kind: "webagencysalento-backup",
      version: 1,
      appVersion: currentVersion(),
      createdAt: new Date().toISOString(),
      createdBy: actor,
      tables: counts,
    },
    schema: schemaRes.rows[0]?.schema_sql ?? "",
    data,
  };
  const json = JSON.stringify(payload, null, 2);
  return { json, counts, sizeBytes: Buffer.byteLength(json, "utf8") };
}

/* ══ RESTORE DA BACKUP JSON ═══════════════════════════════════════════
 * Stesso formato di buildBackupPayload. Un restore contiene i dati di un
 * momento passato: i record creati DOPO il backup (nuovi ticket, messaggi
 * del cliente) sarebbero persi o orfani di FK. Si sostituisce quindi il
 * contenuto SOLO delle tabelle scelte dall'operatore, dentro UNA
 * transazione: o tutto, o niente (rollback totale a un errore).
 *
 * Per-design (non cablate qui):
 *  - audit_log e backup_history sono APPEND-ONLY (rule SQL): saltate
 *    sempre e dichiarate nella UI — la storia non si riscrive.
 *  - le tabelle NON selezionate non vengono toccate: niente cancellazioni
 *    fuori dalla scelta esplicita dell'operatore.
 */

export interface RestorePlanItem {
  table: string;
  backupRows: number;
  liveRows: number;
  /** true = il restore la toccherà (se selezionata). */
  restore: boolean;
  reason: string;
}

/** Risultato del restore: righe scritte per tabella + sequence riallineate. */
export interface RestoreResult {
  restored: Record<string, number>;
  skipped: { table: string; reason: string }[];
  sequences: string[];
}

interface BackupFile {
  meta?: { kind?: unknown; version?: unknown; createdAt?: unknown; createdBy?: unknown; appVersion?: unknown };
  data?: unknown;
}

/**
 * Piano del restore: cosa c'è nel file, cosa c'è ora, cosa verrà toccato.
 * Non esegue nulla: alimenta la conferma esplicita della UI.
 */
export async function planRestore(json: string): Promise<
  | {
      ok: true;
      plan: RestorePlanItem[];
      meta: { createdAt: string | null; createdBy: string | null; appVersion: string | null; fileTables: number };
    }
  | { ok: false; error: string }
> {
  let file: BackupFile;
  try {
    file = JSON.parse(json) as BackupFile;
  } catch {
    return { ok: false, error: "Il file non è JSON valido." };
  }
  if (!file || typeof file !== "object" || !file.meta || typeof file.meta !== "object" || typeof file.data !== "object" || file.data === null) {
    return { ok: false, error: "Il file non è un backup di questa applicazione (mancano le sezioni meta/data)." };
  }
  if (file.meta.kind !== "webagencysalento-backup") {
    return { ok: false, error: "Il file non è un backup di questa applicazione (kind non riconosciuto)." };
  }
  const data = file.data as Record<string, unknown[]>;
  const fileTables = Object.keys(data).filter((t) => /^[a-z_]+$/.test(t) && Array.isArray(data[t]));
  const pool = db();
  if (!pool) return { ok: false, error: "Database non configurato." };
  const plan: RestorePlanItem[] = [];
  for (const table of RESTORABLE) {
    if (!fileTables.includes(table)) continue; // nata dopo il backup: non è nel file
    const rows = data[table] as unknown[];
    try {
      const { rows: live } = await pool.query<{ n: string }>(`select count(*)::text as n from ${table}`);
      plan.push({ table, backupRows: rows.length, liveRows: Number(live[0]?.n ?? 0), restore: true, reason: "" });
    } catch {
      plan.push({
        table,
        backupRows: rows.length,
        liveRows: 0,
        restore: false,
        reason: "tabella assente nel database (migration non eseguita)",
      });
    }
  }
  return {
    ok: true,
    plan,
    meta: {
      createdAt: typeof file.meta.createdAt === "string" ? file.meta.createdAt : null,
      createdBy: typeof file.meta.createdBy === "string" ? file.meta.createdBy : null,
      appVersion: typeof file.meta.appVersion === "string" ? file.meta.appVersion : null,
      fileTables: fileTables.length,
    },
  };
}

/**
 * Tabelle con FK da rendere DEFERRABLE durante il restore: il grafo reale
 * (information_schema) contiene circularità (leads ↔ callbacks) e dipendenze
 * che un ordine di insert non risolve. Con i constraint deferrable e
 * «set constraints all deferred» il controllo scatta al COMMIT: delete e
 * insert sono liberi, la coerenza finale resta garantita dal DB.
 * DDL transazionale: a rollback i constraint tornano come prima da soli.
 */
const FK_TABLES = [
  "admin_users",
  "leads",
  "conversations",
  "messages",
  "callbacks",
  "ticket_notes",
  "ai_faq_usage",
] as const;

const DEFER_FK_SQL = `do $restore_fx$
declare r record;
begin
  for r in
    select c.conname,
           c.conrelid::regclass::text as tbl,
           pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    where c.contype = 'f'
      and c.conrelid = any(array[${FK_TABLES.map((t) => `'${t}'`).join(",")}]::regclass[])
  loop
    execute format('alter table %I drop constraint %I', r.tbl, r.conname);
    execute format('alter table %I add constraint %I %s deferrable initially immediate', r.tbl, r.conname, r.def);
  end loop;
end
$restore_fx$`;

const RESTORE_FK_SQL = `do $restore_fx$
declare r record;
begin
  for r in
    select c.conname,
           c.conrelid::regclass::text as tbl,
           regexp_replace(pg_get_constraintdef(c.oid), '\\s*deferrable.*$', '', 'i') as def
    from pg_constraint c
    where c.contype = 'f' and c.condeferrable
      and c.conrelid = any(array[${FK_TABLES.map((t) => `'${t}'`).join(",")}]::regclass[])
  loop
    execute format('alter table %I drop constraint %I', r.tbl, r.conname);
    execute format('alter table %I add constraint %I %s', r.tbl, r.conname, r.def);
  end loop;
end
$restore_fx$`;

/**
 * Esegue il restore delle tabelle selezionate, in ordine topologico
 * (RESTORE_ORDER), dentro una transazione con FK deferrate al COMMIT:
 * le circularità del grafo reale (leads ↔ callbacks) passano. Le righe
 * del file sostituiscono il contenuto attuale (delete + insert).
 * Le colonne sono ripulite coi nomi REALI del DB live: il file può venire
 * da una versione con schema diverso, le colonne sconosciute si scartano.
 */
export async function executeRestore(json: string, selected: string[]): Promise<RestoreResult> {
  const plan = await planRestore(json);
  if (!plan.ok) throw new Error(plan.error);
  const pool = db();
  if (!pool) throw new Error("database non configurato");
  const wanted = new Set(
    selected.filter((t) => (RESTORABLE as readonly string[]).includes(t) && !isBackupNever(t)),
  );
  // Dipendenze: ripristinare messages senza conversations violerebbe FK.
  // Validato PRIMA di toccare il database, con messaggio umano.
  const missing: string[] = [];
  for (const t of wanted) {
    for (const dep of RESTORE_DEPS[t] ?? []) {
      if (!wanted.has(dep)) missing.push(`${t} richiede anche ${dep}`);
    }
  }
  if (missing.length) {
    throw new Error(`Selezione incompleta — dipendenze mancanti: ${missing.join(" · ")}. Includi anche le tabelle indicate, poi riprova.`);
  }
  // Cascade: ripristinare una parent svuota i figli ON DELETE CASCADE non
  // selezionati (verificato e2e: conversations senza messages perdeva la chat).
  // Rifiuto la selezione prima di toccare il database.
  const cascades = missingCascadeChildren(wanted);
  if (cascades.length) {
    throw new Error(`Perdita di dati — ${cascades.join(" · ")}: includi anche le tabelle figlie nella selezione, poi riprova.`);
  }
  const data = (JSON.parse(json) as BackupFile).data as Record<string, Record<string, unknown>[]>;
  const result: RestoreResult = { restored: {}, skipped: [], sequences: [] };

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(DEFER_FK_SQL);
    await client.query("set constraints all deferred");
    for (const table of RESTORABLE) {
      if (!wanted.has(table)) continue;
      // Backstop anti-forgery: admin_users non esiste nemmeno nella whitelist,
      // ma il filtro esplicito qui rende l'invariante leggibile e impenetrabile
      // anche a future refactor della lista.
      if (isBackupNever(table)) continue;
      const item = plan.plan.find((p) => p.table === table);
      if (!item || !item.restore) {
        result.skipped.push({ table, reason: item?.reason ?? "tabella assente nel database" });
        continue;
      }
      // Colonne reali del DB live: il file non decide mai i nomi (identificatori
      // quotati solo da questa lista, valori SEMPRE via placeholder).
      const { rows: liveCols } = await client.query<{ column_name: string; data_type: string }>(
        "select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = $1",
        [table],
      );
      const cols = new Map(liveCols.map((c) => [c.column_name, c.data_type]));
      const rows = data[table] ?? [];
      await client.query(`delete from ${table}`);
      let written = 0;
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const keys = Object.keys(row).filter((k) => cols.has(k) && row[k] !== undefined);
        if (!keys.length) continue;
        // jsonb: il parametro è SEMPRE la stringa JSON con cast esplicito.
        // pg serializza gli array JS come letterale Postgres {a,b} (giusto
        // per text[], sbagliato per jsonb → «invalid input syntax for type
        // json»); gli oggetti li serializza JSON ma solo per convenzione.
        const jsonbCols = new Set<number>();
        const values = keys.map((k, i) => {
          if (cols.get(k) === "jsonb") {
            jsonbCols.add(i);
            return JSON.stringify(row[k]);
          }
          return row[k];
        });
        await client.query(
          `insert into ${table} (${keys.map((k) => `"${k}"`).join(", ")}) values (${keys
            .map((_, i) => (jsonbCols.has(i) ? `$${i + 1}::jsonb` : `$${i + 1}`))
            .join(", ")})`,
          values,
        );
        written++;
      }
      result.restored[table] = written;
    }
    // Sequence serial: il numero del prossimo ticket riparte dal max ripristinato
    // (senza setval il primo insert dopo il restore va in conflitto sull'unique).
    if (result.restored.conversations !== undefined) {
      const { rows: seq } = await client.query<{ maxnum: number | null }>("select max(number) as maxnum from conversations");
      const maxNum = Math.max(1, seq[0]?.maxnum ?? 1);
      await client.query("select setval('conversations_number_seq', $1, true)", [maxNum]);
      result.sequences.push(`conversations_number_seq → ${maxNum}`);
    }
    // Flush dei controlli FK differiti PRIMA del DDL: con pending trigger
    // events in coda, l'ALTER TABLE di ripristino fallirebbe («cannot ALTER
    // TABLE ... because it has pending trigger events»). Qui una violazione
    // emerge comunque dentro la transazione → rollback; la coda si svuota e
    // l'ALTER passa.
    await client.query("set constraints all immediate");
    await client.query(RESTORE_FK_SQL); // constraint torna NON deferrable come prima
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {}); // DDL compreso: constraint intatti
    throw e instanceof Error ? e : new Error("errore restore");
  } finally {
    client.release();
  }
  return result;
}
