/**
 * BACKUP CLOUD — regole PURHE condivise (zero dipendenze: niente pg, niente
 * S3, niente next). Il piano dell'allarme vive qui, testato dalla suite
 * node; l'esecuzione (DB, S3, Telegram) vive in backup-cloud.ts e nel tick.
 *
 * Stessa disciplina di maintenance-shared (backupReminderDecidiPure): un
 * tick ogni 15 minuti NON deve trasformarsi in un lamento ripetuto, e la
 * rete di sicurezza DEVE ritentare finché non riesce a parlare.
 */

/** Chiave content_settings della dedup dell'allarme (giorno Roma dell'ultima suonata). */
export const CLOUD_BACKUP_ALARM_KEY = "backup_cloud_alarm_last_day";

/** Giorni di fila SENZA backup cloud riuscito prima di suonare. */
export const ALARM_DOPO_GIORNI = 2;

/** La data di OGGI a Roma (YYYY-MM-DD): la giornata del backup è quella di Roma. */
export function oggiRoma(nowMs: number = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(nowMs),
  );
}

/** Differenza in GIORNI di calendario tra due date Roma (YYYY-MM-DD): conta le notti, immune da fusi e ora legale. */
export function giorniTra(fromDay: string, toDay: string): number {
  const [fy, fm, fd] = fromDay.split("-").map(Number);
  const [ty, tm, td] = toDay.split("-").map(Number);
  const fromUtc = Date.UTC(fy, (fm ?? 1) - 1, fd ?? 1);
  const toUtc = Date.UTC(ty, (tm ?? 1) - 1, td ?? 1);
  return Math.round((toUtc - fromUtc) / (24 * 60 * 60 * 1000));
}

export interface CloudBackupAlarmDecision {
  /** L'allarme va suonato A QUESTO tick? */
  due: boolean;
  /** Giorni di calendario Roma dall'ultimo backup riuscito (null: MAI riuscito). */
  giorni: number | null;
  /** La giornata di Roma di questo tick (per audit e messaggi). */
  oggi: string;
}

/**
 * La decisione dell'allarme, PURA e testata. Suona quando:
 *  - il backup cloud non riesce da ALMENO ALARM_DOPO_GIORNI giorni di fila
 *    (contati dal giorno Roma dell'ultimo successo in backup_history), O
 *  - non è MAI riuscito (giorni = null: il sistema promette un backup al
 *    giorno, il silenzio totale è lui stesso un guasto — anche il caso
 *    «env storage mai configurate» merita di essere nominato);
 * E l'allarme non è già stato suonato OGGI (dedup su content_settings:
 * al massimo un messaggio al giorno, non uno ogni 15 minuti).
 */
export function allarmeBackupCloudPure(input: {
  /** Giorno Roma (YYYY-MM-DD) dell'ultimo backup cloud riuscito; null se mai. */
  lastOkDay: string | null;
  /** La giornata di Roma di questo tick. */
  oggi: string;
  /** Giorno Roma dell'ultima suonata (dedup); null se mai suonato. */
  suonatoIl: string | null;
}): CloudBackupAlarmDecision {
  const { lastOkDay, oggi, suonatoIl } = input;
  const giorni = lastOkDay == null ? null : Math.max(0, giorniTra(lastOkDay, oggi));
  const duePerGiorni = giorni == null || giorni >= ALARM_DOPO_GIORNI;
  const giàSuonatoOggi = suonatoIl === oggi;
  return { due: duePerGiorni && !giàSuonatoOggi, giorni, oggi };
}

/* ── Chiavi dei backup nel bucket ─────────────────────────────────── */

/** Prefisso delle chiavi dei backup automatici (stesso di backup-cloud.ts). */
export const CLOUD_BACKUP_PREFIX = "auto/db-";

export interface CloudKeyInfo {
  /** Giornata Roma del backup (YYYY-MM-DD, dal nome del file). */
  day: string;
  /** Ora del deposito (HHMMSS, dal nome del file). */
  time: string;
}

/**
 * Analisi PURA della chiave di un backup automatico
 * (auto/db-YYYY-MM-DD-HHMMSS.json.gz): null se la chiave non è della forma
 * attesa — la UI non mostra né propone il ripristino dell'imprevisto.
 */
export function parseCloudKey(key: string): CloudKeyInfo | null {
  const m = key.match(/^auto\/db-(\d{4})-(\d{2})-(\d{2})-(\d{6})\.json\.gz$/);
  if (!m) return null;
  // Forma plausibile, non solo conta-cifre: una data impossibile (mese 13)
  // non è un backup depositato da runCloudBackup (oggiRoma) e non deve
  // entrare né nell'elenco né nell'etichetta della UI.
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { day: `${y}-${mo}-${d}`, time: m[4] };
}

/** Etichetta umana di una chiave cloud valida: «1 ottobre 2026, 22:31» (Roma). */
export function describeCloudKey(key: string): string | null {
  const info = parseCloudKey(key);
  if (!info) return null;
  const [y, mo, d] = info.day.split("-").map(Number);
  const label = new Date(Date.UTC(y, (mo ?? 1) - 1, d ?? 1)).toLocaleDateString("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${label}, ${info.time.slice(0, 2)}:${info.time.slice(2, 4)}`;
}
