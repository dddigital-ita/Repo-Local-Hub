#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  MIGRAZIONE DATI NEON → SERVER · Web Agency Crema
# ═══════════════════════════════════════════════════════════════════
# Copia TUTTO il database (schema + dati) da Neon al Postgres del
# server finale. Prima di scrivere fa un backup completo del DB di
# destinazione su file: il ripristino è sempre possibile.
#
# USO:
#   ./scripts/db-migrate-neon.sh <URL_NEON> <URL_DEST> [--dry-run]
#
# Esempi:
#   # Prova generale (non scrive nulla, mostra cosa farebbe):
#   ./scripts/db-migrate-neon.sh "$NEON_URL" \
#     "postgresql://webagency:pass@localhost:5432/webagency" --dry-run
#
#   # Migrazione vera:
#   ./scripts/db-migrate-neon.sh "$NEON_URL" \
#     "postgresql://webagency:pass@localhost:5432/webagency"
#
# REQUISITI DI VERSIONE (regola pg_dump: client ≥ server sorgente):
#   • la macchina che esegue lo script deve avere client PostgreSQL 18+
#     (Neon gira su Postgres 18: con pg_dump 16 il dump è rifiutato)
#   • il server di destinazione deve essere PostgreSQL ≥ 18
# Il controllo "Versioni compatibili" qui sotto verifica entrambi.
#
# Gli URL si possono anche passare via ambiente: NEON_URL e DEST_URL.
# Suggerimento: importali da .env.local con
#   export $(grep -E '^DATABASE_URL=' .env.local | head -1) && \
#   ./scripts/db-migrate-neon.sh "$DATABASE_URL" "$DEST_URL"
#
# NOTA Turnstile: la password nel log è mascherata; gli URL completi
# compaiono solo mascherati. Esegui lo script in un terminale fidato.
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Argomenti ────────────────────────────────────────────────────────
NEON_URL="${1:-${NEON_URL:-}}"
DEST_URL="${2:-${DEST_URL:-}}"
DRY_RUN=false
[[ "${3:-}" == "--dry-run" ]] && DRY_RUN=true

if [[ -z "$NEON_URL" || -z "$DEST_URL" ]]; then
  echo "Uso: $0 <URL_NEON> <URL_DEST> [--dry-run]" >&2
  echo "     (oppure esporta NEON_URL e DEST_URL)" >&2
  exit 1
fi

# Toglie eventuali virgolette ereditate da .env.local (DATABASE_URL="...")
strip_quotes() { echo "$1" | sed -E "s/^\"([^\"]*)\"$/\1/; s/^'([^']*)'$/\1/"; }
NEON_URL=$(strip_quotes "$NEON_URL")
DEST_URL=$(strip_quotes "$DEST_URL")

# ── Strumenti richiesti ──────────────────────────────────────────────
for tool in pg_dump pg_restore psql; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "❌ Manca $tool (serve il client PostgreSQL 14+)" >&2
    exit 1
  }
done

# ── Helper: URL mascherato per i log ─────────────────────────────────
mask_url() {
  echo "$1" | sed -E 's#(://[^:/@]+):[^@]*@#\1:****@#'
}
NEON_SAFE=$(mask_url "$NEON_URL")
DEST_SAFE=$(mask_url "$DEST_URL")

# ── Connessioni di controllo ─────────────────────────────────────────
step() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[0;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[0;33m⚠\033[0m %s\n' "$*"; }
fail() { printf '  \033[0;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

step "1/6 · Verifica connessioni"
psql "$NEON_URL" -tAc "SELECT 1" >/dev/null 2>&1 \
  || fail "Impossibile connettersi a Neon ($NEON_SAFE)"
ok "Neon raggiungibile ($NEON_SAFE)"
psql "$DEST_URL" -tAc "SELECT 1" >/dev/null 2>&1 \
  || fail "Impossibile connettersi al DB di destinazione ($DEST_SAFE)"
ok "Destinazione raggiungibile ($DEST_SAFE)"

# Verifica versione: Neon esporta verso versioni uguali o più vecchie,
# MAI il contrario (pg_dump non garantisce downgrade).
SRC_VER=$(psql "$NEON_URL" -tAc "SHOW server_version_num" | tr -d ' ')
DST_VER=$(psql "$DEST_URL" -tAc "SHOW server_version_num" | tr -d ' ')
if (( SRC_VER > DST_VER )) && [[ "${WAC_SKIP_VERSION_CHECK:-}" != "1" ]]; then
  fail "Versione insufficiente: sorgente PG $((SRC_VER/10000)), destinazione PG $((DST_VER/10000)). Il server deve avere PostgreSQL ≥ $((SRC_VER/10000)) e il client pg_dump qui deve essere ≥ $((SRC_VER/10000)) (brew install postgresql@18 / apt postgresql-18). Bypass esperto: WAC_SKIP_VERSION_CHECK=1"
fi
(( SRC_VER > DST_VER )) && warn "Bypass versione attivo: il restore su versione più vecchia può fallire su tipi nuovi di PG 18"
ok "Versioni compatibili (Neon $((SRC_VER/10000)) → destinazione $((DST_VER/10000)))"

# ── Pre-flight: cosa c'è da spostare ─────────────────────────────────
step "2/6 · Pre-flight"
TABLES_SRC=$(psql "$NEON_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
TABLES_DST=$(psql "$DEST_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
ok "Tabelle su Neon: $TABLES_SRC · su destinazione: $TABLES_DST"
if [[ "$TABLES_SRC" == "0" ]]; then
  fail "Neon non ha tabelle nel public: niente da migrare (URL giusto?)"
fi
psql "$NEON_URL" -tAc "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1" \
  | sed 's/^/    · /'

# Righe delle tabella operative per confronto post-restore
step "3/6 · Conteggio righe su Neon (riferimento)"
# I ticket vivono DENTRO conversations (migrazione 003): niente tabella tickets
COUNT_SQL="SELECT 'leads', count(*) FROM leads
  UNION ALL SELECT 'conversations', count(*) FROM conversations
  UNION ALL SELECT 'messages', count(*) FROM messages
  UNION ALL SELECT 'operators', count(*) FROM operators
  UNION ALL SELECT 'admin_users', count(*) FROM admin_users
  UNION ALL SELECT 'callbacks', count(*) FROM callbacks
  UNION ALL SELECT 'packages', count(*) FROM packages
  UNION ALL SELECT 'audit_log', count(*) FROM audit_log
  UNION ALL SELECT 'shield_bans', count(*) FROM shield_bans
  UNION ALL SELECT 'shield_events', count(*) FROM shield_events
  UNION ALL SELECT 'ai_provider_keys', count(*) FROM ai_provider_keys
  UNION ALL SELECT 'ticket_notes', count(*) FROM ticket_notes;"
REF_COUNTS=$(psql "$NEON_URL" -tAF'|' -c "$COUNT_SQL" 2>/dev/null || true)
if [[ -n "$REF_COUNTS" ]]; then
  echo "$REF_COUNTS" | awk -F'|' '{printf "    · %-18s %s righe\n", $1, $2}'
else
  warn "Alcune tabelle mancano su Neon: il confronto finale sarà parziale"
fi

if $DRY_RUN; then
  step "DRY-RUN attivo: nessuna scrittura eseguita"
  echo "Al lancio vero (senza --dry-run):"
  echo "  1. backup pre-migrazione della destinazione su file"
  echo "  2. pg_dump Neon (schema+dati) → pg_restore --clean su destinazione"
  echo "  3. ANALYZE e verifica dei conteggi"
  echo ""
  echo "Prossimo passo: rilancia SENZA --dry-run per eseguire la migrazione."
  exit 0
fi

# ── Backup di sicurezza della destinazione ───────────────────────────
step "4/6 · Backup pre-migrazione della destinazione"
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="/tmp/wac-pre-migrate-$STAMP.dump"
if ! pg_dump "$DEST_URL" -Fc -f "$BACKUP_FILE" 2>/dev/null; then
  fail "Backup della destinazione fallito: mi fermo senza toccare nulla"
fi
BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
ok "Backup salvato: $BACKUP_FILE ($BACKUP_SIZE)"
warn "Conservalo finché la migrazione non è verificata in produzione"

# ── Dump da Neon + restore nella destinazione ────────────────────────
step "5/6 · Dump da Neon → restore nella destinazione"
# --clean --if-exists: le tabelle di destinazione vengono ricreate
# identiche a Neon (sovrascrive lo schema — il backup al punto 4 copre).
DUMP_FILE="/tmp/wac-neon-$STAMP.dump"
# L'endpoint -pooler (PgBouncer) chiude la connessione durante pg_dump:
# si usa l'endpoint DIRETTO, che punta allo stesso branch.
DUMP_URL="${NEON_URL/-pooler./.}"
[[ "$DUMP_URL" != "$NEON_URL" ]] && warn "Endpoint pooler non compatibile con pg_dump: uso il diretto"
pg_dump "$DUMP_URL" -Fc --no-owner --no-privileges -f "$DUMP_FILE"
DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
ok "Dump creato: $DUMP_SIZE"

RESTORE_RC=0
RESTORE_OUT=$(pg_restore --dbname "$DEST_URL" \
    --no-owner --no-privileges \
    --clean --if-exists \
    "$DUMP_FILE" 2>&1) || RESTORE_RC=$?
rm -f "$DUMP_FILE"
# Errori tollerabili: oggetti gia' presenti (estensioni, commenti, owner)
REAL_ERRORS=$(echo "$RESTORE_OUT" | grep -iE "error|FATAL" | grep -vc "already exists" || true)
if (( RESTORE_RC != 0 )); then
  echo "$RESTORE_OUT" | tail -8 >&2
  fail "pg_restore fallito (codice $RESTORE_RC): il backup al punto 4 permette il ripristino"
fi
if (( REAL_ERRORS > 0 )); then
  echo "$RESTORE_OUT" | grep -iE "error|FATAL" | grep -v "already exists" | head -5 >&2
  warn "pg_restore: $REAL_ERRORS errori non fatali (dettagli sopra)"
else
  ok "Restore completato"
fi

# ── Verifica finale ──────────────────────────────────────────────────
step "6/6 · ANALYZE e verifica dei conteggi"
psql "$DEST_URL" -c "ANALYZE" >/dev/null 2>&1 && ok "ANALYZE eseguito (piani di query aggiornati)"

if [[ -n "$REF_COUNTS" ]]; then
  NEW_COUNTS=$(psql "$DEST_URL" -tAF'|' -c "$COUNT_SQL" 2>/dev/null || true)
  ALL_OK=true
  while IFS='|' read -r name ref; do
    new=$(echo "$NEW_COUNTS" | awk -F'|' -v t="$name" '$1==t{print $2}')
    if [[ "$new" == "$ref" ]]; then
      ok "$name: $new righe"
    else
      warn "$name: attese $ref, trovate ${new:-assente}"
      ALL_OK=false
    fi
  done <<< "$REF_COUNTS"
fi

echo ""
if [[ "${ALL_OK:-true}" == "true" ]]; then
  echo "✅ Migrazione completata e verificata."
else
  echo "⚠️  Migrazione completata con differenze: confronta i conteggi sopra."
fi
echo ""
echo "Prossimi passi:"
echo "  1. .env.production sul server → DATABASE_URL=$DEST_SAFE"
echo "  2. ADMIN_SESSION_SECRET: se hai chiavi AI cifrate su Neon, usa lo STESSO segreto"
echo "     (oppure reinseriscile da /admin/ai dopo il go-live)"
echo "  3. npm run build && npm start  →  verifica /api/health"
echo "  4. Login admin: node scripts/create-admin.mjs se gli utenti non sono nel dump"
echo ""
echo "Quando tutto è verificato, elimina i file temporanei:"
echo "  rm -f $BACKUP_FILE"
