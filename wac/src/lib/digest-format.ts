/**
 * FORMATO DEL DIGEST MATTUTINO — cuore PURO, zero import.
 *
 * Le decisioni su cosa entra nel digest e come si intitola vivono QUI e
 * girano identiche nei test di node (import diretto del .ts), come per le
 * pill degli hub. L'invio (destinatari, SMTP, dedup) sta nel layer server
 * `digest.ts`; il cron decide SOLO se è l'ora.
 *
 * Semantica: il digest è un AGGIORNAMENTO, non una sirena — l'ambra della
 * configurazione entra sempre (è gratuita: dice cosa si può completare),
 * il rosso dell'agenda operativo guida l'oggetto. Giornata verde e senza
 * schede in attesa → digest «tutto a posto» SOLO se esplicitamente voluto
 * (`includeWhenClear`), di default NIENTE email: il silenzio è una buona
 * notizia e il team non deve filtrare email inutili.
 */

export type DigestStatus = {
  ok: boolean;
  warn: boolean;
  /** true = scadenza violata (solo agenda operativa). */
  danger?: boolean;
  label: string;
};

export type DigestItem = {
  /** Nome della scheda/pendenza (canonico, dal catalogo condiviso). */
  label: string;
  /** Nota breve (es. «Da collegare», «38 in ritardo»). */
  note: string;
  /** Link assoluto alla scheda (baseUrl risolto dal layer server). */
  href: string;
};

export type DigestSection = {
  title: string;
  items: DigestItem[];
};

/** Finestra mattutina (ORARIO DI ROMA): tra le 6 e le 8 incluse. */
export const DIGEST_WINDOW_UTC = { startRome: 6, endRome: 8 } as const;

/** true quando l'ora di Roma cade nella finestra del digest (6:00–8:59). */
export function isMorningDigestTime(hourRome: number): boolean {
  const h = Math.floor(Number(hourRome) || 0);
  return h >= DIGEST_WINDOW_UTC.startRome && h <= DIGEST_WINDOW_UTC.endRome;
}

/** L'oggetto guida con il più urgente: rosso → operativo, altrimenti configurazione. */
export function digestSubject(input: {
  operational: DigestSection | null;
  configuration: DigestSection;
}): string {
  const reds = input.operational?.items.filter((i) => i.note.startsWith("!")) ?? [];
  if (reds.length > 0) {
    return `☕ Digest: ${reds.length} ${reds.length === 1 ? "scadenza violata" : "scadenze violate"} — agire adesso`;
  }
  const pending = input.configuration.items.length;
  if (pending > 0) {
    return `☕ Digest: ${pending} ${pending === 1 ? "scheda da completare" : "schede da completare"}`;
  }
  return "☕ Digest: tutto a posto";
}

/**
 * Le righe del digest (testo piano, multipart con HTML opzionale a parte).
 * Il rosso usa il prefisso «!» nella note: il formato non conosce i colori,
 * il layer server li traduce in maiuscole/emoji se serve.
 */
export function digestLines(input: {
  baseUrl: string;
  operational: DigestSection | null;
  configuration: DigestSection;
  /** true = includi la riga «tutto a posto» anche senza pendi (default: no). */
  includeWhenClear?: boolean;
}): string[] {
  const lines: string[] = [];
  const hasOperational = Boolean(input.operational && input.operational.items.length > 0);
  const hasConfig = input.configuration.items.length > 0;

  if (!hasOperational && !hasConfig) {
    if (!input.includeWhenClear) return [];
    return ["Nessun pendio operativo e nessuna scheda in attesa: giornata libera.", "", input.baseUrl];
  }

  if (hasOperational) {
    lines.push("OPERATIVO — si agisce oggi");
    for (const item of input.operational!.items) {
      lines.push(`• ${item.label} — ${item.note}`);
      lines.push(`  ${absolute(input.baseUrl, item.href)}`);
    }
    lines.push("");
  }

  lines.push("CONFIGURAZIONE — si completa quando si può");
  for (const item of input.configuration.items) {
    lines.push(`• ${item.label} — ${item.note}`);
    lines.push(`  ${absolute(input.baseUrl, item.href)}`);
  }

  return lines;
}

/** href assoluto: i link del digest devono aprire dal client email. */
function absolute(baseUrl: string, href: string): string {
  if (!baseUrl || href.startsWith("http") || href.startsWith("mailto:")) return href;
  return `${baseUrl.replace(/\/$/, "")}${href.startsWith("/") ? "" : "/"}${href}`;
}
