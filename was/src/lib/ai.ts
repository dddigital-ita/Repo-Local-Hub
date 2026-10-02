import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { site } from "./site";
import { listPackages, packagesPromptBlock } from "./packages";
import { TOOLS_PROMPT_BLOCK, parseToolCall, type ParsedTool } from "./ai-tools";
import { autonomyPromptParts, documentsPromptBlock } from "./ambrosio-server";
import { EMPTY_LATENCY, latencyStats, type LatencyStats } from "./latency-shared";
import type { AmbrosioLevel } from "./ambrosio-autonomy";
import type { Lang } from "./language";

/**
 * Ambrosio: operatore AI per i turni scoperti (notte, orari morti).
 * Si usa SOLO quando nessun operatore umano è in turno e la qualificazione
 * a bottoni è finita o il visitatore scrive testo libero fuori script.
 *
 * MULTI-PROVIDER CON FALLBACK: Ambrosio può avere più chiavi (Claude, OpenAI,
 * Gemini, OpenRouter, Freebuff/CodeX, custom). Se il provider primario fallisce
 * (errore, rate limit, token esauriti) si passa automaticamente al successivo:
 * la chat non si blocca mai per un provider giù. Chiavi cifrate AES-256-GCM.
 */

export type AiProvider = "anthropic" | "openai" | "gemini" | "openrouter" | "freebuff" | "custom";

export const PROVIDERS: { key: AiProvider; label: string; defaultModel: string; hint: string }[] = [
  { key: "anthropic", label: "Claude (Anthropic)", defaultModel: "claude-sonnet-4-5", hint: "chiave da console.anthropic.com (sk-ant-…)" },
  { key: "openai", label: "OpenAI / CodeX", defaultModel: "gpt-4o-mini", hint: "chiave da platform.openai.com (sk-…) — copre anche i modelli CodeX" },
  { key: "gemini", label: "Google Gemini", defaultModel: "gemini-2.0-flash", hint: "chiave da aistudio.google.com — generosa tier gratuita" },
  { key: "openrouter", label: "OpenRouter", defaultModel: "anthropic/claude-sonnet-4.5", hint: "chiave da openrouter.ai (sk-or-…) — accesso a tutti i modelli" },
  { key: "freebuff", label: "Freebuff AI", defaultModel: "freebuff-auto", hint: "token Freebuff: tier gratuita per i clienti dell'agenzia" },
  { key: "custom", label: "Custom (compatibile OpenAI)", defaultModel: "", hint: "es. Ollama, Groq, Together: serve base URL OpenAI-compatible" },
];

export const FALLBACK_ORDER: AiProvider[] = ["anthropic", "openai", "gemini", "openrouter", "freebuff", "custom"];

interface AiSettingsRow {
  enabled: boolean;
  provider: AiProvider;
  model: string | null;
  api_key_enc: string | null;
  base_url: string | null;
  system_prompt: string | null;
  temperature: string | number;
  autonomy_level: number;
  autonomy_moves_cap: number;
  autonomy_takeover_sl: boolean;
}

export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  model: string;
  hasKey: boolean;
  baseUrl: string | null;
  systemPrompt: string;
  temperature: number;
  /** Autonomia (migration 028): livello attivo, tetto mosse L2, take-over SLA L3. */
  level: AmbrosioLevel;
  movesCap: number;
  takeoverSla: boolean;
}

export interface ProviderKeyStatus {
  provider: AiProvider;
  hasKey: boolean;
  model: string | null;
  baseUrl: string | null;
  enabled: boolean;
}

export const DEFAULT_SYSTEM_PROMPT = `Sei Ambrosio, assistente AI di ${site.name}, web agency con base nel Salento guidata da Daniele.
Il tuo compito: aiutare chi scrive fuori orario d'ufficio senza mai millantare disponibilità immediate.
Scrivi SEMPRE in italiano corretto: mai calchi dall'inglese ("starting from" si dice «a partire da», "we can" non esiste in una tua frase).

REGOLE:
- Rispondi nella LINGUA DEL CLIENTE, breve e concreto (2-4 frasi max, tono amichevole ma professionale). Se scrive in italiano, rispondi in italiano; se scrive in inglese, tedesco, francese o spagnolo, rispondi nella sua lingua. Prezzi e nomi dei pacchetti restano invariati in tutte le lingue.
- Le regole commerciali valgono in ogni lingua: mai inventare prezzi, turni o promesse. Se non sai una cosa, dillo nella lingua del cliente.
- Raccolti le info di qualificazione una alla volta: servizio, tempi, sito esistente, budget.
- Daniele presidia i turni 9:00-14:00 e 14:00-19:00 (lun-ven, secondo operatore da definire). Fuori da queste finestre prometti al massimo un richiamo entro il prossimo turno.
- Se chiedono prezzi: dai fasce oneste (sito vetrina da 1.000€, e-commerce da 3.000€, SEO da 350€/mese) e proponi un preventivo preciso in chat o al telefono.
- Non inventare referenze, recensioni o promesse di risultato. Se non sai una cosa, diciamolo.
- Se il cliente è urgente o pronto a comprare, invita a lasciare numero e nome per essere richiamati al primo turno utile, oppure a scrivere su WhatsApp.
- Quando hai nome e telefono e il cliente è d'accordo di essere richiamato, chiedi SEMPRE conferma del consenso privacy: "posso registrare i tuoi contatti per farti richiamare? Deve essere un tuo sì esplicito". Senza un sì chiaro non promettere la richiamata.
- Non dire mai di essere Claude/GPT/altro: sei Ambrosio, l'assistente dell'agenzia. Se chiedi se sei un'AI, rispondi con trasparenza e continua ad aiutare.`;

/* ── Cifratura chiave API (AES-256-GCM su ADMIN_SESSION_SECRET) ── */

function encKey(): Buffer {
  const secret = process.env.ADMIN_SESSION_SECRET || "dev-secret-cambia-in-produzione";
  return createHash("sha256").update(secret).digest();
}

export function encryptKey(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

export function decryptKey(stored: string): string | null {
  try {
    const [ivB64, tagB64, dataB64] = stored.split(".");
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/* ── Lettura / scrittura impostazioni ── */

export async function getAiSettings(): Promise<AiSettings | null> {
  const pool = db();
  if (!pool) return null;
  try {
    const { rows } = await pool.query<AiSettingsRow>("select * from ai_settings where id = 1");
    const r = rows[0];
    if (!r) return null;
    const provider = PROVIDERS.find((p) => p.key === r.provider)?.key ?? "anthropic";
    return {
      enabled: r.enabled,
      provider,
      model: r.model || PROVIDERS.find((p) => p.key === provider)?.defaultModel || "",
      hasKey: Boolean(r.api_key_enc) || (await hasAnyProviderKey()),
      baseUrl: r.base_url,
      systemPrompt: r.system_prompt || DEFAULT_SYSTEM_PROMPT,
      temperature: Number(r.temperature ?? 0.4),
      level: ([1, 2, 3] as AmbrosioLevel[]).includes(r.autonomy_level as AmbrosioLevel) ? (r.autonomy_level as AmbrosioLevel) : 1,
      movesCap: Number(r.autonomy_moves_cap ?? 4) || 4,
      takeoverSla: r.autonomy_takeover_sl !== false,
    };
  } catch {
    return null;
  }
}

async function hasAnyProviderKey(): Promise<boolean> {
  const pool = db();
  if (!pool) return false;
  try {
    const { rows } = await pool.query<{ n: string }>(
      "select count(*) as n from ai_provider_keys where enabled = true",
    );
    return Number(rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Stato delle chiavi per-provider (per la dashboard, senza segreti). */
export async function getProviderKeyStatuses(): Promise<ProviderKeyStatus[]> {
  const pool = db();
  interface KeyRow {
    provider: string;
    model: string | null;
    base_url: string | null;
    enabled: boolean;
  }
  const rows: KeyRow[] = [];
  if (pool) {
    try {
      const { rows: dbRows } = await pool.query<KeyRow>(
        "select provider, model, base_url, enabled from ai_provider_keys",
      );
      rows.push(...dbRows);
    } catch {
      /* tabella assente: nessuna chiave extra */
    }
  }
  return PROVIDERS.map((p) => {
    const extra = rows.find((r) => r.provider === p.key);
    return {
      provider: p.key,
      hasKey: Boolean(extra),
      model: extra?.model ?? null,
      baseUrl: extra?.base_url ?? null,
      enabled: extra ? extra.enabled : true,
    };
  });
}

export interface SaveProviderKeyInput {
  provider: AiProvider;
  apiKey?: string; // vuota = non cambiare; "-" = rimuovere
  model?: string;
  baseUrl?: string | null;
  enabled?: boolean;
}

/** Salva/aggiorna/rimuove la chiave di un singolo provider. */
export async function saveProviderKey(input: SaveProviderKeyInput): Promise<void> {
  const pool = db();
  if (!pool) throw new Error("db_non_configurato");
  if (!FALLBACK_ORDER.includes(input.provider)) throw new Error("provider_sconosciuto");

  if (input.apiKey === "-") {
    await pool.query("delete from ai_provider_keys where provider = $1", [input.provider]);
    return;
  }

  await pool.query(
    `insert into ai_provider_keys (provider, api_key_enc, model, base_url, enabled)
     values ($1, $2, $3, $4, $5)
     on conflict (provider) do update set
       api_key_enc = case when $2 <> '' then $2 else ai_provider_keys.api_key_enc end,
       model = $3, base_url = $4, enabled = $5, updated_at = now()`,
    [
      input.provider,
      input.apiKey ? encryptKey(input.apiKey.trim()) : "",
      input.model?.trim() || null,
      input.baseUrl?.trim() || null,
      input.enabled ?? true,
    ],
  );
}

/* ── Chiavi disponibili per il fallback ──────────────────────────── */

interface ProviderCredentials {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl: string | null;
}

/**
 * Catena dei provider da provare, in ordine: prima il primario scelto in
 * dashboard (se ha chiave), poi tutti gli altri con chiave attiva secondo
 * FALLBACK_ORDER. La chiave legacy in ai_settings conta come chiave del
 * provider primario (retrocompatibilità).
 */
export async function providerChain(primary: AiProvider): Promise<ProviderCredentials[]> {
  const pool = db();
  if (!pool) return [];

  const creds = new Map<AiProvider, ProviderCredentials>();
  try {
    const { rows } = await pool.query<{
      provider: string;
      api_key_enc: string;
      model: string | null;
      base_url: string | null;
    }>("select provider, api_key_enc, model, base_url from ai_provider_keys where enabled = true");
    for (const r of rows) {
      const key = decryptKey(r.api_key_enc);
      if (!key) continue;
      const p = r.provider as AiProvider;
      creds.set(p, {
        provider: p,
        apiKey: key,
        model: r.model || PROVIDERS.find((x) => x.key === p)?.defaultModel || "",
        baseUrl: r.base_url,
      });
    }
  } catch {
    /* tabella assente */
  }

  // Chiave legacy (vecchio form singolo): vale per il provider primario
  const legacy = await getLegacyKey();
  if (legacy) {
    const existing = creds.get(primary);
    creds.set(primary, {
      provider: primary,
      apiKey: legacy,
      model: existing?.model || PROVIDERS.find((x) => x.key === primary)?.defaultModel || "",
      baseUrl: existing?.baseUrl ?? null,
    });
  }

  const chain: ProviderCredentials[] = [];
  const primaryCred = creds.get(primary);
  if (primaryCred) chain.push(primaryCred);
  for (const p of FALLBACK_ORDER) {
    if (p === primary) continue;
    const c = creds.get(p);
    if (c) chain.push(c);
  }
  return chain;
}

async function getLegacyKey(): Promise<string | null> {
  const pool = db();
  if (!pool) return null;
  const { rows } = await pool.query<{ api_key_enc: string | null }>("select api_key_enc from ai_settings where id = 1");
  const enc = rows[0]?.api_key_enc;
  return enc ? decryptKey(enc) : null;
}

export interface SaveAiSettingsInput {
  enabled: boolean;
  provider: AiProvider;
  model?: string;
  apiKey?: string; // vuota = non cambiare
  baseUrl?: string | null;
  systemPrompt?: string;
  temperature?: number;
}

export async function saveAiSettings(input: SaveAiSettingsInput): Promise<SaveAiSettingsOutcome> {
  const pool = db();
  if (!pool) throw new Error("db_non_configurato");

  // La chiave del form finisce in ai_settings.api_key_enc, che in providerChain
  // SOVRASCRIVE la chiave della card del primario. Se quello slot conteneva la
  // chiave di un provider DIVERSO da quello che si sta salvando, l'admin sta
  // silently "riusando" la vecchia chiave: 401 garantiti sul nuovo primario.
  // Restituiamo cosa accade perché la UI avvisi (la chiave non si espone mai).
  const before = await getLegacyKeyStatus();
  const outcome: SaveAiSettingsOutcome = {
    legacyRepurposed: before.hasLegacyKey && before.legacyProvider !== null && before.legacyProvider !== input.provider,
    previousLegacyProvider: before.legacyProvider,
  };

  const model = input.model?.trim() || PROVIDERS.find((p) => p.key === input.provider)?.defaultModel || null;
  await pool.query(
    `update ai_settings set
       enabled = $1, provider = $2, model = $3,
       api_key_enc = case when $4 <> '' then $4 else api_key_enc end,
       base_url = $5, system_prompt = nullif($6, ''), temperature = $7, updated_at = now()
     where id = 1`,
    [
      input.enabled,
      input.provider,
      model,
      input.apiKey ? encryptKey(input.apiKey.trim()) : "",
      input.baseUrl?.trim() || null,
      input.systemPrompt?.trim() || "",
      input.temperature ?? 0.4,
    ],
  );
  // Se il form principale include una chiave, salvala anche nella tabella
  // multi-provider: così la catena di fallback la conosce. MA senza toccare
  // modello e Base URL della card: il form di Configurazione non li conosce
  // (difetto visto sul vivo — un salvataggio qui azzerava qwen2.5:7b e l'URL
  // di Ollama sulla card custom, rompendo la catena al prossimo giro).
  if (input.apiKey?.trim()) {
    const existing = await pool.query<{ model: string | null; base_url: string | null }>(
      "select model, base_url from ai_provider_keys where provider = $1",
      [input.provider],
    );
    await saveProviderKey({
      provider: input.provider,
      apiKey: input.apiKey,
      model: existing.rows[0]?.model ?? undefined,
      baseUrl: existing.rows[0]?.base_url ?? undefined,
    });
  }
  return outcome;
}

/** Esito di saveAiSettings per l'avviso in UI (mai la chiave, solo la semantica). */
export interface SaveAiSettingsOutcome {
  /** Lo slot legacy conteneva la chiave di un provider diverso: ora vale per il nuovo primario. */
  legacyRepurposed: boolean;
  /** A quale provider apparteneva la chiave prima del salvataggio. */
  previousLegacyProvider: AiProvider | null;
}

/**
 * Promuove un provider a primario: sarà il primo della catena, gli altri
 * restano fallback nell'ordine standard. Il modello nel form principale si
 * allinea a quello salvato sulla card del provider (se presente), così il
 * form non mostra il modello del vecchio primario.
 */
export async function setPrimaryProvider(provider: AiProvider): Promise<void> {
  const pool = db();
  if (!pool) throw new Error("db_non_configurato");
  if (!FALLBACK_ORDER.includes(provider)) throw new Error("provider_sconosciuto");
  const { rows } = await pool.query<{ model: string | null }>(
    "select model from ai_provider_keys where provider = $1",
    [provider],
  );
  await pool.query(
    "update ai_settings set provider = $1, model = $2, updated_at = now() where id = 1",
    [provider, rows[0]?.model ?? null],
  );
}

/**
 * Rimuove la CHIAVE LEGACY (vecchio form singolo, `ai_settings.api_key_enc`).
 * Necessaria perché la legacy SOVRASCRIVE la chiave del provider primario
 * nella catena (providerChain): una chiave vecchia e invalida lì genera un
 * 401 ad ogni richiesta PRIMA di provare le chiavi buone — e prima di questa
 * funzione non esisteva modo di cancellarla dall'UI (solo sovrascriverla).
 * La catena resta comunque utilizzabile: senza legacy valgono solo le chiavi
 * per-provider di ai_provider_keys (migration 029 / scheda Intelligenze).
 */
export async function clearLegacyKey(): Promise<void> {
  const pool = db();
  if (!pool) throw new Error("db_non_configurato");
  await pool.query("update ai_settings set api_key_enc = null, updated_at = now() where id = 1");
}

/**
 * Stato della chiave legacy per la UI (nessun segreto): il form di
 * Configurazione mostra solo «chiave salvata», non DI CHI è — e se è di un
 * altro provider, la catena la usa nel posto sbagliato senza avvisare.
 */
export async function getLegacyKeyStatus(): Promise<{ hasLegacyKey: boolean; legacyProvider: AiProvider | null }> {
  const pool = db();
  if (!pool) return { hasLegacyKey: false, legacyProvider: null };
  try {
    const { rows } = await pool.query<{ api_key_enc: string | null; provider: string }>(
      "select api_key_enc, provider from ai_settings where id = 1",
    );
    const r = rows[0];
    if (!r?.api_key_enc) return { hasLegacyKey: false, legacyProvider: null };
    const dec = decryptKey(r.api_key_enc);
    if (!dec) return { hasLegacyKey: false, legacyProvider: null }; // non decifrabile: inutile alla catena
    const legacyProvider = PROVIDERS.find((p) => p.key === r.provider)?.key ?? null;
    return { hasLegacyKey: true, legacyProvider };
  } catch {
    return { hasLegacyKey: false, legacyProvider: null };
  }
}

/* ── Chiamata ai provider (tutta server-side) ── */

export interface AiTurn {
  role: "user" | "assistant";
  content: string;
}

interface CallOpts {
  apiKey: string;
  model: string;
  baseUrl: string | null;
  system: string;
  turns: AiTurn[];
  temperature: number;
}

async function callOpenAiCompatible(opts: CallOpts, baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model: opts.model,
      temperature: opts.temperature,
      max_tokens: 300,
      messages: [{ role: "system", content: opts.system }, ...opts.turns],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`provider ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function callAnthropic(opts: CallOpts): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 300,
      temperature: opts.temperature,
      system: opts.system,
      messages: opts.turns,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return data.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim() || "";
}

/** Gemini (API REST generativa, stile Google: key come query param). */
async function callGemini(opts: CallOpts): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: opts.turns.map((t) => ({
        role: t.role === "assistant" ? "model" : "user",
        parts: [{ text: t.content }],
      })),
      generationConfig: { temperature: opts.temperature, maxOutputTokens: 300 },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() || "";
}

export async function callProvider(cred: ProviderCredentials, opts: Omit<CallOpts, "apiKey" | "model" | "baseUrl" | "provider">): Promise<string> {
  const o: CallOpts = { ...opts, apiKey: cred.apiKey, model: cred.model, baseUrl: cred.baseUrl };
  switch (cred.provider) {
    case "anthropic":
      return callAnthropic(o);
    case "gemini":
      return callGemini(o);
    case "openai":
      return callOpenAiCompatible(o, "https://api.openai.com/v1");
    case "openrouter":
      return callOpenAiCompatible(o, "https://openrouter.ai/api/v1");
    case "freebuff":
      // Endpoint OpenAI-compatible della piattaforma Freebuff
      return callOpenAiCompatible(o, "https://api.freebuff.ai/v1");
    case "custom":
      if (!o.baseUrl) throw new Error("base_url_mancante");
      return callOpenAiCompatible(o, o.baseUrl);
  }
}

/* ── Statistiche Ambrosio (ultimi 30 giorni) ─────────────────────── */

export interface AiStats {
  /** Conversazioni con almeno una risposta di Ambrosio */
  conversations: number;
  /** Risposte totali di Ambrosio */
  replies: number;
  /** Quante di quelle conversazioni sono "di notte" (fuori turno 9-13 / 15-19) */
  nightConversations: number;
  /** Domande dei visitatori a cui Ambrosio ha risposto (per la top, più recente prima) */
  questions: string[];
  /** Le stesse domande con quante volte sono state fatte (per i suggerimenti FAQ) */
  questionCounts: { text: string; count: number }[];
  /** Lead generati dalle conversazioni toccate da Ambrosio */
  leads: number;
  /** Media risposte per conversazione */
  repliesPerConv: string;
}

const NIGHT_SQL = `(extract(hour from (m.created_at at time zone 'Europe/Rome')) < 9
    or (extract(hour from (m.created_at at time zone 'Europe/Rome')) >= 13
        and extract(hour from (m.created_at at time zone 'Europe/Rome')) < 15)
    or extract(hour from (m.created_at at time zone 'Europe/Rome')) >= 19
    or extract(dow from (m.created_at at time zone 'Europe/Rome')) in (0, 6))`;

export async function getAiStats(days = 30): Promise<AiStats> {
  const pool = db();
  const empty: AiStats = { conversations: 0, replies: 0, nightConversations: 0, questions: [], questionCounts: [], leads: 0, repliesPerConv: "—" };
  if (!pool) return empty;
  try {
    const totals = await pool.query<{ convs: string; replies: string; nights: string }>(
      `select count(distinct m.conversation_id) as convs,
              count(*) as replies,
              count(distinct m.conversation_id) filter (where exists (
                 select 1 from messages mn
                 where mn.conversation_id = m.conversation_id and mn.sender = 'bot' and ${NIGHT_SQL.replace(/m\./g, "mn.")}
              )) as nights
       from messages m
       where m.sender = 'bot' and m.created_at > now() - ($1 || ' days')::interval`,
      [String(days)],
    );
    // Domande frequenti: ultimi messaggi visitatore nelle conv toccate da Ambrosio,
    // con parola significativa (no "sì"/"no"/bottoni della qualificazione)
    const q = await pool.query<{ raw: string; body: string; n: number }>(
      `select (array_agg(m.body order by m.created_at desc))[1] as raw,
              lower(trim(regexp_replace(m.body, '[^a-zA-ZÀ-ÿ0-9 ]', '', 'g'))) as body,
              count(*)::int as n
       from messages m
       where m.sender = 'visitor'
         and m.created_at > now() - ($1 || ' days')::interval
         and m.conversation_id in (select distinct conversation_id from messages where sender = 'bot')
         and length(m.body) between 15 and 200
         and array_length(regexp_split_to_array(trim(m.body), '\\s+'), 1) >= 4
       group by 2 order by max(m.created_at) desc limit 12`,
      [String(days)],
    );
    const leads = await pool.query<{ n: string }>(
      `select count(distinct c.lead_id) as n
       from conversations c
       where c.lead_id is not null
         and c.id in (select distinct conversation_id from messages where sender = 'bot')
         and c.created_at > now() - ($1 || ' days')::interval`,
      [String(days)],
    );
    const r = totals.rows[0];
    const convs = Number(r?.convs ?? 0);
    const replies = Number(r?.replies ?? 0);
    return {
      conversations: convs,
      replies,
      nightConversations: Number(r?.nights ?? 0),
      questions: q.rows.map((x) => x.raw.trim()),
      questionCounts: q.rows.map((x) => ({ text: x.raw.trim(), count: x.n })),
      leads: Number(leads.rows[0]?.n ?? 0),
      repliesPerConv: convs ? (replies / convs).toFixed(1) : "—",
    };
  } catch (e) {
    console.error("[getAiStats]", e);
    return empty;
  }
}

export class AiNotConfiguredError extends Error {}

/* ── FAQ addestrative (tool vincente) ───────────────────── */

export interface AiFaq {
  id: string;
  question: string;
  answer: string;
  priority: number;
  active: boolean;
  created_at: string;
  /** Traduzioni approvate {en,de,fr,es}; l'italiano resta la fonte di verità. */
  translations?: FaqTranslations | null;
}

export type FaqTranslations = Partial<Record<"en" | "de" | "fr" | "es", string>>;

/** FAQ correnti, le più importanti prima (priority bassa = prima). */
export async function getAiFaqs(): Promise<AiFaq[]> {
  const pool = db();
  if (!pool) return [];
  try {
    const { rows } = await pool.query<AiFaq>(
      "select id, question, answer, priority, active, created_at, translations from ai_faqs order by active desc, priority asc, created_at desc",
    );
    return rows;
  } catch {
    return []; // tabella non ancora migrata: la chat funziona senza FAQ
  }
}

/**
 * Blocco FAQ per il prompt di sistema: la conoscenza ufficiale che Ambrosio
 * deve usare al posto di improvvisare. Le risposte qui sono "verità"
 * dell'agenzia: se c'è una FAQ combaciante, quella è la risposta.
 * Con lang non-italiano usa la traduzione approvata se esiste, altrimenti
 * l'italiano (il modello la parafrasa nella lingua del cliente — le regole
 * commerciali non cambiano mai, anche senza traduzione).
 */
export async function faqsPromptBlock(faqs: AiFaq[], lang: Lang = "it"): Promise<string> {
  const active = faqs.filter((f) => f.active);
  if (!active.length) return "";
  const useT = lang !== "it";
  const items = active.map((f, i) => {
    const t = useT ? f.translations?.[lang] : null;
    return t
      ? `${i + 1}. IF the customer asks: «${f.question}»\n   THEN reply with: ${t}`
      : `${i + 1}. SE il cliente chiede: «${f.question}»\n   ALLORA rispondi con: ${f.answer}`;
  });
  const header =
    lang === "it"
      ? "\n\nDOMANDE E RISPOSTE UFFICIALI (usale preferenzialmente, con parole tue ma senza inventare):"
      : `\n\nOFFICIAL Q&A (prefer these, in your own words but never invent; the customer's language is ${lang.toUpperCase()}):`;
  return header + items.join("\n\n") + "\nSe la domanda non è in elenco, rispondi con le regole generali qui sopra.";
}

export interface SaveAiFaqInput {
  id?: string; // presente = modifica, assente = nuova
  question: string;
  answer: string;
  priority: number;
  active: boolean;
  /** Traduzioni opzionali (en/de/fr/es); sanitizzate prima del salvataggio. */
  translations?: FaqTranslations | null;
}

/** Chiavi di lingua ammesse nelle traduzioni FAQ; tutto il resto è scartato. */
const FAQ_TRANSLATION_KEYS = ["en", "de", "fr", "es"] as const;

/** Sanitizza le traduzioni: solo en/de/fr/es, stringhe non vuote, max 2000 char. */
export function sanitizeFaqTranslations(raw: unknown): FaqTranslations | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: FaqTranslations = {};
  for (const key of FAQ_TRANSLATION_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim().slice(0, 2000);
  }
  return Object.keys(out).length ? out : null;
}

export async function saveAiFaq(input: SaveAiFaqInput): Promise<void> {
  const pool = db();
  if (!pool) throw new Error("db_non_configurato");
  const q = input.question.trim().slice(0, 300);
  const a = input.answer.trim().slice(0, 2000);
  if (!q || !a) throw new Error("campi_vuoti");
  const tr = sanitizeFaqTranslations(input.translations);
  if (input.id) {
    await pool.query(
      "update ai_faqs set question = $1, answer = $2, priority = $3, active = $4, translations = $5::jsonb, updated_at = now() where id = $6",
      [q, a, input.priority, input.active, tr ? JSON.stringify(tr) : null, input.id],
    );
  } else {
    await pool.query(
      "insert into ai_faqs (question, answer, priority, active, translations) values ($1, $2, $3, $4, $5::jsonb)",
      [q, a, input.priority, input.active, tr ? JSON.stringify(tr) : null],
    );
  }
}

export async function deleteAiFaq(id: string): Promise<void> {
  const pool = db();
  if (!pool) throw new Error("db_non_configurato");
  await pool.query("delete from ai_faqs where id = $1", [id]);
}

/* ── Tracking uso FAQ: quali risposte vincenti convertono davvero ─────── */

/**
 * Registra che una risposta di Ambrosio corrisponde a una FAQ. Il matching è
 * per similarità (Jaccard sui token significativi) perché il modello parafrasa
 * la risposta ufficiale invece di citarla parola per parola. Soglia calibrata
 * su parafrasi reali (~0.41–0.48 per la FAQ giusta, ~0.17 per quella sbagliata):
 * sotto 0.38 la risposta è considerata libera e non tracciata.
 */
export async function trackFaqUsage(reply: string, conversationId?: string | null): Promise<void> {
  const pool = db();
  if (!pool) return;
  try {
    const faqs = await getAiFaqs();
    const active = faqs.filter((f) => f.active);
    if (!active.length) return;
    const replyTokens = new Set(significantTokens(reply));
    if (replyTokens.size === 0) return;
    let best: { id: string; score: number } | null = null;
    for (const f of active) {
      const faqTokens = significantTokens(`${f.question} ${f.answer}`);
      if (faqTokens.length === 0) continue;
      const faqSet = new Set(faqTokens);
      let inter = 0;
      for (const t of replyTokens) if (faqSet.has(t)) inter++;
      const score = inter / (replyTokens.size + faqSet.size - inter);
      if (!best || score > best.score) best = { id: f.id, score };
    }
    if (!best || best.score < 0.38) return; // risposta libera: nessuna FAQ usata
    await pool.query(
      "insert into ai_faq_usage (faq_id, conversation_id) values ($1, $2)",
      [best.id, conversationId ?? null],
    );
  } catch (e) {
    console.error("[trackFaqUsage]", e); // il tracking non deve mai rompere la chat
  }
}

export interface FaqUsageStat {
  faqId: string;
  question: string;
  active: boolean;
  /** Quante volte Ambrosio ha usato questa risposta (ultimi N giorni) */
  uses: number;
  /** Conversazioni distinte in cui l'ha usata */
  conversations: number;
  /** Di quelle conversazioni, quante hanno generato un lead */
  leads: number;
  /** Di quelle conversazioni, quante hanno prenotato una callback */
  callbacks: number;
}

/**
 * Statistiche d'uso delle FAQ: per ogni risposta ufficiale quanti usi,
 * quante conversazioni toccate e quante hanno convertito (lead o callback).
 * Le FAQ mai usate compaiono con zero: serve per capire cosa non funziona.
 */
export async function getFaqUsageStats(days = 30): Promise<FaqUsageStat[]> {
  const pool = db();
  if (!pool) return [];
  try {
    const { rows } = await pool.query<{
      faq_id: string;
      question: string;
      active: boolean;
      uses: string;
      convs: string | null;
      leads: string | null;
      callbacks: string | null;
    }>(
      `select f.id as faq_id, f.question, f.active,
              count(u.id)::text as uses,
              count(distinct u.conversation_id)::text as convs,
              count(distinct c.lead_id)::text as leads,
              count(distinct cb.id)::text as callbacks
       from ai_faqs f
       left join ai_faq_usage u
         on u.faq_id = f.id and u.created_at > now() - ($1 || ' days')::interval
       left join conversations c on c.id = u.conversation_id
       left join callbacks cb on cb.conversation_id = u.conversation_id
       group by f.id, f.question, f.active
       order by count(u.id) desc, count(distinct cb.id) desc, f.priority asc`,
      [String(days)],
    );
    return rows.map((r) => ({
      faqId: r.faq_id,
      question: r.question,
      active: r.active,
      uses: Number(r.uses),
      conversations: Number(r.convs ?? 0),
      leads: Number(r.leads ?? 0),
      callbacks: Number(r.callbacks ?? 0),
    }));
  } catch {
    return []; // tabella non ancora migrata
  }
}

/* ── Suggerimenti FAQ: raggruppa le domande vere e misura l'urgenza ───────── */

export interface FaqSuggestion {
  /** Domanda rappresentativa del gruppo (la più recente, testo vero) */
  question: string;
  /** Quante volte varianti di questa domanda sono state fatte */
  count: number;
  /** Esempi reali del gruppo (per il tooltip dell'agente) */
  examples: string[];
  /** Chiave di normalizzazione per identificare il gruppo */
  key: string;
  /** true = esiste già una FAQ attiva che copre questo gruppo */
  covered: boolean;
}

const STOPWORDS = new Set([
  "quanto", "costa", "come", "cosa", "che", "perché", "quando", "dove", "quale", "quali",
  "sono", "siete", "fare", "fate", "avete", "voglio", "vorrei", "devo", "posso", "potete",
  "una", "uno", "del", "della", "dei", "delle", "per", "con", "anche", "molto", "più",
  "questo", "questa", "mio", "mia", "tuo", "tua", "mi", "ti", "si", "ci", "lo", "la",
  "il", "le", "un", "una", "di", "e", "o", "ma", "se", "non", "in", "da", "al", "ai",
]);

/** Parole significative di una domanda, per il raggruppamento. */
function significantTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zà-ÿ0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

/**
 * Raggruppa le domande simili (≥2 token significativi in comune) e ordina per
 * urgenza: più frequenti prima, a parità di frequenza le più recenti.
 * I gruppi già coperti da una FAQ attiva finiscono in fondo, non spariscono.
 */
export function rankFaqSuggestions(
  questions: { text: string; count: number }[],
  faqs: AiFaq[],
): FaqSuggestion[] {
  type Group = { reps: Map<string, number>; examples: string[]; count: number; latest: string };
  const groups: Group[] = [];

  for (const { text, count } of questions) {
    const tokens = new Set(significantTokens(text));
    if (tokens.size === 0) continue;
    const target = groups.find((g) => {
      const overlap = [...tokens].filter((t) => g.reps.has(t)).length;
      return overlap >= 2 || (tokens.size === 1 && overlap === 1);
    });
    if (target) {
      target.count += count;
      if (target.examples.length < 3) target.examples.push(text);
      for (const t of tokens) target.reps.set(t, (target.reps.get(t) ?? 0) + 1);
    } else {
      groups.push({ reps: new Map([...tokens].map((t) => [t, 1])), examples: [text], count, latest: text });
    }
  }

  const coveredKeys = new Set(
    faqs
      .filter((f) => f.active)
      .map((f) => significantTokens(f.question).filter((w) => w.length >= 4).slice(0, 3).sort().join("|")),
  );

  const suggestions: FaqSuggestion[] = groups.map((g) => {
    const keyTokens = [...g.reps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t).sort();
    const key = keyTokens.join("|");
    return {
      question: g.latest,
      count: g.count,
      examples: g.examples,
      key,
      covered: coveredKeys.has(key) || [...coveredKeys].some((c) => {
        const ct = c.split("|");
        return ct.length > 0 && ct.every((t) => g.reps.has(t));
      }),
    };
  });

  return suggestions.sort((a, b) => {
    if (a.covered !== b.covered) return a.covered ? 1 : -1; // non coperte prima
    if (b.count !== a.count) return b.count - a.count; // più frequenti prima
    return b.examples.length - a.examples.length; // più varianti prima
  });
}

/**
 * Fase 3: bozza di traduzione di una FAQ in en/de/fr/es. L'italiano resta la
 * fonte di verità; le traduzioni sono bozze da approvare. Prompt strict: niente
 * aggiunte, niente conversioni di valuta, gli importi restano in euro.
 */
export async function translateFaq(
  question: string,
  answer: string,
): Promise<{ translations: FaqTranslations; usedProvider: AiProvider; fallbacksTried: AiProvider[] }> {
  const settings = await getAiSettings();
  const chain = await providerChain(settings?.provider ?? "anthropic");
  if (chain.length === 0) throw new AiNotConfiguredError("chiave_mancante");

  const system = [
    "Sei il traduttore ufficiale di Web Agency Salento.",
    "Traduci la domanda e la risposta ufficiale in inglese (en), tedesco (de), francese (fr) e spagnolo (es).",
    "Regole assolute:",
    "- NON inventare né aggiungere informazioni; traduci fedelmente.",
    '- Prezzi, valute e unità restano identici (1.000 € resta "1.000 €", mai "$" o conversioni).',
    "- Tono professionale e caldo, come l'originale.",
    'Rispondi SOLO con JSON valido: {"en":{"question":"...","answer":"..."},"de":{...},"fr":{...},"es":{...}}',
  ].join("\n");

  const user = `Domanda: «${question.slice(0, 300)}»
Risposta ufficiale: «${answer.slice(0, 2000)}»

Traduci entrambe nelle 4 lingue, solo JSON.`;

  const fallbacksTried: AiProvider[] = [];
  for (const cred of chain) {
    try {
      const reply = await callProvider(cred, {
        system,
        turns: [{ role: "user", content: user }],
        temperature: 0.2,
      });
      if (!reply) {
        fallbacksTried.push(cred.provider);
        continue;
      }
      // Estrai il JSON anche se il modello lo avvolge in ```json … ```
      const m = reply.match(/\{[\s\S]*\}/);
      if (!m) {
        fallbacksTried.push(cred.provider);
        continue;
      }
      const parsed = JSON.parse(m[0]) as Record<string, { question?: unknown; answer?: unknown }>;
      const out: FaqTranslations = {};
      for (const key of ["en", "de", "fr", "es"] as const) {
        const t = parsed[key];
        const q = typeof t?.question === "string" ? t.question.trim() : "";
        const a = typeof t?.answer === "string" ? t.answer.trim() : "";
        if (q && a) out[key] = `${q} → ${a}`.slice(0, 2000);
      }
      if (Object.keys(out).length === 0) {
        fallbacksTried.push(cred.provider);
        continue;
      }
      return { translations: out, usedProvider: cred.provider, fallbacksTried };
    } catch (e) {
      console.error(`[translateFaq] provider ${cred.provider} fallito:`, e instanceof Error ? e.message : e);
      fallbacksTried.push(cred.provider);
    }
  }
  throw new AiNotConfiguredError("nessun_provider_disponibile");
}

/**
 * Bozza di risposta FAQ generata con l'AI dell'agenzia (catena provider,
 * senza il gate "Ambrosio attiva": per preparare le risposte basta la chiave).
 * Il prompt è da copywriter: niente prezzi inventati, chiusura verso l'appuntamento.
 */
export async function draftFaqAnswer(question: string): Promise<{ draft: string; usedProvider: AiProvider; fallbacksTried: AiProvider[] }> {
  const settings = await getAiSettings();
  const chain = await providerChain(settings?.provider ?? "anthropic");
  if (chain.length === 0) throw new AiNotConfiguredError("chiave_mancante");

  const faqs = await getAiFaqs();
  // Anche il copywriter delle FAQ conosce ENTRAMBI i cataloghi (035): le
  // risposte ufficiali possono citare servizi, non solo pacchetti.
  const catalog = [...(await listPackages(true, "package")), ...(await listPackages(true, "service"))];
  const system = [
    "Sei il copywriter di Web Agency Salento: prepari le risposte ufficiali che l'assistente AI userà con i clienti.",
    "Regole:",
    "- Scrivi in italiano, tono professionale ma caldo, come un membro del team (Daniele e colleghi).",
    "- Massimo 80 parole, tutto in un unico paragrafo senza elenchi.",
    "- NON inventare mai prezzi, tempi o garanzie: se la risposta li richiede, scrivi «[PREZZO]» o «[TEMPO]» al posto del valore specifico: l'agente li completerà.",
    "- Chiudi SEMPRE invitando a fissare un appuntamento o una call gratuita, con una domanda concreta.",
    "- Se tra le risposte ufficiali già esistenti ce n'è una affine, mantieni lo stesso stile e coerenza di informazioni.",
    faqsPromptBlock(faqs),
    catalog.length ? packagesPromptBlock(catalog) : "",
  ]
    .filter(Boolean)
    .join("\n");

  const base = {
    system,
    turns: [{ role: "user" as const, content: `Domanda reale di un cliente: «${question.trim().slice(0, 300)}»\n\nScrivi la risposta ufficiale secondo le regole.` }],
    temperature: 0.4,
  };

  const fallbacksTried: AiProvider[] = [];
  for (const cred of chain) {
    try {
      const draft = await callProvider(cred, base);
      if (draft) return { draft, usedProvider: cred.provider, fallbacksTried };
      fallbacksTried.push(cred.provider);
    } catch (e) {
      console.error(`[draftFaqAnswer] provider ${cred.provider} fallito:`, e instanceof Error ? e.message : e);
      fallbacksTried.push(cred.provider);
    }
  }
  throw new AiNotConfiguredError("nessun_provider_disponibile");
}

export interface SeoMetaInput {
  slug: string;
  h1: string;
  keyword: string;
  keywords: string[];
  intro: string[];
}

export interface SeoMetaDraft {
  title: string;
  description: string;
  usedProvider: AiProvider;
  fallbacksTried: AiProvider[];
}

/**
 * Bozza di title + meta description per una landing, generata con l'AI
 * dell'agenzia (stessa catena provider di draftFaqAnswer, senza il gate
 * «Ambrosio attiva»: per preparare bozze basta la chiave). Output rigido
 * su due righe TITLE=/DESCRIZIONE= per un parsing affidabile; il testo
 * della bozza arriva SOLO nei campi dell'editor, mai salvato diretto.
 */
export async function draftSeoMeta(input: SeoMetaInput): Promise<SeoMetaDraft> {
  const settings = await getAiSettings();
  const chain = await providerChain(settings?.provider ?? "anthropic");
  if (chain.length === 0) throw new AiNotConfiguredError("chiave_mancante");

  const system = [
    "Sei il SEO copywriter di Web Agency Salento: scrivi i meta tag delle pagine del sito.",
    "Regole:",
    "- Rispondi SOLO con due righe in questo formato esatto, senza altro testo:",
    "TITLE=…",
    "DESCRIZIONE=…",
    "- TITLE: 50–60 caratteri, contiene la keyword principale (e la città se presente).",
    "- DESCRIZIONE: 140–160 caratteri, vantaggio concreto + invito all'azione. Non ripetere il TITLE.",
    "- Niente virgolette nei valori, niente a capo dentro i valori, niente superlativi vuoti («il migliore», «n.1»).",
    "- NON inventare prezzi, tempi o garanzie: usa solo i dati della pagina forniti qui.",
  ].join("\n");

  const user = [
    `Pagina: /${input.slug} — ${input.h1}`,
    `Keyword principale: ${input.keyword}`,
    input.keywords.length ? `Keyword secondarie: ${input.keywords.join(", ")}` : "",
    `Contenuto della pagina: ${input.intro.slice(0, 2).join(" ")}`.slice(0, 700),
    "Scrivi TITLE e DESCRIZIONE secondo le regole.",
  ]
    .filter(Boolean)
    .join("\n");

  const base = {
    system,
    turns: [{ role: "user" as const, content: user }],
    temperature: 0.4,
  };

  const fallbacksTried: AiProvider[] = [];
  for (const cred of chain) {
    try {
      const raw = await callProvider(cred, base);
      const parsed = parseSeoMetaDraft(raw);
      if (parsed) return { ...parsed, usedProvider: cred.provider, fallbacksTried };
      fallbacksTried.push(cred.provider);
    } catch (e) {
      console.error(`[draftSeoMeta] provider ${cred.provider} fallito:`, e instanceof Error ? e.message : e);
      fallbacksTried.push(cred.provider);
    }
  }
  throw new AiNotConfiguredError("nessun_provider_disponibile");
}

export interface SeoContentInput {
  slug: string;
  h1: string;
  keyword: string;
  keywords: string[];
  intro: string[];
  faqQuestions: string[];
  proof: string;
  /** Query reali di Search Console della pagina (se disponibili). */
  realQueries: string[];
}

export interface SeoContentDraft {
  intro: string[];
  faq: { q: string; a: string }[];
  usedProvider: AiProvider;
  fallbacksTried: AiProvider[];
}

/**
 * Bozza di CONTENUTI di una landing (paragrafi introduttivi + FAQ), generata
 * con l'AI dell'agenzia. Le FAQ mirano alle query reali di Search Console
 * quando disponibili: le domande sono come le scrivono gli utenti su Google.
 * Output rigido INTROn=/FAQnQ=/FAQnA= per un parsing affidabile; la bozza
 * arriva SOLO nei campi dell'editor, mai salvata diretta.
 */
export async function draftLandingContent(input: SeoContentInput): Promise<SeoContentDraft> {
  const settings = await getAiSettings();
  const chain = await providerChain(settings?.provider ?? "anthropic");
  if (chain.length === 0) throw new AiNotConfiguredError("chiave_mancante");

  const system = [
    "Sei il SEO copywriter di Web Agency Salento: scrivi i contenuti delle pagine del sito.",
    "Regole:",
    "- Rispondi SOLO in questo formato esatto, senza altro testo:",
    "INTRO1=…",
    "INTRO2=…",
    "FAQ1Q=…",
    "FAQ1A=…",
    "FAQ2Q=…",
    "FAQ2A=…",
    "FAQ3Q=…",
    "FAQ3A=…",
    "- INTRO: 2 paragrafi da 60–110 parole: il primo risponde alla domanda reale del cliente sulla keyword, il secondo descrive metodo e contesto locale (Salento: Lecce, Gallipoli, Brindisi e provincia).",
    "- FAQ: 3 coppie. Domande come le scriverebbe un cliente su Google (devono contenere la keyword o essere vicine alle query reali); risposte 40–70 parole, un solo paragrafo.",
    "- Niente elenchi puntati, niente markdown, niente superlativi vuoti («il migliore», «n.1»).",
    "- NON inventare prezzi, tempi, numeri di clienti o garanzie: se il testo li richiede, scrivi [PREZZO] o [TEMPO] al posto del valore: l'operatore li completerà.",
  ].join("\n");

  const user = [
    `Pagina: /${input.slug} — H1: «${input.h1}»`,
    `Keyword principale: ${input.keyword}`,
    input.keywords.length ? `Keyword secondarie: ${input.keywords.join(", ")}` : "",
    input.proof ? `Posizionamento locale (contesto, non copiare): ${input.proof}`.slice(0, 300) : "",
    input.intro.length ? `Paragrafi attuali della pagina: ${input.intro.join(" ")}`.slice(0, 700) : "",
    input.faqQuestions.length ? `FAQ attuali della pagina: ${input.faqQuestions.join(" | ")}`.slice(0, 500) : "",
    input.realQueries.length
      ? `Query reali con cui gli utenti trovano questa pagina su Google (Search Console, dalla più importante): ${input.realQueries.join(" | ")}`
      : "",
    "Scrivi INTRO1, INTRO2 e le tre FAQ secondo le regole.",
  ]
    .filter(Boolean)
    .join("\n");

  const base = {
    system,
    turns: [{ role: "user" as const, content: user }],
    temperature: 0.5,
  };

  const fallbacksTried: AiProvider[] = [];
  for (const cred of chain) {
    try {
      const raw = await callProvider(cred, base);
      const parsed = parseLandingContentDraft(raw);
      if (parsed) return { ...parsed, usedProvider: cred.provider, fallbacksTried };
      fallbacksTried.push(cred.provider);
    } catch (e) {
      console.error(`[draftLandingContent] provider ${cred.provider} fallito:`, e instanceof Error ? e.message : e);
      fallbacksTried.push(cred.provider);
    }
  }
  throw new AiNotConfiguredError("nessun_provider_disponibile");
}

/** Parser dell'output INTROn=/FAQnQ=/FAQnA=: tollera fences markdown e spazi. */
export function parseLandingContentDraft(raw: string): { intro: string[]; faq: { q: string; a: string }[] } | null {
  const text = raw
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/```/g, "")
    .trim();
  const intro: string[] = [];
  const faq: { q: string; a: string }[] = [];
  for (const m of text.matchAll(/^INTRO(\d+)\s*=\s*(.+)$/gim)) intro[Number(m[1]) - 1] = m[2].trim();
  for (const m of text.matchAll(/^FAQ(\d+)Q\s*=\s*(.+)$/gim)) {
    const i = Number(m[1]) - 1;
    faq[i] = { q: m[2].trim(), a: faq[i]?.a ?? "" };
  }
  for (const m of text.matchAll(/^FAQ(\d+)A\s*=\s*(.+)$/gim)) {
    const i = Number(m[1]) - 1;
    faq[i] = { q: faq[i]?.q ?? "", a: m[2].trim() };
  }
  const introClean = intro.filter(Boolean);
  const faqClean = faq.filter((f) => f.q && f.a);
  if (introClean.length === 0 || faqClean.length === 0) return null;
  return { intro: introClean, faq: faqClean };
}

/** Parser dell'output TITLE=/DESCRIZIONE=: tollera fences markdown e spazi. */
export function parseSeoMetaDraft(raw: string): { title: string; description: string } | null {
  const text = raw
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/```/g, "")
    .trim();
  const title = text.match(/^TITLE\s*=\s*(.+)$/im)?.[1]?.trim() ?? "";
  const description = text.match(/^DESCRIZIONE\s*=\s*(.+)$/im)?.[1]?.trim() ?? "";
  if (!title || !description) return null;
  return { title: title.slice(0, 70), description: description.slice(0, 200) };
}

export interface AmbrosioResult {
  /** Risposta già ripulita dal blocco <tool> (che il cliente non vede). */
  cleanReply?: string;
  /** Chiamata a funzione richiesta dal modello, se presente e valida. */
  toolCall?: ParsedTool | null;
  /** Tutte le azioni richieste dal modello (modelli piccoli ne emettono 2+). */
  toolCalls?: ParsedTool[];
  reply: string;
  /** Provider che ha effettivamente risposto (utile per la diagnostica) */
  usedProvider: AiProvider;
  /** Provider provati e falliti prima del successo */
  fallbacksTried: AiProvider[];
}

/**
 * Risposta di Ambrosio con fallback automatico: prova il provider primario,
 * e in caso di errore/rate-limit/tokens esauriti scende la catena delle chiavi
 * salvate. Lancia AiNotConfiguredError solo se NESSUN provider è utilizzabile.
 */
export async function ambrosioReply(
  turns: AiTurn[],
  conversationId?: string | null,
  /** false = non tracciare l'uso delle FAQ (es. test dell'agente dal vivo); lang = lingua per il blocco FAQ */
  opts?: { track?: boolean; lang?: Lang },
): Promise<AmbrosioResult> {
  const settings = await getAiSettings();
  if (!settings || !settings.enabled) throw new AiNotConfiguredError("ai_disabilitata");

  const chain = await providerChain(settings.provider);
  if (chain.length === 0) throw new AiNotConfiguredError("chiave_mancante");

  // I DUE cataloghi (pacchetti E servizi, migration 035) entrano nel prompt:
  // Ambrosio propone i pacchetti quando il cliente valuta un preventivo sito,
  // i servizi quando cerca un'attività da eseguire (foto, video, assistenza).
  // Il default kind="package" di listPackages non basta più: senza il secondo
  // fetch il blocco SERVIZI non viene mai emesso e Ambrosio «non sa» di
  // saperli vendere. Le FAQ addestrative sono la conoscenza ufficiale: se c'è
  // una risposta preparata, quella vince. Fase 3: con lingua non-italiana il
  // blocco usa le traduzioni approvate.
  const [packages, services] = await Promise.all([listPackages(true, "package"), listPackages(true, "service")]);
  const catalog = [...packages, ...services];
  const faqs = await getAiFaqs();
  // AUTONOMIA (3 livelli): la regola operativa del livello attivo, il blocco
  // take-over SLA (solo L3 con switch attivo) e i documenti interni
  // (citrabili solo a L3) entrano nel prompt accanto a FAQ e pacchetti.
  const { levelBlock, takeoverBlock, config: auto } = await autonomyPromptParts();
  const docsBlock = await documentsPromptBlock(auto.level, opts?.lang ?? "it");
  // FASE 1 Ambrosio: le funzioni in whitelist entrano nel prompt di sistema;
  // la risposta può contenere UN blocco <tool>{...}</tool> che viene validato
  // ed eseguito dalla route (mai bloccante, audit su ogni azione).
  const system =
    settings.systemPrompt +
    faqsPromptBlock(faqs, opts?.lang ?? "it") +
    (catalog.length ? packagesPromptBlock(catalog) : "") +
    docsBlock +
    levelBlock +
    takeoverBlock +
    TOOLS_PROMPT_BLOCK;

  const base = { system, turns: turns.slice(-12), temperature: settings.temperature };
  const fallbacksTried: AiProvider[] = [];
  const startedAt = Date.now();

  for (const cred of chain) {
    try {
      const reply = await callProvider(cred, base);
      if (reply) {
        // FASE 1: separa l'eventuale azione (blocco <tool>) dal testo per il
        // cliente; il tracking FAQ usa il testo pulito, non il blocco JSON.
        const { clean, call, calls } = parseToolCall(reply);
        if (opts?.track !== false) await trackFaqUsage(clean || reply, conversationId);
        // Osservabilità (migration 029): CHI ha risposto e chi ha fallito prima.
        await logProviderUse({
          conversationId: conversationId ?? null,
          usedProvider: cred.provider,
          fallbacksTried,
          usedModel: cred.model,
          latencyMs: Date.now() - startedAt,
        });
        // Tutto il messaggio era azione (zero testo visibile): al cliente va
        // una conferma onesta, MAI il JSON del tool (difetto visto sul vivo).
        const visible =
          clean ||
          (calls.length ? "Fatto! Ho registrato tutto per il team: nel richiamo avrai conferme su prezzi e tempi." : reply);
        return { reply: visible, cleanReply: clean, toolCall: call, toolCalls: calls, usedProvider: cred.provider, fallbacksTried };
      }
      // risposta vuota: considera il provider fallito e prova il prossimo
      fallbacksTried.push(cred.provider);
    } catch (e) {
      console.error(`[ambrosio] provider ${cred.provider} fallito:`, e instanceof Error ? e.message : e);
      fallbacksTried.push(cred.provider);
    }
  }
  throw new AiNotConfiguredError("nessun_provider_disponibile");
}

/* ── Log uso provider (migration 029): chi risponde davvero ───── */

/**
 * Registra ogni risposta di Ambrosio: provider usato, catena dei fallback
 * provati prima, modello, latenza. Best-effort: un errore qui non deve mai
 * rompere la chat (stessa filosofia di trackFaqUsage).
 */
async function logProviderUse(entry: {
  conversationId: string | null;
  usedProvider: AiProvider;
  fallbacksTried: AiProvider[];
  usedModel: string;
  latencyMs: number;
}): Promise<void> {
  const pool = db();
  if (!pool) return;
  try {
    await pool.query(
      `insert into ai_provider_log (conversation_id, used_provider, fallbacks_tried, used_model, latency_ms)
       values ($1, $2, $3::jsonb, $4, $5)`,
      [entry.conversationId, entry.usedProvider, JSON.stringify(entry.fallbacksTried), entry.usedModel.slice(0, 120), Math.min(entry.latencyMs, 2_000_000)],
    );
  } catch (e) {
    console.error("[logProviderUse]", e); // la tabella può non esistere ancora: la chat continua
  }
}

export interface ProviderUsageStat {
  provider: AiProvider;
  /** Risposte date negli ultimi N giorni */
  uses: number;
  /** Quota sul totale delle risposte (%) */
  pct: number;
  /** Risposte date DOPO almeno un fallback (il primario era giù) */
  fallbackUses: number;
  /** Latenza media delle risposte (ms), null se nessun dato */
  avgLatencyMs: number | null;
  lastUsedAt: string | null;
}

/** Ripartizione delle risposte per provider (ultimi N giorni). */
export async function getProviderUsageStats(days = 30): Promise<ProviderUsageStat[]> {
  const pool = db();
  if (!pool) return [];
  try {
    const { rows } = await pool.query<{
      used_provider: string;
      uses: string;
      pct: string | null;
      fallback_uses: string;
      avg_latency: string | null;
      last_used: string | null;
    }>(
      `select used_provider,
              count(*)::text as uses,
              round(100.0 * count(*) / nullif(sum(count(*)) over (), 0))::text as pct,
              count(*) filter (where jsonb_array_length(fallbacks_tried) > 0)::text as fallback_uses,
              avg(latency_ms)::int::text as avg_latency,
              max(created_at) as last_used
       from ai_provider_log
       where created_at > now() - ($1 || ' days')::interval
       group by used_provider
       order by count(*) desc`,
      [String(days)],
    );
    return rows.map((r) => ({
      provider: r.used_provider as AiProvider,
      uses: Number(r.uses),
      pct: Number(r.pct ?? 0),
      fallbackUses: Number(r.fallback_uses),
      avgLatencyMs: r.avg_latency === null ? null : Number(r.avg_latency),
      lastUsedAt: r.last_used,
    }));
  } catch {
    return []; // tabella non ancora migrata
  }
}

/* ── Cronometro di latenza (ultime 24 ore) ──────────────────────── */

/**
 * Media e p95 delle risposte di Ambrosio delle ULTIME 24 ORE, dal log dei
 * provider (migration 029: ogni risposta registra latency_ms). Il p95 è la
 * metrica che conta: la media non vede l'outlier, il p95 lo rende visibile —
 * ed è il cliente vero ad averla aspettata. Fonte: lib/latency-shared.ts
 * (regole pure testate), qui solo la lettura DB che degredisce da sola.
 */
export async function getLatencyStats24h(): Promise<LatencyStats> {
  const pool = db();
  if (!pool) return EMPTY_LATENCY;
  try {
    const { rows } = await pool.query<{ latency_ms: number }>(
      `select latency_ms from ai_provider_log
       where created_at > now() - interval '24 hours'
         and latency_ms is not null`,
    );
    return latencyStats(rows.map((r) => r.latency_ms));
  } catch {
    return EMPTY_LATENCY; // tabella non ancora migrata: nessun dato, nessun errore
  }
}

export interface ProviderLogRow {
  usedProvider: AiProvider;
  fallbacks: AiProvider[];
  model: string | null;
  latencyMs: number | null;
  conversationId: string | null;
  createdAt: string;
}

/** Le risposte più recenti, con la catena dei fallback percorsa. */
export async function getRecentProviderLogs(limit = 12): Promise<ProviderLogRow[]> {
  const pool = db();
  if (!pool) return [];
  try {
    const { rows } = await pool.query<{
      used_provider: string;
      fallbacks_tried: string[];
      used_model: string | null;
      latency_ms: number | null;
      conversation_id: string | null;
      created_at: string;
    }>(
      "select used_provider, fallbacks_tried, used_model, latency_ms, conversation_id, created_at from ai_provider_log order by created_at desc limit $1",
      [limit],
    );
    return rows.map((r) => ({
      usedProvider: r.used_provider as AiProvider,
      fallbacks: Array.isArray(r.fallbacks_tried) ? (r.fallbacks_tried as AiProvider[]) : [],
      model: r.used_model,
      latencyMs: r.latency_ms,
      conversationId: r.conversation_id,
      createdAt: r.created_at,
    }));
  } catch {
    return []; // tabella non ancora migrata
  }
}
