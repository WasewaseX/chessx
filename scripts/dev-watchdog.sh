#!/bin/bash
<<<<<<< HEAD
# Never-stop watchdog: keeps the Next.js dev server alive.
# If next-server crashes or gets OOM-killed, restart it automatically.
cd /home/z/my-project

while true; do
  if curl -sf -o /dev/null -m 5 http://127.0.0.1:3000/; then
    # Server healthy — idle-check again shortly.
    sleep 15
    continue
  fi
  echo "[watchdog] $(date -Is) port 3000 not serving -> starting next dev" >> /home/z/my-project/watchdog.log
  bun run dev
  echo "[watchdog] $(date -Is) next dev exited (code $?) -> restarting in 3s" >> /home/z/my-project/watchdog.log
  sleep 3
=======
# ChessX dev-server watchdog — HTTP-health-based supervision.
#
# ROOT CAUSE this fixes ("session init failed" / "render failed", Oct 24):
# the kernel OOM-killed next-server (3.44GB RSS on a 3.9GB box) during the
# first post-boot compile and NOTHING restarted it — the preview panel kept
# reporting session failures until the whole sandbox was rebooted.
#
# Design (deliberately PID-tree-free): the old design tracked the server as a
# shell child; bun/pipeline orphans and SIGKILL zombies made that fragile.
# This watchdog only watches observable HTTP health:
#   - every 5s: GET http://localhost:3000/
#   - 3 consecutive failures (≈15s dead)  -> scripts/dev-server.sh restarts
#   - success resets the counter and the backoff
#   - restart backoff: 5s, 10s, 20s, 40s… capped at 60s so a genuinely broken
#     server cannot burn CPU in a tight crash loop
#   - .zscripts/dev.stop stops everything (sandbox pre-stop or manual)
#   - exits when this script's own parent disappears (sandbox shutdown)
#
# dev.sh exec's into this script, so it IS the long-lived boot process.

set -u

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STOP_FLAG="$PROJECT_DIR/.zscripts/dev.stop"
WATCHDOG_LOG="$PROJECT_DIR/.zscripts/watchdog.log"
STARTER="$PROJECT_DIR/scripts/dev-server.sh"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [watchdog] $*" >>"$WATCHDOG_LOG"; }

cleanup() {
        touch "$STOP_FLAG" 2>/dev/null || true
        log "watchdog exiting (sandbox stop / signal)"
}
trap cleanup EXIT
trap 'cleanup; exit 143' INT TERM

# Shutdown anchors are (a) the stop flag and (b) the INT/TERM trap above.
# A parent-PID liveness check is deliberately ABSENT: dev.sh exec's into this
# script, so this process IS the long-lived boot process — it can never be
# orphaned away from its own duty, and 'kill -0 1' fails with EPERM for an
# unprivileged user anyway (the Oct 24 bug that made the first watchdog exit
# the same second it armed).

log "armed (health-based)"

FAILS=0
BACKOFF=5
LAST_OK=0

while true; do
        if [ -f "$STOP_FLAG" ]; then
                log "stop flag present — exiting"
                exit 0
        fi

        CODE=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://localhost:3000/" 2>/dev/null)
        if [ "$CODE" ] && [[ "$CODE" == 2* || "$CODE" == 3* ]]; then
                if [ "$FAILS" -gt 0 ]; then
                        log "server recovered (HTTP $CODE) after $FAILS failed check(s)"
                fi
                FAILS=0
                BACKOFF=5
                LAST_OK=$(date +%s)
        else
                FAILS=$((FAILS + 1))
                # Only react after 3 consecutive failures: one bad probe during a long
                # compile of a DIFFERENT route must not trigger a restart.
                if [ "$FAILS" -ge 3 ]; then
                        log "server UNHEALTHY ($FAILS consecutive bad checks, last HTTP ${CODE:-none}) — restarting (backoff ${BACKOFF}s)"
                        bash "$STARTER" >>"$WATCHDOG_LOG" 2>&1
                        sleep "$BACKOFF"
                        BACKOFF=$((BACKOFF * 2))
                        [ "$BACKOFF" -gt 60 ] && BACKOFF=60
                        FAILS=0 # give the starter's work a full window before judging again
                fi
        fi

        sleep 5
>>>>>>> 183ec7a (boot: root out 'session init failed' — OOM-proof dev server)
done
