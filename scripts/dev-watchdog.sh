#!/bin/bash
# ChessX dev-server watchdog — HTTP-health-based supervision (MANUAL TOOL).
#
# The ALWAYS-ON supervisor in production is mini-services/game-service/
# watchdog-child.ts (platform-owned, reaper-immune, pid-lockfile singleton).
# This script is the manual/operator equivalent for interactive use:
#   bun run watchdog
#
# Design (deliberately PID-tree-free): PID-tree supervision proved fragile
# across bun/pipeline orphans and SIGKILL zombies (Oct 24 incident). This
# watchdog only watches observable HTTP health:
#   - every 5s: GET http://localhost:3000/
#   - 3 consecutive failures (≈15s dead)  -> scripts/dev-server.sh restarts
#   - success resets the counter and the backoff
#   - restart backoff: 5s, 10s, 20s, 40s… capped at 60s so a genuinely broken
#     server cannot burn CPU in a tight crash loop
#   - .zscripts/dev.stop stops everything (manual off switch)
#
# NOTE: do not run this AND expect zero interaction with watchdog-child —
# dev-server.sh is idempotent (it no-ops when a healthy server already
# answers), so overlapping watchers converge rather than fight; but prefer
# leaving supervision to watchdog-child.

set -u

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STOP_FLAG="$PROJECT_DIR/.zscripts/dev.stop"
WATCHDOG_LOG="$PROJECT_DIR/.zscripts/watchdog.log"
STARTER="$PROJECT_DIR/scripts/dev-server.sh"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [watchdog] $*" >>"$WATCHDOG_LOG"; }

cleanup() {
	touch "$STOP_FLAG" 2>/dev/null || true
	log "watchdog exiting (manual stop / signal)"
}
trap cleanup EXIT
trap 'cleanup; exit 143' INT TERM

# Shutdown anchors are (a) the stop flag and (b) the INT/TERM trap above.
# A parent-PID liveness check is deliberately ABSENT: 'kill -0 1' fails with
# EPERM for an unprivileged user (the bug that made an early version exit the
# same second it armed), and this tool has no parent contract to honor.

log "armed (manual health-based watchdog)"

FAILS=0
BACKOFF=5

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
done
