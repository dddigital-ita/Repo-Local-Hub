import type { HubCardStatus } from "./settings-status";

/**
 * LAYER DI DATI DEGLI STATI DELL'HUB TOOLS — cuore PURO (zero import runtime,
 * solo il tipo condiviso): le regole che decidono i badge delle schede.
 * Testate da node con import diretto del .ts, come `settings-status.ts`.
 *
 * Semantica dei tre toni: verde = completo; ambra = azione attesa (mai
 * eseguito, errore recente, da collegare); grigio = default o non valutabile.
 */

/** Tema grafico: personalizzato solo quando c'è almeno un colore dell'agenzia. */
export function themeStatus(theme: { primary?: string | null; accent?: string | null } | null | undefined): HubCardStatus {
  const customized = Boolean(theme?.primary || theme?.accent);
  return {
    key: "theme",
    ok: customized,
    warn: false,
    label: customized ? "Personalizzato" : "Predefinito",
    counts: [],
  };
}

const DAY_MS = 86_400_000;

/**
 * Backup: lo stato vero viene dall'audit (fonte delle statistiche del
 * progetto). Regole:
 * - DB/audit non disponibili → «Non disponibile» neutro (nessuna azione
 *   dovuta dall'hub: non è una mancanza di backup, è un ambiente senza DB);
 * - mai un backup riuscito → ambra «Mai eseguito»;
 * - un errore PIÙ RECENTE dell'ultimo successo → ambra «Errore ultimo»;
 * - altrimenti verde con «Ultimo: N gg» (o «oggi»).
 * Date malformate vengono ignorate, non fanno lanciare.
 */
export function backupStatus(input: {
  available: boolean;
  lastCreated: string | null;
  lastError: string | null;
  /** Iniettabile per test deterministici. */
  now?: number;
}): HubCardStatus {
  if (!input.available) {
    return { key: "backup", ok: false, warn: false, label: "Non disponibile", counts: [] };
  }
  const created = input.lastCreated ? Date.parse(input.lastCreated) : NaN;
  const errored = input.lastError ? Date.parse(input.lastError) : NaN;
  if (!Number.isFinite(created)) {
    return { key: "backup", ok: false, warn: true, label: "Mai eseguito", counts: [] };
  }
  if (Number.isFinite(errored) && errored > created) {
    return { key: "backup", ok: false, warn: true, label: "Errore ultimo", counts: [] };
  }
  const days = Math.max(0, Math.floor(((input.now ?? Date.now()) - created) / DAY_MS));
  return {
    key: "backup",
    ok: true,
    warn: false,
    label: days === 0 ? "Ultimo: oggi" : `Ultimo: ${days} gg`,
    counts: [],
  };
}

/** Regola unica del Google growth kit (usa anche il reader integrazioni): collegato = credenziali Search Console API. */
export function googleKitStatus(hasGscCreds: boolean, snippetCount: number): HubCardStatus {
  return {
    key: "google-kit",
    ok: hasGscCreds,
    warn: !hasGscCreds,
    label: hasGscCreds ? "Collegato" : "Da collegare",
    counts: snippetCount > 0 ? [{ n: snippetCount, label: "snippet attivi" }] : [],
  };
}

/**
 * Free cache (modello gemello): lo strumento è sempre PRONTO (la purga non
 * è mai una carenza da segnalare — è la valvola, non la riparazione). La
 * pill resta verde, la meta porta l'ultima purga dall'audit (cache.purga):
 * «Mai eseguito» non è ambra, è solo informazione.
 */
export function cachePurgeStatus(last: { at: string | null } | null, now?: number): HubCardStatus {
  const at = last?.at ? Date.parse(last.at) : NaN;
  let meta = "Mai purgata";
  if (Number.isFinite(at)) {
    const days = Math.max(0, Math.floor(((now ?? Date.now()) - at) / DAY_MS));
    meta = days === 0 ? "Purgata oggi" : `Ultima: ${days} gg`;
  }
  return { key: "cache-purge", ok: true, warn: false, label: "Pronto", counts: [], meta: [meta] };
}
