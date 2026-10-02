/**
 * Costanti del RESTORE condivise client + server (zero dipendenze: il
 * pannello client le importa senza trascinare pg nel bundle — pattern
 * email-tools-shared/notion-config-shared).
 *
 * Il grafo FK è quello REALE del database (information_schema), non quello
 * dedotto dai file di migration: due circularità esistono davvero
 * (leads.callback_id → callbacks.id e callbacks.lead_id → leads.id;
 * leads.conversation_id → conversations.id). Il restore li gestisce con
 * i constraint resi DEFERRABLE a runtime (BEGIN DEFERRED) e l'ordine
 * topologico elimina tutti gli altri conflitti.
 */

/** Ordine topologico dei parents: tabelle senza FK su altre di questo elenco prima. */
export const RESTORE_ORDER = [
  "operators",
  "packages",
  "ai_faqs",
  "ai_settings",
  "ai_provider_keys",
  "notion_settings",
  "content_settings",
  "whatsapp_config",
  "leads",
  "conversations",
  "messages",
  "callbacks",
  "ticket_notes",
  "ai_faq_usage",
  "notion_sync_queue",
  "email_ingest",
  "clients",
  "client_conversations",
  "audit_log",
  "shield_events",
  "shield_bans",
] as const;

export interface CloudBackupInfo {
  /** Chiave dell'oggetto nel bucket (auto/db-YYYY-MM-DD-HHMMSS.json.gz). */
  key: string;
  /** Giornata Roma del deposito (YYYY-MM-DD, dal nome del file). */
  day: string;
  /** Ora del deposito (HHMMSS, dal nome del file). */
  time: string;
  /** Dimensione del file gzip depositato, in byte. */
  bytes: number;
  /** sha256 del gzip (metadata dell'oggetto, calcolato al deposito). */
  sha256: string;
  /** Ultimo aggiornamento dell'oggetto nel bucket. */
  lastModified: string;
}

/**
 * admin_users è FUORI dal ciclo backup/restore, non un'esclusione da UI:
 * non deve esistere nemmeno come opzione selezionabile.
 *
 * Perché: il backup conterrebbe l'hash della password e l'anagrafica privata
 * (codice fiscale, P.IVA, indirizzo) del super admin scaricabile da qualunque
 * admin; e il restore permetterebbe a un admin di auto-promuoversi
 * (role: 'super_admin') o di disattivare/cancellare il super admin. Gli
 * account si gestiscono SOLO da /admin/utenti (guardia requireSuperAdmin) e
 * dal wizard d'installazione: sono le uniche superfici di scrittura legittime.
 */
export const RESTORE_EXCLUDED: Record<string, string> = {
  audit_log: "append-only: la storia non si riscrive",
  backup_history: "append-only: la storia non si riscrive",
};

/** Tabella mai esportata nei backup e mai ripristinabile (nessuna UI, nessuna
 * opzione): controllata a monte nel ciclo (BACKUP_TABLES) e rifiutata nel
 * restore anche se un file forgiato la contiene. */
export const BACKUP_NEVER: readonly string[] = ["admin_users"];

/** Tabelle ripristinabili = ordine meno escluse (per il piano e la UI). */
export const RESTORABLE: readonly string[] = RESTORE_ORDER.filter((t) => !RESTORE_EXCLUDED[t]);

/** Dipendenze tra tabelle ripristinabili: se ripristini A ma non B, e A ha
 * righe che puntano a B, il restore fallirebbe per FK → l'azione obbliga a
 * includere la dipendenza (messaggio chiaro, nessuna scrittura).
 * Dedotte dal grafo information_schema, filtro sulle sole RESTORABLE.
 */
export interface RestoreSourceInfo {
  day?: string;
  time?: string;
  bytes?: number;
  sha256?: string;
}

/**
 * Descrizione della FONTE del restore: per il backup dal CLOUD aggiunge
 * dimensione e sha256 (rilevanti quando si ripristina il file depositato
 * nel bucket Neon, non un JSON caricato a mano). null per l'upload manuale.
 */
export function describeRestoreSource(source?: RestoreSourceInfo | null): string | null {
  if (!source) return null;
  const parts: string[] = [];
  if (typeof source.bytes === "number" && source.bytes > 0) parts.push(humanBytesStr(source.bytes) + " gzip");
  if (typeof source.sha256 === "string" && source.sha256.length >= 12) parts.push(`sha256 ${source.sha256.slice(0, 12)}…`);
  return parts.length ? parts.join(" · ") : null;
}

function humanBytesStr(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 100 || u === 0 ? 0 : 1).replace(".", ",")} ${units[u]}`;
}

export const RESTORE_DEPS: Record<string, string[]> = {
  operators: [],
  packages: [],
  ai_faqs: [],
  ai_settings: [],
  ai_provider_keys: [],
  notion_settings: [],
  content_settings: [],
  whatsapp_config: [],
  leads: ["operators"],
  conversations: ["operators"],
  messages: ["conversations"],
  callbacks: ["operators", "leads", "conversations"],
  ticket_notes: ["conversations"],
  ai_faq_usage: ["ai_faqs", "conversations"],
  notion_sync_queue: [],
  email_ingest: [],
  clients: [],
  client_conversations: ["clients", "conversations"],
  shield_events: [],
  shield_bans: [],
};

/**
 * FK con ON DELETE CASCADE (neon/schema.sql e migrations): ripristinare la
 * parent SVUOTA i figli non selezionati (delete → cascade → table vuota),
 * anche se il restore li riguarderebbe «solo indirettamente». Trovato nel
 * test e2e: ripristinare conversations senza messages cancellava i 70
 * messaggi esistenti e NON li ricreava — l'utente perde dati senza saperlo.
 * La UI avvisa che la selezione cancella anche queste tabelle figlie; il
 * server rifiuta la selezione se un figlio cascade non è incluso.
 */
export const RESTORE_CASCADES: Record<string, string[]> = {
  conversations: ["messages", "ticket_notes"],
};

/**
 * Il file di backup può contenere tabelle arbitrariamente forgiate: nel
 * restore conta solo la whitelist. Una tabella nella lista BACKUP_NEVER non
 * viene MAI toccata, qualunque cosa dichiari il file o il form.
 */
export function isBackupNever(table: string): boolean {
  return (BACKUP_NEVER as readonly string[]).includes(table);
}

/** Figli cascade di una selezione, non selezionati: perdita silenziosa. */
export function missingCascadeChildren(selected: Iterable<string>): string[] {
  const wanted = new Set(selected);
  const missing: string[] = [];
  for (const parent of wanted) {
    for (const child of RESTORE_CASCADES[parent] ?? []) {
      if (!wanted.has(child)) missing.push(`${parent} cancella anche ${child} (cascade)`);
    }
  }
  return missing;
}
