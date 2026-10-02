/**
 * MODALITÀ MANUTENZIONE — logica condivisa (proxy, pagina e admin).
 *
 * Il cancello vive nel proxy (convenzione Next 16): quando la config è
 * attiva, ogni percorso pubblico riceve una pagina HTML di manutenzione
 * con risposta 503 (il crawler capisce «torna presto», non deindicizza).
 * L'admin e le API non passano dal matcher del proxy: il team continua
 * a lavorare mentre il pubblico vede la pagina pulita.
 *
 * Questo modulo è PURO (niente `pg`, niente I/O): lo importa anche il
 * proxy, che per convenzione non può toccare il database. La lettura DB
 * vive in maintenance-store.ts, la scrittura nell'action admin.
 */

export const MAINTENANCE_KEY = "maintenance_mode";

/* ── Dedup del promemoria backup (30/09) ────────────────────────── */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Chiave content_settings dello stato dedup (l'ultima età suonata, in giorni interi). */
export const BACKUP_REMINDER_STATE_KEY = "backup_reminder_state";

export interface BackupReminderDecision {
  /** L'avviso va suonato A QUESTO tick? */
  due: boolean;
  /** Età dell'ultimo backup in giorni INTERI (999_999 se mai fatto). */
  etàGiorni: number;
}

/**
 * La decisione del promemoria, PURA e testata: suona quando l'ultimo
 * backup è più vecchio della soglia E il dedup non ha già coperto QUESTA
 * finestra di età. L'età è in giorni interi (un tick ogni 15 minuti
 * ripeterebbe lo stesso numero 96 volte al giorno — è successo davvero su
 * produzione: un audit «oltre 7 giorni» a ogni tick dal 28/09). La riarma
 * è naturale: l'età cresce di 1 al giorno, quindi a età = ultima suonata
 * + 1 il promemoria torna; un NUOVO backup riporta l'età sotto soglia e
 * azzera tutto senza job di reset.
 */
export function backupReminderDecidiPure(input: {
  days: number;
  lastAtMs: number | null;
  nowMs: number;
  giàSuonatoA: number | null;
}): BackupReminderDecision {
  const { days, lastAtMs, nowMs, giàSuonatoA } = input;
  if (!Number.isFinite(days) || days <= 0) return { due: false, etàGiorni: 0 };
  // Mai fatto un backup: suona UNA volta (dedup a 999_999), poi zitta
  // finché qualcuno non fa il primo — non un lamento ogni 15 minuti.
  if (lastAtMs == null) {
    return { due: giàSuonatoA == null, etàGiorni: 999_999 };
  }
  const ageMs = nowMs - lastAtMs;
  const etàGiorni = Math.floor(Math.max(0, ageMs) / DAY_MS);
  if (ageMs <= days * DAY_MS) return { due: false, etàGiorni };
  if (giàSuonatoA != null && Number.isFinite(giàSuonatoA) && etàGiorni <= giàSuonatoA) {
    return { due: false, etàGiorni };
  }
  return { due: true, etàGiorni };
}

export interface MaintenanceConfig {
  /** Il cancello è attivo? Default: no (il sito normale). */
  active: boolean;
  /** Messaggio libero dell'agenzia (trim, max 280 caratteri). */
  message: string;
  /** Promessa leggibile «torna online» (trim, max 60 caratteri, opzionale). */
  backOnline: string;
}

export const DEFAULT_MAINTENANCE: MaintenanceConfig = {
  active: false,
  message: "",
  backOnline: "",
};

/** Testi canonici condivisi da pagina React e HTML del proxy: un solo
 *  posto da cui cambia il wording (stessa disciplina di site.ts). */
export const MAINTENANCE_TITLE = "Ci stiamo prendendo cura del sito";
export const MAINTENANCE_DEFAULT_SUB =
  "Siamo al lavoro per tornare più bravi di prima. Nel frattempo i contatti restano aperti: scrivici e ti rispondiamo in giornata.";

const MESSAGE_MAX = 280;
const BACK_ONLINE_MAX = 60;

/** Se un campo manca o è di tipo sbagliato ricade sul default: la config
 *  corrotta non può né bloccare il sito né mandare in tilt il proxy. */
export function sanitizeMaintenanceConfig(raw: unknown): MaintenanceConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    active: o.active === true,
    message: typeof o.message === "string" ? o.message.trim().slice(0, MESSAGE_MAX) : DEFAULT_MAINTENANCE.message,
    backOnline:
      typeof o.backOnline === "string" ? o.backOnline.trim().slice(0, BACK_ONLINE_MAX) : DEFAULT_MAINTENANCE.backOnline,
  };
}
