#!/bin/bash
# Server PRODUZIONE-LIKE (build `next start` su :3105) per la verifica captcha.
# Il processo viene staccato con double-fork: le shell dei tool/CI uccidono
# i figli diretti alla chiusura, un daemon con sessione propria sopravvive.
# Usage: scripts/prodlike-server.sh start|stop
cd "$(dirname "$0")/.."
case "${1:-start}" in
  start)
    python3 - <<'PYEOF'
import os, subprocess, sys
if os.fork() > 0: sys.exit(0)
os.setsid()
if os.fork() > 0: sys.exit(0)
env = dict(os.environ)
for line in open('.env.e2e'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        env.setdefault(k, v)
env['WAC_DIST_DIR'] = '.next-prod'
with open('/tmp/wac-prodlike-server.log', 'ab') as out:
    p = subprocess.Popen(['node', 'node_modules/next/dist/bin/next', 'start', '-p', '3105'],
                         env=env, stdout=out, stderr=out, stdin=subprocess.DEVNULL, cwd=os.getcwd())
open('/tmp/wac-prodlike.pid', 'w').write(str(p.pid))
PYEOF
    sleep 4
    curl -s -o /dev/null -w "prodlike server: %{http_code} su :3105\n" --max-time 5 http://localhost:3105/admin/login
    ;;
  stop)
    [ -f /tmp/wac-prodlike.pid ] && kill "$(cat /tmp/wac-prodlike.pid)" 2>/dev/null || true
    rm -f /tmp/wac-prodlike.pid
    echo "prodlike server fermato"
    ;;
esac
