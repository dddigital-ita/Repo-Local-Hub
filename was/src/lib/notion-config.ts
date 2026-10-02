import { db } from "./db";
import type {
  EntityConfig,
  MappingField,
  NotionPropType,
  NotionSyncConfig,
} from "./notion-config-shared";

export type {
  EntityConfig,
  MappingField,
  NotionPropType,
  NotionSyncConfig,
  SyncSubConfig,
} from "./notion-config-shared";

/**
 * Motore di mapping configurabile per la sincronizzazione Notion
 * (PROMPT-NOTION-CONFIGURABILE.md).
 *
 * La config è l'unica source of truth: niente mapping, template o
 * etichette cablate nel codice runtime. I valori di default qui sotto
 * riproducono ESATTAMENTE il comportamento precedente di
 * `pushLeadToNotion` (stesso mapping, stesso titolo, stesso batch):
 * chi non tocca la config non vede alcuna differenza.
 *
 * Regole del prompt rispettate qui:
 * - la chiave API NON passa da qui (resta in notion.ts, cifrata);
 * - nessuna chiamata di rete in questo modulo: costruisce payload e
 *   valuta config — tutto testabile senza credenziali (dry-run);
 * - i transform dichiarati sono l'unica logica ammessa oltre al
 *   passaggio del valore.
 */

/* ── Validazione + normalizzazione (ogni input da admin passa qui) ── */

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function isSafePropName(name: unknown): name is string {
  return typeof name === "string" && name.trim().length > 0 && name.length <= 80;
}

const VALID_TYPES: NotionPropType[] = [
  "title",
  "rich_text",
  "select",
  "multi_select",
  "number",
  "url",
  "date",
  "checkbox",
  "email",
  "phone_number",
];

const VALID_TRANSFORMS = ["mappa_sorgente", "solo_http", "iso8601"] as const;

/* ── Default = comportamento odierno, byte-identico ─────────────── */

export const DEFAULT_SYNC_CONFIG: NotionSyncConfig = {
  entities: {
    leads: { enabled: true, trigger: ["manual"], priority: "alta" },
    tickets: { enabled: false, trigger: ["manual"], priority: "media" },
    callbacks: { enabled: false, trigger: ["manual"], priority: "media" },
  },
  leadMapping: [
    { from: "name", to: "Nome", type: "title" },
    { from: "phone", to: "Telefono", type: "rich_text", maxLen: 1900 },
    { from: "service", to: "Servizio", type: "select" },
    { from: "urgency", to: "Urgenza", type: "select" },
    { from: "budget", to: "Budget", type: "select" },
    { from: "status", to: "Stato", type: "select" },
    { from: "source", to: "Sorgente", type: "select", transform: "mappa_sorgente" },
    { from: "initial_query", to: "Ricerca iniziale", type: "rich_text", maxLen: 1900 },
    { from: "source_page", to: "Pagina origine", type: "url", transform: "solo_http" },
    { from: "notes", to: "Note", type: "rich_text", maxLen: 1900 },
    { from: "created_at", to: "Creato", type: "date", transform: "iso8601" },
  ],
  titleTemplate: "{{name}} · {{phone}}",
  titleFallback: "Lead {{id}}",
  selectMapping: { Sorgente: { ai: "Ambrosio AI", "*": "Script chat" } },
  sync: { batchMax: 20, onCreate: false, onUpdate: false, retryAttempts: 3, retryBaseMs: 2000 },
};

type ValidTransform = (typeof VALID_TRANSFORMS)[number];

/** Valida e normalizza una config arbitraria (da form admin o JSON). */
export function sanitizeSyncConfig(raw: unknown): NotionSyncConfig {
  const d = DEFAULT_SYNC_CONFIG;
  if (!raw || typeof raw !== "object") return structuredClone(d);
  const r = raw as Partial<NotionSyncConfig>;

  const sanitizeEntity = (e: unknown, def: EntityConfig): EntityConfig => {
    if (!e || typeof e !== "object") return structuredClone(def);
    const o = e as Partial<EntityConfig>;
    return {
      enabled: Boolean(o.enabled),
      trigger: Array.isArray(o.trigger) ? o.trigger.slice(0, 5).map(String) : [...def.trigger],
      priority: typeof o.priority === "string" ? o.priority.slice(0, 20) : def.priority,
    };
  };

  const leadMapping: MappingField[] = Array.isArray(r.leadMapping)
    ? r.leadMapping
        .filter(
          (f): f is MappingField =>
            !!f &&
            typeof f === "object" &&
            isSafePropName((f as MappingField).from) &&
            isSafePropName((f as MappingField).to) &&
            VALID_TYPES.includes((f as MappingField).type) &&
            ((f as MappingField).transform == null ||
              VALID_TRANSFORMS.includes((f as MappingField).transform as ValidTransform)),
        )
        .slice(0, 40)
        .map((f) => ({
          from: f.from,
          to: f.to,
          type: f.type,
          ...(f.transform ? { transform: f.transform } : {}),
          ...(f.maxLen ? { maxLen: clampInt(f.maxLen, 1, 2000, 1900) } : {}),
        }))
    : structuredClone(d.leadMapping);

  const selectMapping: Record<string, Record<string, string>> = {};
  if (r.selectMapping && typeof r.selectMapping === "object") {
    for (const [prop, map] of Object.entries(r.selectMapping).slice(0, 20)) {
      if (!isSafePropName(prop) || !map || typeof map !== "object") continue;
      selectMapping[prop] = {};
      for (const [k, v] of Object.entries(map).slice(0, 50)) {
        if (typeof k === "string" && typeof v === "string" && v.length <= 100) {
          selectMapping[prop][k.slice(0, 50)] = v;
        }
      }
    }
  }

  return {
    entities: {
      leads: sanitizeEntity(r.entities?.leads, d.entities.leads),
      tickets: sanitizeEntity(r.entities?.tickets, d.entities.tickets),
      callbacks: sanitizeEntity(r.entities?.callbacks, d.entities.callbacks),
    },
    leadMapping,
    titleTemplate: typeof r.titleTemplate === "string" && r.titleTemplate.length <= 200 ? r.titleTemplate : d.titleTemplate,
    titleFallback: typeof r.titleFallback === "string" && r.titleFallback.length <= 200 ? r.titleFallback : d.titleFallback,
    selectMapping,
    sync: {
      batchMax: clampInt(r.sync?.batchMax, 1, 100, d.sync.batchMax),
      onCreate: Boolean(r.sync?.onCreate),
      onUpdate: Boolean(r.sync?.onUpdate),
      retryAttempts: clampInt(r.sync?.retryAttempts, 0, 10, d.sync.retryAttempts),
      retryBaseMs: clampInt(r.sync?.retryBaseMs, 0, 60000, d.sync.retryBaseMs),
    },
  };
}

/** Legge la config salvata; se assente o corrotta, default (pattern degradato del progetto). */
export async function getSyncConfig(): Promise<NotionSyncConfig> {
  const pool = db();
  if (!pool) return structuredClone(DEFAULT_SYNC_CONFIG);
  try {
    const { rows } = await pool.query<{ sync_config: unknown }>(
      "select sync_config from notion_settings where id = 1",
    );
    return sanitizeSyncConfig(rows[0]?.sync_config);
  } catch {
    return structuredClone(DEFAULT_SYNC_CONFIG);
  }
}

/** Salva la config (già validata). */
export async function saveSyncConfig(config: NotionSyncConfig): Promise<void> {
  const pool = db();
  if (!pool) throw new Error("database non configurato");
  await pool.query(
    `insert into notion_settings (id, sync_config) values (1, $1)
     on conflict (id) do update set sync_config = $1, updated_at = now()`,
    [JSON.stringify(config)],
  );
}

/* ── Transform whitelist ────────────────────────────────────────── */

/**
 * Trasforma il valore grezzo della colonna. `selectMappingFor` serve a
 * `mappa_sorgente`: il mapping lo decide la config, non il codice.
 */
export function applyTransform(
  value: unknown,
  transform: MappingField["transform"],
  field: MappingField,
  config: NotionSyncConfig,
): unknown {
  if (value == null || value === "") return null;
  switch (transform) {
    case "mappa_sorgente": {
      const map = config.selectMapping[field.to];
      if (!map) return String(value);
      return map[String(value)] ?? map["*"] ?? String(value);
    }
    case "solo_http": {
      const s = String(value);
      return s.startsWith("http://") || s.startsWith("https://") ? s : null;
    }
    case "iso8601": {
      const d = new Date(String(value));
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    default:
      return value;
  }
}

/* ── Template titolo ────────────────────────────────────────────── */

/** Sostituisce {{campo}} con il valore del record; se il risultato è vuoto usa il fallback. */
export function renderTitle(
  config: NotionSyncConfig,
  record: Record<string, unknown>,
): string {
  // Un render "solo separatori" (es. «—» con placeholder tutti vuoti) è come vuoto:
  // altrimenti il fallback non scatta mai con template tipo «{{company}} — {{name}}».
  const meaningful = (s: string) => (/[a-zA-Z0-9]/.test(s) ? s.trim() : "");
  const render = (tpl: string) =>
    meaningful(
      tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, key: string) => {
        const v = record[key];
        return v == null || v === "" ? "" : String(v);
      }),
    );
  const title = render(config.titleTemplate);
  return title || render(config.titleFallback) || `Lead ${String(record.id ?? "")}`;
}

/* ── Costruzione payload (l'unica fonte di verità del push) ─────── */

/**
 * Valore di un campo select. La mappa si applica UNA sola volta: se il
 * transform `mappa_sorgente` ha già tradotto il valore, qui lo si trova
 * tra le etichette di destinazione e lo si passa intatto (mai il default
 * "*" sopra un valore già corretto).
 */
function selectValue(v: unknown, prop: string, config: NotionSyncConfig): { name: string } | undefined {
  if (v == null || v === "") return undefined;
  const map = config.selectMapping[prop];
  const s = String(v);
  if (!map) return { name: s };
  // Valore già mappato dal transform (o chiave diretta): passa così.
  const isAlreadyMapped = Object.values(map).includes(s);
  const name = isAlreadyMapped ? s : (map[s] ?? map["*"] ?? s);
  return { name };
}

function textValue(v: unknown, maxLen?: number): { rich_text: { text: { content: string } }[] } {
  const s = v == null ? "" : String(v);
  return { rich_text: s ? [{ text: { content: s.slice(0, maxLen ?? 1900) } }] : [] };
}

/**
 * Payload Notion di un record secondo la config. Generico: lo stesso
 * motore serve lead, ticket e callback (Fase 4) — cambia solo il mapping.
 * `propErrors` raccoglie i problemi (valori scartati): finiscono nel sync
 * log, mai crash.
 */
export function buildNotionPayload(
  config: NotionSyncConfig,
  mapping: MappingField[],
  record: Record<string, unknown>,
  opts: { titleTemplate?: boolean } = {},
): { properties: Record<string, unknown>; propErrors: string[] } {
  const properties: Record<string, unknown> = {};
  const propErrors: string[] = [];

  for (const field of mapping) {
    const raw = applyTransform(record[field.from], field.transform, field, config);
    if (raw == null || raw === "") continue; // proprietà omessa, non errore
    switch (field.type) {
      case "title":
        // Il titolo lo decide il template di config (renderTitle sotto):
        // qui si registra solo la proprietà di destinazione.
        break;
      case "rich_text":
        properties[field.to] = textValue(raw, field.maxLen);
        break;
      case "select": {
        const sel = selectValue(raw, field.to, config);
        if (sel) properties[field.to] = { select: sel };
        break;
      }
      case "multi_select": {
        // multi: separa su virgola, comodo per UTM/tag
        const names = String(raw)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 50);
        if (names.length) properties[field.to] = { multi_select: names.map((name) => ({ name })) };
        break;
      }
      case "url":
        properties[field.to] = { url: String(raw) };
        break;
      case "date":
        properties[field.to] = { date: { start: String(raw) } };
        break;
      case "checkbox":
        properties[field.to] = { checkbox: Boolean(raw) };
        break;
      case "number": {
        const n = Number(raw);
        if (Number.isFinite(n)) properties[field.to] = { number: n };
        else propErrors.push(`«${field.to}»: valore non numerico (${String(raw).slice(0, 40)})`);
        break;
      }
      case "email":
        properties[field.to] = { email: String(raw) };
        break;
      case "phone_number":
        properties[field.to] = { phone_number: String(raw) };
        break;
    }
  }

  // Titolo: dal template di config, sulla proprietà `title` del mapping.
  const titleProp = mapping.find((f) => f.type === "title");
  if (opts.titleTemplate !== false && titleProp) {
    properties[titleProp.to] = { title: [{ text: { content: renderTitle(config, record).slice(0, 1900) } }] };
  }

  return { properties, propErrors };
}
