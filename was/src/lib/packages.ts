import { db } from "./db";
import {
  type CatalogKind,
  type PackageRow,
  normalizeKind,
  packagesPromptBlock,
} from "./packages-shared";

/**
 * Pacchetti e SERVIZI commerciali: definiti in /admin/packages, proposti da
 * Ambrosio in chat (iniezione nel prompt) e pronti per le card del sito.
 *
 * Due cataloghi sulla stessa tabella (colonna `kind`, migration 035):
 *  - kind = 'package' → pacchetti sito, listino dei preventivi;
 *  - kind = 'service' → servizi professionali (fotografo, video, assistenza…):
 *    Ambrosio li propone quando il cliente cerca un'attività da eseguire,
 *    mentre i pacchetti restano la risposta quando valuta un preventivo sito.
 * Stessi campi commerciali: name, tagline, price_text, includes — così tutto
 * l'ecosistema (Notion «Servizio», gcal, notify, proposte L3) eredita gratis.
 *
 * Le parti pure (tipi, normalizeKind, blocco prompt) vivono in packages-shared,
 * importabile anche dai test Node senza il layer pg — stessa disciplina di
 * ab-shared e hero-shared.
 */

export type { CatalogKind, PackageRow };
export { normalizeKind, packagesPromptBlock };

/** Il default protegge le righe vecchie (e i fallback se la colonna manca). */
const PACKAGE_COLUMNS = `id, name, tagline, price_text, includes, sort_order, active, coalesce(kind, 'package') as kind`;

export async function listPackages(onlyActive = false, kind: CatalogKind = "package"): Promise<PackageRow[]> {
  const pool = db();
  if (!pool) return [];
  try {
    const { rows } = await pool.query<PackageRow>(
      `select ${PACKAGE_COLUMNS}
       from packages
       ${onlyActive ? "where active" : ""}
       ${onlyActive ? "and" : "where"} coalesce(kind, 'package') = $1
       order by sort_order, created_at`,
      [kind],
    );
    return rows.map((r) => ({ ...r, kind: normalizeKind(r.kind) }));
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return [];
    // Colonna kind non ancora applicata (prima installazione): degrada a pacchetti.
    const { rows } = await pool.query<PackageRow>(
      `select id, name, tagline, price_text, includes, sort_order, active, 'package' as kind
       from packages ${onlyActive ? "where active" : ""} order by sort_order, created_at`,
    );
    return rows.map((r) => ({ ...r, kind: normalizeKind(r.kind) }));
  }
}

/** Solo i servizi professionali (catalogo kind='service'). */
export async function listServices(onlyActive = false): Promise<PackageRow[]> {
  return listPackages(onlyActive, "service");
}
