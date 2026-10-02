import { db } from "@/lib/db";
import { operatorsFromEnv, isOnDuty } from "@/lib/operators";
import { getEffectiveTelegramConfig } from "@/lib/telegram-config";

/**
 * LETTORE DI SALUTE DEL SISTEMA — UN SOLO punto che dice come sta la piattaforma
 * (DB, notifiche, turni). Lo consumano due vetrine: la route /api/health per i
 * monitoraggi uptime esterni e la scheda «Inventario» di Ambrosio in admin.
 * Prima la stessa logica viveva inline nella route: la pagina avrebbe dovuto
 * fare self-HTTP per leggere la stessa verità (fragile e senza senso in SSR).
 *
 * Robustezza: ogni lettura degredisce da sola — DB assente non è un errore
 * («unconfigured»), i turni indisponibili non invalidano la salute.
 */

export type DbHealth = "ok" | "down" | "unconfigured";

export interface SystemHealth {
  database: DbHealth;
  /** Operatori (nome) in turno ORA, secondo le finestre delle variabili d'ambiente. */
  operatorsOnDuty: string[];
  notify: {
    email: boolean;
    telegram: boolean;
  };
  /** Canale Telegram bidirezionale (migration 033): token presente e modalità webhook/polling. */
  telegramChannel: {
    /** true = bot configurato (TELEGRAM_BOT_TOKEN): il webhook accetta messaggi. */
    enabled: boolean;
    /** "webhook" (secret impostato) | "webhook-no-secret" | "polling" | "off" */
    mode: "webhook" | "webhook-no-secret" | "polling" | "off";
  };
  timestamp: string;
}

/** Come sta la piattaforma adesso (nessun dato sensibile: sicuro anche in /api/health). */
export async function getSystemHealth(now = new Date()): Promise<SystemHealth> {
  const pool = db();
  let database: DbHealth = "unconfigured";
  if (pool) {
    try {
      await pool.query("select 1");
      database = "ok";
    } catch {
      database = "down";
    }
  }

  let operatorsOnDuty: string[] = [];
  try {
    operatorsOnDuty = operatorsFromEnv()
      .filter((o) => isOnDuty(o, now))
      .map((o) => o.firstName);
  } catch {
    // turni non disponibili: non invalida la salute
  }

  const tg = await getEffectiveTelegramConfig();
  const token = Boolean(tg?.token);
  const mode: SystemHealth["telegramChannel"]["mode"] = !token
    ? "off"
    : process.env.TELEGRAM_POLLING === "1"
      ? "polling"
      : tg?.webhookSecret
        ? "webhook"
        : "webhook-no-secret";

  return {
    database,
    operatorsOnDuty,
    notify: {
      email: Boolean(process.env.RESEND_API_KEY),
      telegram: Boolean(tg?.token && tg.teamChatIds.length > 0),
    },
    telegramChannel: {
      enabled: token,
      mode,
    },
    timestamp: now.toISOString(),
  };
}
