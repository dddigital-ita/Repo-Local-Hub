/**
 * PROBE del tick backup-cloud (USO TEMPORANEO per la messa in servizio 0.7.x):
 * esegue la STESSA pipeline del cron tick — runCloudBackup('system') + allarme —
 * contro il DB e il bucket di PRODUZIONE indicati dalle env. A fine giro
 * chiude il pool: niente processi che tengono Neon sveglio (regole AGENTS).
 * Da rimuovere o tenere come strumento occasionale: NON è un cron.
 */
import { runCloudBackup, allarmeBackupCloudSeDovuto } from "@/lib/backup-cloud";
import { db } from "@/lib/db";

(async () => {
  console.log("[tick] runCloudBackup…");
  const r = await runCloudBackup("system");
  console.log("[tick] esito:", JSON.stringify(r));
  const alarm = await allarmeBackupCloudSeDovuto("system");
  console.log("[tick] allarme suonato?", alarm, "(atteso: false con backup appena riuscito)");
  // Chiusura pulita: il compute Neon può tornare a dormire.
  const p = db();
  if (p) await p.end();
  process.exit(r.done ? 0 : 2);
})().catch(async (e) => {
  console.error("[tick] ERRORE:", e instanceof Error ? e.message : e);
  process.exit(1);
});
