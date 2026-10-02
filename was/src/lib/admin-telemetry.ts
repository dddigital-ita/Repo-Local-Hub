import { logAudit } from "./audit";

/**
 * TELEMETRIA DEI TEMPI DI RENDERING ADMIN (ADR-005, strumento di verifica):
 * ogni navigazione /admin vera (esclusi i prefetch RSC, vedi layout) finisce
 * in audit come `admin.render` con il path, la durata del server render e
 * l'operatore. Il confronto nel tempo risponde alla domanda «le pagine sono
 * davvero più veloci dopo la dedup?» senza stime a memoria.
 *
 * Perché in audit_log e non una tabella nuova: append-only dalla 010, già
 * indicizzato su (created_at desc), già interrogabile dalla scheda Audit con
 * un'etichetta — niente migration, niente seconda fonte di verità. Il volume
 * è una riga per navigazione admin: stesso ordine di grandezza degli altri
 * eventi, trascurabile.
 */

/**
 * Registra il tempo di rendering di una navigazione admin. Mai un throw:
 * la telemetria non deve mai rompere la pagina che misura (il layout la
 * chiama dentro after(), ma per contratto degrada a silenzio).
 */
export async function logAdminRenderTime(opts: {
  path: string;
  ms: number;
  email: string | null;
}): Promise<void> {
  try {
    // Arrotondo a ms interi e ordino di grandezza nel dettaglio: 1200ms
    // resta leggibile, 1234.567 no. Soglia in console per il dev locale.
    const ms = Math.max(0, Math.round(opts.ms));
    if (process.env.NODE_ENV !== "production") {
      console.log(`[telemetry] ${opts.path}: ${ms}ms`);
    }
    await logAudit(opts.email ?? "sconosciuto", "admin.render", opts.path, `${ms}ms`);
  } catch {
    // niente: il render è già finito, l'audit è fire-and-forget
  }
}
