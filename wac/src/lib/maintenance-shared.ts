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
