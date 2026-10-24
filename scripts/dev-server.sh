#!/bin/bash
# One-shot, IDEMPOTENT dev-server starter. Used by dev.sh at boot and re-used
# by dev-watchdog.sh after every detected death.
#
# Why idempotent: the watchdog does not track child PIDs (the Oct 24 incident
# showed PID-tree supervision is fragile across bun/pipeline orphans and
# zombies). Instead the watchdog watches HTTP health and calls this script to
# (re)start. This script therefore must:
#   1. do nothing when a healthy server already answers on :3000,
#   2. free an ORPHANED listener (server process dead but socket held) before
#      starting a fresh one,
#   3. start the server detached (setsid + nohup) so it survives its parent.
#
# Node heap cap (anti-OOM): --max-old-space-size=1536 keeps V8 collecting hard
# instead of ballooning RSS past 3.4GB — the exact condition that got the
# kernel to OOM-kill next-server (dmesg, Oct 24, uptime 166s).

set -u

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STOP_FLAG="$PROJECT_DIR/.zscripts/dev.stop"
LOG="$PROJECT_DIR/dev.log"

[ -f "$STOP_FLAG" ] && { echo "[dev-server] stop flag present — not starting"; exit 0; }

healthy() {
	curl -s -o /dev/null -m 5 -w '%{http_code}' "http://localhost:3000/" 2>/dev/null | grep -q '^2\|^3'
}

if healthy; then
	echo "[dev-server] healthy server already on :3000 — nothing to do"
	exit 0
fi

# Free an orphaned listener: server process died, socket still held. Any pid
# on :3000 at this point is by definition not a healthy server (healthy()
# already failed), so killing it is safe.
stale_pid=$(ss -ltnpH 'sport = :3000' 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true)
if [ -n "$stale_pid" ]; then
	echo "[dev-server] freeing orphaned port 3000 (pid $stale_pid)"
	kill -9 "$stale_pid" >/dev/null 2>&1 || true
	sleep 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] [dev-server] starting dev server (heap cap 1536MB)"
cd "$PROJECT_DIR"
NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=1536" \
NEXT_TELEMETRY_DISABLED=1 \
	setsid nohup bun run dev >>"$LOG" 2>&1 < /dev/null &
echo "[dev-server] launched (bun pid $!)"
