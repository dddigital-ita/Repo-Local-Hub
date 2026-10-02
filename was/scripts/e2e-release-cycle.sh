#!/bin/bash
# Ciclo E2E per-file per la release — resistente ai kill esterni.
#
# Problema (30/09/2026): durante le run E2E lunghe qualcuno manda SIGTERM
# al server sulla banda 3110-3189 (i repo gemelli condividono la convenzione
# delle porte e una run dell'altro repo può entrare in collisione): la run
# intera muore a metà, le catene seriali dopo il punto del kill non girano e
# i seed senza afterAll inquinano il DB (il leak-guard a fine run fallisce
# anche per spec passate).
#
# Soluzione: una run per spec con server dedicato (porta derivata 3135),
# riavvio automatico se il server è morto e retry del file colpito. Un kill
# colpisce al massimo un file, il retry lo ripete su server fresco.
#
# Uso: scripts/e2e-release-cycle.sh spec1 spec2 ...   (nome senza .spec.ts)
set -u
cd "$(dirname "$0")/.." || exit 1

PORT="${WAC_E2E_PORT:-$(node -p "require('./scripts/e2e-port.cjs').portaE2ERepo()")}"
HEALTH="http://127.0.0.1:$PORT/consulenza"
VERBALE="${WAC_E2E_VERBALE:-/tmp/was-release-e2e.txt}"

start_server() {
  screen -wipe >/dev/null 2>&1
  screen -dmS wase2e bash -c "WAC_E2E=1 WAC_DIST_DIR=.next-e2e PORT=$PORT node scripts/e2e-dev-server.mjs dev > /tmp/was-e2e-$PORT.log 2>&1"
  for _ in $(seq 1 40); do
    curl -s -o /dev/null --max-time 3 "$HEALTH" && return 0
    sleep 3
  done
  return 1
}

if [ $# -eq 0 ]; then
  set -- $(ls tests/e2e/*.spec.ts | sed 's|tests/e2e/||; s|\.spec\.ts$||' | grep -v prodlike)
fi

for f in "$@"; do
  if ! curl -s -o /dev/null --max-time 3 "$HEALTH"; then
    start_server || { echo "SERVER_DOWN $f" >> "$VERBALE"; continue; }
  fi
  if npx playwright test "tests/e2e/$f.spec.ts" > "/tmp/was-file-$f.log" 2>&1; then
    echo "PASS $f" >> "$VERBALE"
  else
    echo "FAIL $f → retry" >> "$VERBALE"
    kill $(lsof -ti:"$PORT") 2>/dev/null
    sleep 2
    start_server || { echo "SERVER_DOWN retry $f" >> "$VERBALE"; continue; }
    if npx playwright test "tests/e2e/$f.spec.ts" > "/tmp/was-file-$f.log" 2>&1; then
      echo "PASS $f (retry)" >> "$VERBALE"
    else
      echo "FAIL $f (dopo retry)" >> "$VERBALE"
    fi
  fi
done

echo "=== verbaele ($PORT) ==="
cat "$VERBALE"
