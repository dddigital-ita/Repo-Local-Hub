/**
 * Costanti e tipi PURI della config Notion — importabili anche dai
 * componenti client (nessun `db`, nessun nodo: pg non entra nel bundle).
 * La versione server (getSyncConfig/saveSyncConfig/buildNotionPayload)
 * sta in `notion-config.ts`.
 */

export type NotionPropType =
  | "title"
  | "rich_text"
  | "select"
  | "multi_select"
  | "number"
  | "url"
  | "date"
  | "checkbox"
  | "email"
  | "phone_number";

export interface MappingField {
  /** Colonna DB (snake_case) da sincronizzare. */
  from: string;
  /** Nome esatto della proprietà sul database Notion. */
  to: string;
  /** Tipo della proprietà Notion (determina la struttura del payload). */
  type: NotionPropType;
  /** Trasformazione opzionale (whitelist: vedi applyTransform in notion-config). */
  transform?: "mappa_sorgente" | "solo_http" | "iso8601";
  /** Troncamento per rich_text (limite reale Notion: 2000). */
  maxLen?: number;
}

export interface EntityConfig {
  enabled: boolean;
  trigger: string[];
  priority: string;
}

export interface SyncSubConfig {
  batchMax: number;
  onCreate: boolean;
  onUpdate: boolean;
  retryAttempts: number;
  retryBaseMs: number;
}

export interface NotionSyncConfig {
  entities: { leads: EntityConfig; tickets: EntityConfig; callbacks: EntityConfig };
  leadMapping: MappingField[];
  titleTemplate: string;
  titleFallback: string;
  /** etichetta proprietà select → mappa valore DB → etichetta Notion ("*" = default). */
  selectMapping: Record<string, Record<string, string>>;
  sync: SyncSubConfig;
}

/** Colonne di `leads` sincronizzabili dall'editor (documentazione viva). */
export const SYNCABLE_LEAD_FIELDS: { from: string; label: string }[] = [
  { from: "name", label: "Nome" },
  { from: "phone", label: "Telefono" },
  { from: "company", label: "Azienda" },
  { from: "company_name", label: "Nome ditta" },
  { from: "service", label: "Servizio" },
  { from: "urgency", label: "Urgenza" },
  { from: "existing_site", label: "Sito esistente" },
  { from: "budget", label: "Budget" },
  { from: "hot", label: "Lead caldo" },
  { from: "consent", label: "Consenso" },
  { from: "status", label: "Stato" },
  { from: "temperature", label: "Temperatura" },
  { from: "ricontatta_il", label: "Ricontattare il" },
  { from: "source", label: "Sorgente" },
  { from: "initial_query", label: "Ricerca iniziale" },
  { from: "source_page", label: "Pagina origine" },
  { from: "callback_slot", label: "Slot callback" },
  { from: "notes", label: "Note" },
  { from: "created_at", label: "Creato" },
];
