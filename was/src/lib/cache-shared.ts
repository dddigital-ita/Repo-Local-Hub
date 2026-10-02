/**
 * FREE CACHE (Tools → Free cache) — LAYER PURO.
 *
 * Il tool svuota la Data Cache di Next con revalidatePath mirati: TUTTO il
 * sito (layout completo) oppure SOLO le aree che servono — home, landing SEO,
 * admin. Da qui il nome: liberare la cache rende immediatamente visibile
 * ogni contenuto appena cambiato. Il purging PAGA in velocità percepita (il
 * primo visitatore di ogni pagina toccata ricompila la pagina): per questo
 * l'azione è esplicita, con conferma, e tracciata in audit — non un bottone
 * da premere per noia.
 *
 * NESSUNA dipendenza runtime: importabile da node --test, dal client e dal
 * server senza trascinare pg (stessa disciplina di maintenance-shared.ts).
 * Le decisioni vivono qui e sono testate; il server esegue solo.
 */

/** Solo richieste GET/HEAD sono cacheabili: qui non c'è nulla da purgare. */
const CACHEABLE_METHODS = new Set(["GET", "HEAD"]);

/** La richiesta usa la cache? (esposto per diagnostica futura). */
export function isCacheableMethod(method: string): boolean {
  return CACHEABLE_METHODS.has(method.toUpperCase());
}

/**
 * Sanifica il motivo libero inserito dall'admin (finisce in audit, log
 * append-only): trim, cap a 200 caratteri, controllo tipi stretto. Mai un
 * input non validato nel registro.
 */
export function sanitizeCacheReason(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 200);
}

/** Target di purga. Aggiungi qui → la UI, l'action e i test lo seguono da soli. */
export type CacheTargetId = "layout" | "home" | "landing" | "admin";

export type CacheTarget = {
  id: CacheTargetId;
  label: string;
  /** Cosa copre, in linguaggio admin (finisce nella UI). */
  description: string;
  /** Impatto onesto: quante pagine ricompilano al primo accesso. */
  cost: "pesante" | "contenuto" | "trascurabile";
};

export const CACHE_TARGETS: CacheTarget[] = [
  {
    id: "layout",
    label: "Tutto il sito",
    description:
      "Invalida la cache di ogni pagina (home, landing, policy, consulenza e admin): il contenuto appena pubblicato diventa visibile subito ovunque.",
    cost: "pesante",
  },
  {
    id: "home",
    label: "Solo la home",
    description:
      "Invalida «/»: hero, tema, listino pacchetti e testi SEO della prima pagina tornano freschi. Il resto del sito non ricompila.",
    cost: "contenuto",
  },
  {
    id: "landing",
    label: "Solo le landing SEO",
    description:
      "Invalida le pagine degli slug (/consulenza e landing personalizzate): meta, contenuti e JSON-LD si rileggono dal vivo.",
    cost: "contenuto",
  },
  {
    id: "admin",
    label: "Solo l'admin",
    description:
      "Invalida i percorsi /admin: utile dopo un restore o un import manuale per rileggere configurazioni e dashboard. Il sito pubblico resta com'è.",
    cost: "trascurabile",
  },
];

/** Ids validi (fonte unica: deriva dal catalogo, non una lista parallela). */
const TARGET_IDS = new Set<string>(CACHE_TARGETS.map((t) => t.id));

/**
 * Legge i target selezionati dal form in modo TIPO-SICURO: solo gli id del
 * catalogo possono passare, ogni altro valore del form è scartato. Un
 * attore non può chiedere path arbitrari: il form esprime una SCELTA tra
 * target noti, non un percorso libero.
 */
export function selectedTargets(formData: FormData): CacheTargetId[] {
  const chosen: CacheTargetId[] = [];
  for (const t of CACHE_TARGETS) {
    if (String(formData.get(t.id) ?? "") === "1") chosen.push(t.id);
  }
  return chosen;
}

/**
 * true se il form conferma ESPLICITAMENTE tutti i target richiesti (gate
 * della conferma a due fasi: la fase due invia il flag «1» per ogni target
 * scelto; manca anche uno solo = conferma incompleta = nessun gesto).
 */
export function wantsTarget(formData: FormData, ids: CacheTargetId[]): boolean {
  return ids.every((id) => TARGET_IDS.has(id) && String(formData.get(id) ?? "") === "1");
}

/** Etichette dei target scelti, per audit e messaggi di esito. */
export function targetLabels(ids: CacheTargetId[]): string {
  const byId = new Map(CACHE_TARGETS.map((t) => [t.id, t.label]));
  return ids.map((id) => byId.get(id) ?? id).join(", ");
}

/* ── Età della cache: quando l'ultima purga, quanto gira senza ──── */

/**
 * Cosa è successo nell'ultima purga, così come vive nell'audit. `at` è il
 * created_at dell'evento `cache.purga` più recente (ISO string dal driver);
 * `targets` sono gli id registrati in target (es. "layout" o "home, admin").
 * Le date del DB sono storie passate: qui si ricompongono senza fiducia.
 */
export type LastPurge = {
  /** created_at ISO dell'evento; null se l'audit è vuoto o non raggiungibile. */
  at: string | null;
  /** Id dei target purgati, filtrati sul catalogo. */
  targets: CacheTargetId[];
};

const DAY_MS = 86_400_000;

/**
 * L'età della cache: da quanti GIORNI INTERI gira senza invalidazioni e
 * come dirlo in italiano. Regole:
 * - mai purgata o data malformata → null (l'UI mostrerà «mai purgata»);
 * - data nel FUTURO (orologio spostato, timezone) → null, mai un numero
 *   negativo in scheda;
 * - purga di oggi → «oggi»; ieri → «ieri»; poi «N giorni».
 * `now` iniettabile per test deterministici (stessa disciplina di
 * backupStatus in tools-status.ts).
 */
export function cacheAgeInfo(
  last: LastPurge | null,
  now: number = Date.now(),
): { days: number; label: string } | null {
  if (!last?.at) return null;
  const at = Date.parse(last.at);
  if (!Number.isFinite(at)) return null;
  const elapsed = now - at;
  if (elapsed < 0) return null; // purga "nel futuro": dato non attendibile
  const days = Math.floor(elapsed / DAY_MS);
  const label =
    days === 0 ? "oggi" : days === 1 ? "ieri" : `${days} giorni`;
  return { days, label };
}
