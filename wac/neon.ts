import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // I bucket di branch. backups: le copie restoreabili automatiche del DB
  // (ADR: backup senza Mac acceso) — il cron ne deposita una al giorno con
  // verifica di lettura e sha256, la retention tiene gli ultimi 14.
  // Privato: si legge solo con le credenziali del branch.
  // (uploads era vuoto e senza codice che lo usa: rimosso. auth e le
  // functions demo non erano mai state usate: vedi audit config.)
  buckets: {
    backups: { access: "private" },
  },
});
