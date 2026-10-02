import { revalidatePath } from "next/cache";
import { CACHE_TARGETS, type CacheTargetId, type LastPurge } from "@/lib/cache-shared";
import { db } from "@/lib/db";

/**
 * FREE CACHE (Tools → Free cache) — ESECUZIONE SERVER (unica nel repo).
 *
 * La logica decisionale sta tutta in cache-shared.ts (pura, testata); questo
 * modulo è il coltello: requireAdmin → revalidatePath scelti → redirect con
 * esito leggibile. Le chiamate sono qui e solo qui perché il gesto è
 * delicato: una purga sopraezza la Data Cache delle pagine toccate (la
 * richiesta successiva per ognuna ricompila) e va usata sotto conferma
 * esplicita. Il "layout" è il gesto largo (tutto il sito); i target singoli
 * toccano il minimo indispensabile.
 *
 * Fail-safe: nessun throw — l'esito torna alla pagina via query param e
 * finisce in audit chi ha fatto cosa.
 */

/**
 * Purga i target scelti. true = tutte le invalidazioni richieste a Next con
 * successo. I path dei target singoli vivono QUI (mappa esplicita, mai dal
 * form): il form esprime una scelta tra target del catalogo, non un percorso.
 */
export async function purgeSiteCache(targets: CacheTargetId[]): Promise<boolean> {
  try {
    for (const id of targets) {
      if (id === "layout") {
        // "layout": invalida tutti i segmenti sotto il root layout — sito
        // pubblico E admin (fonte: seo config, tema, hero su content_settings).
        revalidatePath("/", "layout");
        continue;
      }
      if (id === "home") {
        // Home ISR (revalidate 300): page-level basta, il layout resta valido.
        revalidatePath("/");
        continue;
      }
      if (id === "landing") {
        // Landing SEO: gli slug dinamici non sono enumerabili a runtime senza
        // leggere il DB — il layout-level copre esattamente questo caso.
        revalidatePath("/", "layout");
        continue;
      }
      if (id === "admin") {
        // Admin: force-dynamic NON ha cache di pagina, ma il layout admin
        // rilegge content_settings (tema, hero, seo) e le nav/cache RSC.
        revalidatePath("/admin", "layout");
        continue;
      }
      // Target non gestito: il catalogo è l'unica fonte — mai un default largo.
    }
    return true;
  } catch (e) {
    console.error("[cache] purge fallito:", e);
    return false;
  }
}

/** Etichetta leggibile di un target (per audit, in alternativa a shared). */
export function targetLabel(id: CacheTargetId): string {
  return CACHE_TARGETS.find((t) => t.id === id)?.label ?? id;
}

/* ── Lettura dell'ultima purga (per l'età della cache in scheda) ── */

/**
 * L'ultima purga dall'audit (fonte delle statistiche del progetto): created_at
 * e target dell'evento `cache.purga` più recente. I target arrivano come
 * lista di etichette (", "-joined) — qui si torna agli id CONOSCUTI del
 * catalogo, scartando il resto. Degradazione: senza DB o audit non migrato
 * ritorna null (l'UI mostra «mai purgata», non un errore).
 */
export async function readLastPurge(): Promise<LastPurge | null> {
  const pool = db();
  if (!pool) return null;
  try {
    const { rows } = await pool.query<{ action: string; target: string | null; created_at: string }>(
      `select action, target, created_at from audit_log
       where action in ('cache.purga', 'cache.purga.errore')
       order by created_at desc
       limit 1`,
    );
    const row = rows[0];
    if (!row) return null;
    // L'action registra le ETICHETTE in target: si risale agli id per inversa.
    const labelToId = new Map(CACHE_TARGETS.map((t) => [t.label, t.id] as const));
    const ids = (row.target ?? "")
      .split(",")
      .map((part) => labelToId.get(part.trim()))
      .filter((id): id is CacheTargetId => Boolean(id));
    return { at: row.created_at, targets: ids };
  } catch {
    // audit non ancora migrato / DB assente: nessuna informazione, non un 500.
    return null;
  }
}
