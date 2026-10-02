/**
 * Catalogo pacchetti/servizi: le parti PURE (tipi e prompt di Ambrosio),
 * separata dal layer DB così che i test e chi non tocca il database le
 * importi direttamente (stessa disciplina di ab-shared/hero-shared).
 *
 * Due cataloghi sulla stessa tabella `packages` (colonna `kind`, migration 035):
 *  - kind = 'package' → pacchetti sito, listino dei preventivi;
 *  - kind = 'service' → servizi professionali (fotografo, video, assistenza…):
 *    Ambrosio li propone quando il cliente cerca un'attività da eseguire,
 *    mentre i pacchetti restano la risposta quando valuta un preventivo sito.
 */

export type CatalogKind = "package" | "service";

export interface PackageRow {
  id: string;
  name: string;
  tagline: string | null;
  price_text: string;
  includes: string[] | null;
  sort_order: number;
  active: boolean;
  /** Catalogo d'appartenenza (default 'package': le righe storiche restano tali). */
  kind: CatalogKind;
}

/** Il default protegge le righe vecchie e i fallback se la colonna manca. */
export function normalizeKind(raw: unknown): CatalogKind {
  return raw === "service" ? "service" : "package";
}

function rowLine(p: PackageRow): string {
  const inc = p.includes?.length ? ` (include: ${p.includes.join(", ")})` : "";
  return `- ${p.name} — ${p.price_text}${inc}${p.tagline ? `. ${p.tagline}` : ""}`;
}

/** Blocco testuale iniettato nel prompt di sistema di Ambrosio: due sezioni
 *  con la STESSA struttura, ma la regola d'uso distingue quando proporsi. */
export function packagesPromptBlock(rows: PackageRow[]): string {
  if (!rows.length) return "";
  const packages = rows.filter((r) => normalizeKind(r.kind) === "package");
  const services = rows.filter((r) => normalizeKind(r.kind) === "service");

  const lines: string[] = [];
  if (packages.length) {
    lines.push(
      "PACCHETTI DA PROPORRE (aggiornati dall'agenzia; proponili quando il cliente valuta un preventivo sito, uno o due al massimo, adatti al bisogno espresso; cita il NOME ESATTO del pacchetto e il suo prezzo, senza inventare cifre):",
    );
    for (const p of packages) lines.push(rowLine(p));
  }
  if (services.length) {
    lines.push(
      "SERVIZI DA PROPORRE (attività professionali eseguite dall'agenzia o dai suoi partner: proponili quando il cliente cerca un servizio da eseguire — foto, video, assistenza, salvataggio del sito — non solo un preventivo di costruzione; uno o due al massimo, adatti al bisogno espresso; cita il NOME ESATTO del servizio e il suo prezzo, senza inventare cifre: in emergenza, sito giù o hackerato, il servizio giusto è Assistenza Tecnica SOS Web):",
    );
    for (const p of services) lines.push(rowLine(p));
  }
  if (!lines.length) return "";
  return `\n\n${lines.join("\n")}`;
}
