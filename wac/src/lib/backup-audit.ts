/**
 * Azioni di audit del ciclo BACKUP (lib condivisa, zero dipendenze).
 *
 * Unica fonte di verità per il filtro della pagina Audit e per l'export
 * CSV dedicato: le due viste restano allineate senza copia-incolla. Le
 * azioni esistono già (nessuna nuova scrittura): la lista descrive un
 * sottogruppo del log, non aggiunge eventi.
 */
export const BACKUP_AUDIT_ACTIONS = [
  "backup.creato",
  "backup.eliminato",
  "backup.errore",
  "backup.promemoria",
  "versione.check",
  "restore.eseguito",
  "restore.errore",
] as const;
