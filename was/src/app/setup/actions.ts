"use server";

import { setupState, testConnection, runInstall, type DbProbe, type InstallResult } from "@/lib/setup";

/**
 * Azioni del wizard. Sono l'unica superficie pubblica dell'installatore:
 *  - validazione lato server di tutto ciò che arriva;
 *  - throttle in-memory (il processo Passenger è uno: è sufficiente);
 *  - il lock di completamento viene riverificato PRIMA di ogni installazione,
 *    così anche una richiesta forgiata non può reinstallare sopra un sito
 *    già configurato.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DSN_RE = /^postgres(ql)?:\/\//;

/** Finestra corrente (ms dal boot del processo) → contatore richieste. */
const WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; window: number }>();

function throttle(key: string, max: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.window > WINDOW_MS) {
    buckets.set(key, { count: 1, window: now });
    return true;
  }
  b.count++;
  return b.count <= max;
}

export async function testConnectionAction(dsn: string): Promise<DbProbe> {
  // Il wizard è a corsa unica: su un sito già installato /setup è chiuso (404
  // nel layout) ma le server action restano raggiungibili con una richiesta
  // forgiata. Riverifica del lock PRIMA di toccare il database: su un sito
  // installato l'endpoint non esiste, nemmeno come probe di sola lettura.
  const state = await setupState();
  if (state === "completed") {
    return { ok: false, error: "Il wizard è già stato completato: /setup è chiuso." };
  }
  if (!throttle("probe", 20)) {
    return { ok: false, error: "Troppe verifiche in sequenza: attendi un minuto." };
  }
  if (typeof dsn !== "string" || !DSN_RE.test(dsn.trim())) {
    return { ok: false, error: "La connection string deve iniziare con postgresql://" };
  }
  return testConnection(dsn);
}

export interface InstallRequest {
  siteUrl: string;
  dsn: string;
  adminEmail: string;
  adminPassword: string;
}

export async function installAction(input: InstallRequest): Promise<InstallResult> {
  if (!throttle("install", 5)) {
    return { ok: false, error: "Troppi tentativi: attendi un minuto prima di rilanciare l'installazione.", logs: [] };
  }

  // Riverifica del lock: su un sito già installato il wizard non riesegue nulla.
  const state = await setupState();
  if (state === "completed") {
    return { ok: false, error: "Il wizard è già stato completato: /setup è chiuso.", logs: [] };
  }

  const siteUrl = (input?.siteUrl ?? "").trim().replace(/\/+$/, "");
  const dsn = (input?.dsn ?? "").trim();
  const adminEmail = (input?.adminEmail ?? "").trim().toLowerCase();
  const adminPassword = input?.adminPassword ?? "";

  if (!/^https?:\/\/[^\s]+\.[^\s]+$/.test(siteUrl)) {
    return { ok: false, error: "URL del sito non valido: usa il formato https://www.dominio.com", logs: [] };
  }
  if (!DSN_RE.test(dsn)) {
    return { ok: false, error: "La connection string deve iniziare con postgresql://", logs: [] };
  }
  if (!EMAIL_RE.test(adminEmail)) {
    return { ok: false, error: "Email del super admin non valida.", logs: [] };
  }
  if (adminPassword.length < 8) {
    return { ok: false, error: "La password del super admin deve essere di almeno 8 caratteri.", logs: [] };
  }

  return runInstall({ siteUrl, dsn, adminEmail, adminPassword });
}
