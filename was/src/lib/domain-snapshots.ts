/**
 * AGGIORNAMENTI PER DOMINIO — server-only (decisione 2026-10-01,
 * docs/DECISIONE-UPDATES-BACKUP-2026-10-01.md §9, fasi 1–2).
 *
 * Gli snapshot vivono in content_settings (chiave `dominio_snapshot_<dominio>`),
 * stesso pattern di seo-backups.ts: niente migration, righe on-demand, JSON
 * canonico con sha256 per il dedup. Il ripristino scrive SOLO le superfici del
 * dominio e MAI i segreti: la chiave API di Ambrosio non entra nemmeno negli
 * snapshot, i token del calendario restano fuori dall'export per il gemello.
 *
 * FASE 2 — import dall'export «per gemello»: anteprima con diff (stashata in
 * content_settings, chiave `dominio_import_pending`), conferma in un secondo
 * gesto con snapshot pre-import AUTOMATICO come rete di rollback. Solo la
 * conferma scrive: l'anteprima è lettura.
 *
 * FASE 3 — etichette di release: un nome raggruppa gli snapshot CORRENTI
 * di tutti i domini attivi in un punto nominato (content_settings, chiave
 * `dominio_releases`), con ripristino coordinato a quell'etichetta.
 */
import { db } from "./db";
import { createHash } from "node:crypto";
import {
  DOMINI,
  diffDominio,
  filtraPerGemello,
  jsonCanonico,
  labelDominio,
  mergiaImport,
  sanitizeEntries,
  sanitizeReleases,
  validaExport,
  validaNomeRelease,
  RELEASE_MAX,
  SNAPSHOT_MAX,
  type DominioId,
  type ExportValido,
  type ReleaseLabel,
  type RigaDiff,
  type SnapshotEntry,
} from "./domain-snapshots-shared";
import { getSiteTheme } from "./theme";
import { getHeroConfig } from "./hero";
import { getAiSettings, getAiFaqs } from "./ai";
import { HUB_CONFIG_KEY } from "./calendar-hub-shared";

/** Il payload COMPLETO di un dominio (come persistito nello snapshot). */
export type DominioPayload = Record<string, unknown>;

/** Chiave content_settings dell'import in sospeso (uno alla volta). */
export const IMPORT_PENDING_KEY = "dominio_import_pending";

/** Chiave content_settings delle etichette di release (FASE 3). */
export const RELEASES_KEY = "dominio_releases";

export interface ImportPending {
  dominio: DominioId;
  generato: string;
  /** sha256 del payload in arrivo: la conferma deve combaciare (no TOCTOU). */
  sha256: string;
  creatoDa: string;
  creatoAt: string;
  /** Le righe del diff calcolate al momento dell'anteprima (qui, per il confirm). */
  righe: RigaDiff[];
  /** Il payload mergiato che verrà applicato (l'unica cosa che la conferma scrive). */
  applicato: Record<string, unknown>;
}

/* ── Raccolta: lo stato CORRENTE di ogni dominio ── */

export async function raccogliDominio(id: DominioId): Promise<DominioPayload> {
  const pool = db();
  if (!pool) return {};
  switch (id) {
    case "temi":
      return { site_theme: await getSiteTheme() };
    case "hero":
      return { site_hero: await getHeroConfig() };
    case "ambrosio": {
      const s = (await getAiSettings()) as Record<string, unknown> | null;
      const faqs = await getAiFaqs();
      if (!s) return { ai_settings: null, ai_faqs: faqs };
      // MAI la chiave API negli snapshot (haKey è solo un flag: non serve).
      const { hasKey: _hasKey, ...senzaFlag } = s;
      return { ai_settings: senzaFlag, ai_faqs: faqs };
    }
    case "tools": {
      const { rows } = await pool.query<{ value: unknown }>(
        "select value from content_settings where key = $1",
        [HUB_CONFIG_KEY],
      );
      return { calendar_hub: rows[0]?.value ?? null };
    }
    case "settings": {
      const { rows } = await pool.query<{ key: string; value: unknown }>(
        `select key, value from content_settings
         where key in ('ticket_quick_replies','ticket_sla_policy','chat_emoji_picker',
                       'ticket_autoclose_days','lead_followup_hours',
                       'backup_reminder_days','maintenance_mode')`,
      );
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    }
    default:
      return {}; // ticketing: stub — si attiva con la feature
  }
}

/* ── Scrittura fattorizzata: ripristino e import passano da qui ── */

export async function scriviDominio(id: DominioId, payload: Record<string, unknown>): Promise<void> {
  const pool = db();
  if (!pool) throw new Error("database non configurato");
  const scriviChiave = (key: string, value: unknown) =>
    pool.query(
      `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
       on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  switch (id) {
    case "temi": {
      const t = payload.site_theme;
      if (t && typeof t === "object") await scriviChiave("site_theme", t);
      return;
    }
    case "hero": {
      const h = payload.site_hero;
      if (h && typeof h === "object") await scriviChiave("site_hero", h);
      return;
    }
    case "ambrosio": {
      // Solo comportamento/prompt: provider, model, temperature, base_url,
      // enabled, system_prompt. La chiave API resta quella corrente.
      const s = payload.ai_settings as Record<string, unknown> | undefined;
      if (s && typeof s === "object") {
        await pool.query(
          `update ai_settings set
             enabled = $1, provider = $2, model = $3, base_url = $4,
             system_prompt = $5, temperature = $6, updated_at = now()
           where id = 1`,
          [
            s.enabled === true,
            typeof s.provider === "string" ? s.provider : "anthropic",
            typeof s.model === "string" ? s.model : null,
            typeof s.base_url === "string" ? s.base_url : null,
            typeof s.system_prompt === "string" ? s.system_prompt : null,
            typeof s.temperature === "string" || typeof s.temperature === "number" ? s.temperature : "0.4",
          ],
        );
      }
      const faqs = Array.isArray(payload.ai_faqs) ? (payload.ai_faqs as Array<Record<string, unknown>>) : null;
      if (faqs) {
        await pool.query("delete from ai_faqs");
        for (const f of faqs) {
          await pool.query(
            `insert into ai_faqs (question, answer, priority, active, created_at, updated_at)
             values ($1, $2, $3, $4, now(), now())`,
            [
              typeof f.question === "string" ? f.question : "",
              typeof f.answer === "string" ? f.answer : "",
              Number.isFinite(Number(f.priority)) ? Number(f.priority) : 50,
              f.active !== false,
            ],
          );
        }
      }
      return;
    }
    case "tools": {
      const hub = payload.calendar_hub;
      if (hub && typeof hub === "object") await scriviChiave(HUB_CONFIG_KEY, hub);
      return;
    }
    case "settings": {
      for (const [k, v] of Object.entries(payload)) await scriviChiave(k, v);
      return;
    }
    default:
      throw new Error("dominio non attivo (stub)");
  }
}

/* ── Storico: elenco, salvataggio con dedup, ripristino ── */

export async function listSnapshots(id: DominioId): Promise<SnapshotEntry[]> {
  const pool = db();
  if (!pool) return [];
  try {
    const { rows } = await pool.query<{ value: unknown }>(
      "select value from content_settings where key = $1",
      [`dominio_snapshot_${id}`],
    );
    return sanitizeEntries(rows[0]?.value);
  } catch {
    return [];
  }
}

/** Salva uno snapshot dello stato CORRENTE (dedup: identico all'ultimo → no-op). */
export async function salvaSnapshot(
  id: DominioId,
  takenBy: string,
  nota = "",
): Promise<{ ok: boolean; duplicato: boolean; motivo?: string }> {
  const pool = db();
  if (!pool) return { ok: false, duplicato: false, motivo: "database non configurato" };
  try {
    const data = await raccogliDominio(id);
    const sha = createHash("sha256").update(jsonCanonico(data)).digest("hex");
    const attuale = await listSnapshots(id);
    if (attuale[0]?.sha256 === sha) return { ok: true, duplicato: true };
    const entry: SnapshotEntry = {
      takenAt: new Date().toISOString(),
      takenBy,
      nota: nota.slice(0, 200),
      sha256: sha,
      data,
    };
    const prossimo = [entry, ...attuale].slice(0, SNAPSHOT_MAX);
    await pool.query(
      `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
       on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
      [`dominio_snapshot_${id}`, JSON.stringify(prossimo)],
    );
    return { ok: true, duplicato: false };
  } catch (e) {
    return { ok: false, duplicato: false, motivo: e instanceof Error ? e.message : "errore" };
  }
}

/** Ripristina il dominio allo snapshot scelto. Ritorna "" se ok, altrimenti il motivo. */
export async function ripristinaSnapshot(id: DominioId, takenAt: string): Promise<string> {
  const storico = await listSnapshots(id);
  const snap = storico.find((s) => s.takenAt === takenAt);
  if (!snap) return "snapshot non trovato";
  const d = (snap.data ?? {}) as Record<string, unknown>;
  try {
    await scriviDominio(id, d);
  } catch (e) {
    return e instanceof Error ? e.message : "errore di ripristino";
  }
  return "";
}

/** L'export JSON di un dominio: completo (locale) o con whitelist (gemello). */
export async function exportDominio(id: DominioId, perGemello: boolean): Promise<string> {
  const data = await raccogliDominio(id);
  const payload = {
    strumento: "aggiornamenti-per-dominio",
    dominio: id,
    per: perGemello ? "gemello" : "locale",
    generato: new Date().toISOString(),
    data: perGemello ? filtraPerGemello(id, data) : data,
  };
  return JSON.stringify(payload, null, 2) + "\n";
}

/* ── FASE 2: import con anteprima e conferma ── */

async function leggiPending(pool: NonNullable<ReturnType<typeof db>>): Promise<ImportPending | null> {
  const { rows } = await pool.query<{ value: unknown }>(
    "select value from content_settings where key = $1",
    [IMPORT_PENDING_KEY],
  );
  const v = rows[0]?.value as Partial<ImportPending> | undefined;
  if (!v || !v.dominio || !v.sha256 || !v.applicato || !Array.isArray(v.righe)) return null;
  return v as ImportPending;
}

/**
 * ANTEPRIMA: valida il file, calcola il diff attuale → in arrivo e il payload
 * mergiato, e stasha tutto su content_settings. NON scrive il dominio: la
 * scrittura avviene solo alla conferma (stesso sha → no TOCTOU).
 */
export async function anteprimaImport(
  raw: string,
  creatoDa: string,
): Promise<{ ok: true; pending: ImportPending } | { ok: false; errore: string }> {
  const pool = db();
  if (!pool) return { ok: false, errore: "database non configurato" };
  const v = validaExport(raw);
  if (!v.ok) return { ok: false, errore: v.errore };
  const exp: ExportValido = v.valore;
  const attuale = await raccogliDominio(exp.dominio);
  const applicato = mergiaImport(exp.dominio, attuale, exp.data);
  const diffRighe = diffDominio(attuale, exp.data);
  const pending: ImportPending = {
    dominio: exp.dominio,
    generato: exp.generato,
    sha256: createHash("sha256").update(jsonCanonico(exp.data)).digest("hex"),
    creatoDa,
    creatoAt: new Date().toISOString(),
    righe: diffRighe,
    applicato,
  };
  await pool.query(
    `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [IMPORT_PENDING_KEY, JSON.stringify(pending)],
  );
  return { ok: true, pending };
}

/** Legge l'import in sospeso (per il pannello). */
export async function leggiImportPending(): Promise<ImportPending | null> {
  const pool = db();
  if (!pool) return null;
  try {
    return await leggiPending(pool);
  } catch {
    return null;
  }
}

/** Scarta l'anteprima senza scrivere nulla. */
export async function scartaImport(): Promise<void> {
  const pool = db();
  if (!pool) return;
  await pool.query("delete from content_settings where key = $1", [IMPORT_PENDING_KEY]);
}

/**
 * CONFERMA: snapshot pre-import AUTOMATICO (rete di rollback), poi scrive il
 * payload mergiato dell'anteprima. Lo sha deve combaciare con quello
 * stazzato: se il file è cambiato nel frattempo, l'anteprima va rifatta.
 */
export async function confermaImport(sha256: string, takenBy: string): Promise<{ ok: boolean; motivo?: string }> {
  const pool = db();
  if (!pool) return { ok: false, motivo: "database non configurato" };
  const pending = await leggiPending(pool).catch(() => null);
  if (!pending) return { ok: false, motivo: "nessun import in sospeso: rifai l'anteprima" };
  if (pending.sha256 !== sha256) return { ok: false, motivo: "il file è cambiato dopo l'anteprima: rifai l'import" };
  const pre = await salvaSnapshot(pending.dominio, takenBy, `pre-import ${pending.generato}`);
  if (!pre.ok) return { ok: false, motivo: `snapshot pre-import fallito: ${pre.motivo ?? "?"}` };
  try {
    await scriviDominio(pending.dominio, pending.applicato);
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : "errore di scrittura" };
  }
  await pool.query("delete from content_settings where key = $1", [IMPORT_PENDING_KEY]);
  return { ok: true };
}

/* ── FASE 3: etichette di release ── */

/** Elenco delle etichette di release (la più recente in testa). */
export async function listReleaseLabels(): Promise<ReleaseLabel[]> {
  const pool = db();
  if (!pool) return [];
  try {
    const { rows } = await pool.query<{ value: unknown }>(
      "select value from content_settings where key = $1",
      [RELEASES_KEY],
    );
    return sanitizeReleases(rows[0]?.value);
  } catch {
    return [];
  }
}

/**
 * Crea un'etichetta di release: congela gli snapshot CORRENTI
 * di tutti i domini attivi (dedup: invariato → nessun duplicato)
 * e li raggruppa sotto il nome scelto. Se un dominio non salva,
 * l'etichetta non nasce: niente punti parziali.
 */
export async function creaReleaseLabel(
  nome: string,
  nota: string,
  takenBy: string,
): Promise<{ ok: boolean; motivo?: string; nDomini?: number }> {
  const pool = db();
  if (!pool) return { ok: false, motivo: "database non configurato" };
  const errore = validaNomeRelease(nome);
  if (errore) return { ok: false, motivo: `nome non valido: ${errore}` };
  const nomePulito = nome.trim();
  const attuali = await listReleaseLabels();
  if (attuali.some((r) => r.nome === nomePulito)) {
    return { ok: false, motivo: `esiste già un'etichetta «${nomePulito}»` };
  }
  const punti: Record<string, string> = {};
  const attivi = DOMINI.filter((d) => d.attivo);
  for (const d of attivi) {
    const salvo = await salvaSnapshot(d.id, takenBy, `release ${nomePulito}`);
    if (!salvo.ok) {
      return { ok: false, motivo: `snapshot ${labelDominio(d.id)} fallito: ${salvo.motivo ?? "?"}` };
    }
    const testa = (await listSnapshots(d.id))[0];
    if (!testa) {
      return { ok: false, motivo: `impossibile leggere lo snapshot di ${labelDominio(d.id)}` };
    }
    punti[d.id] = testa.takenAt;
  }
  const label: ReleaseLabel = {
    nome: nomePulito,
    creataAt: new Date().toISOString(),
    creataDa: takenBy,
    nota: nota.slice(0, 200),
    punti,
  };
  try {
    await pool.query(
      `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
       on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
      [RELEASES_KEY, JSON.stringify([label, ...attuali].slice(0, RELEASE_MAX))],
    );
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : "errore" };
  }
  return { ok: true, nDomini: attivi.length };
}

/**
 * Ripristino COORDINATO a un'etichetta: ogni dominio torna allo
 * snapshot che l'etichetta congela. Un punto caduto oltre
 * SNAPSHOT_MAX è saltato e segnalato, non blocca gli altri.
 */
export async function ripristinaReleaseLabel(
  nome: string,
): Promise<{ ok: boolean; motivo?: string; ripristinati: string[]; saltati: string[] }> {
  const nomePulito = nome.trim();
  const label = (await listReleaseLabels()).find((r) => r.nome === nomePulito);
  if (!label) {
    return { ok: false, motivo: `etichetta «${nomePulito}» non trovata`, ripristinati: [], saltati: [] };
  }
  const ripristinati: string[] = [];
  const saltati: string[] = [];
  for (const d of DOMINI.filter((x) => x.attivo)) {
    const takenAt = label.punti[d.id];
    if (!takenAt) {
      saltati.push(`${labelDominio(d.id)} (punto assente)`);
      continue;
    }
    const motivo = await ripristinaSnapshot(d.id, takenAt);
    if (motivo) {
      if (motivo === "snapshot non trovato") {
        saltati.push(`${labelDominio(d.id)} (snapshot scaduto)`);
        continue;
      }
      return { ok: false, motivo: `${labelDominio(d.id)}: ${motivo}`, ripristinati, saltati };
    }
    ripristinati.push(labelDominio(d.id));
  }
  return { ok: true, ripristinati, saltati };
}
