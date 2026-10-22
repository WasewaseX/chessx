#!/usr/bin/env bash
# Render Watchdog — "always make sure it renders"
#
# Standing guarantee that the ChessX dev server is alive AND actually rendering.
# - Probes http://localhost:3000/ every PROBE_INTERVAL seconds.
# - A probe passes only on HTTP 200 with a non-trivial HTML body (catches
#   half-dead servers that accept connections but render nothing).
# - After FAIL_THRESHOLD consecutive failures it restarts the dev server
#   (kills stale listeners on :3000, then relaunches `bun run dev` detached).
# - Every action is logged to logs/render-watchdog.log and never exits.
#
# Usage:  setsid bash scripts/render-watchdog.sh >/dev/null 2>&1 &

PROBE_INTERVAL="${PROBE_INTERVAL:-30}"
FAIL_THRESHOLD="${FAIL_THRESHOLD:-3}"
APP_DIR="/home/z/my-project"
LOG_FILE="$APP_DIR/logs/render-watchdog.log"
URL="http://localhost:3000/"

mkdir -p "$APP_DIR/logs" "$APP_DIR/download"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

probe() {
  # -f fails on HTTP >= 400 or connection errors; capture body length too.
  local body
  body=$(curl -sf --max-time 20 "$URL" 2>/dev/null)
  local rc=$?
  if [ $rc -ne 0 ]; then
    return 1
  fi
  # Rendered page must contain the app root marker and be non-trivial.
  if [ "${#body}" -lt 500 ]; then
    return 1
  fi
  if ! printf '%s' "$body" | grep -qi 'ChessX\|__next\|id="__next"\|next-route-announcer'; then
    return 1
  fi
  return 0
}

start_server() {
  log "ACTION restarting dev server (killing stale listeners on :3000 first)"
  # Kill anything bound to :3000 (stale next-server / bun dev).
  local pids
  pids=$(ss -tlnp 2>/dev/null | awk '/:3000 /{print $NF}' | grep -oP 'pid=\K[0-9]+' | sort -u)
  for p in $pids; do
    log "ACTION killing pid $p (port 3000 holder)"
    kill -9 "$p" 2>/dev/null
  done
  # Also kill orphaned `bun run dev` / next-server processes for this app dir.
  pkill -9 -f "next-server" 2>/dev/null
  sleep 1
  cd "$APP_DIR" || { log "FATAL cannot cd $APP_DIR"; return 1; }
  ( setsid bun run dev >> dev.log 2>&1 & )
  log "ACTION dev server relaunch issued"
}

log "=== render-watchdog started (interval=${PROBE_INTERVAL}s, threshold=${FAIL_THRESHOLD}) ==="

fail_streak=0
while true; do
  if probe; then
    if [ "$fail_streak" -ge "$FAIL_THRESHOLD" ]; then
      log "RECOVERED server renders again after $fail_streak failures"
    fi
    if [ "$fail_streak" -gt 0 ]; then
      log "OK probe healthy (streak reset from $fail_streak)"
    fi
    fail_streak=0
  else
    fail_streak=$((fail_streak + 1))
    log "FAIL probe $fail_streak/$FAIL_THRESHOLD (no 200/rendered body from $URL)"
    if [ "$fail_streak" -ge "$FAIL_THRESHOLD" ]; then
      log "THRESHOLD reached — restarting"
      start_server
      fail_streak=0
      # Give the server time to boot + compile before probing again.
      sleep 45
    fi
  fi
  sleep "$PROBE_INTERVAL"
done
