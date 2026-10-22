#!/usr/bin/env bash
# Dev-server watchdog — "always make sure it renders" (consolidated)
#
# History: the sandbox OOM-killer repeatedly murdered next-server mid-session
# (3.3GB+ RSS spikes during route compilation), leaving port 3000 dead and the
# user staring at "render failed". Two watchdogs were built across sessions
# (render-watchdog.sh from the render-error sprint, dev-watchdog.sh from the
# OOM sprint); this file merges the best of both. Exactly ONE watchdog must
# run — two would fight over restarts and stack duplicate servers.
#
# Defense in depth:
#   1. V8 heap cap (NODE_OPTIONS=--max-old-space-size=2560 in package.json dev
#      script) keeps the server in aggressive-GC territory below the kernel
#      OOM threshold (measured steady-state RSS ~1.35GB).
#   2. This watchdog: probes every 15s; a pass requires HTTP 200 AND a real
#      rendered body (>500 bytes containing an app marker) — catches both
#      dead ports and half-dead servers that accept connections but render
#      nothing. After 2 consecutive failures it kills stale :3000 holders and
#      relaunches `bun run dev` as an init-parented orphan (the only process
#      shape the sandbox reaper does not kill).
#   3. .zscripts/dev.sh arms this watchdog automatically at every container
#      boot, so self-healing survives cold starts.
#
# Usage:  ( setsid bash scripts/dev-watchdog.sh >/dev/null 2>&1 & )
# Log:    scripts/watchdog.log (rotated at ~1000 lines)

APP_DIR="/home/z/my-project"
LOG="$APP_DIR/scripts/watchdog.log"
URL="http://127.0.0.1:3000/"
PROBE_INTERVAL=15
FAIL_THRESHOLD=2
BOOT_GRACE_SECS=90

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
  if [ "$(wc -l < "$LOG")" -gt 1000 ]; then
    tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
}

probe() {
  # Cheap liveness first: a dead port fails instantly.
  local body
  body=$(curl -sf --max-time 20 "$URL" 2>/dev/null)
  local rc=$?
  if [ $rc -ne 0 ]; then
    return 1
  fi
  # Render check: non-trivial body containing an app marker. Catches servers
  # that accept connections but serve error pages or empty shells.
  if [ "${#body}" -lt 500 ]; then
    return 1
  fi
  if ! printf '%s' "$body" | grep -qi 'ChessX\|__next\|next-route-announcer'; then
    return 1
  fi
  return 0
}

start_server() {
  log "ACTION restarting dev server"
  local pids
  pids=$(ss -tlnp 2>/dev/null | awk '/:3000 /{print $NF}' | grep -oP 'pid=\K[0-9]+' | sort -u)
  for p in $pids; do
    log "ACTION killing pid $p (port 3000 holder)"
    kill -9 "$p" 2>/dev/null
  done
  pkill -9 -f "next-server" 2>/dev/null
  pkill -9 -f "next dev" 2>/dev/null
  sleep 1
  cd "$APP_DIR" || { log "FATAL cannot cd $APP_DIR"; return 1; }
  # Double-fork + setsid: reparents to init so the sandbox process reaper
  # (which kills everything under the agent's shell within seconds) leaves it
  # alone. This is the same shape the boot flow uses.
  ( setsid bun run dev >> dev.log 2>&1 & )
  log "ACTION dev server relaunch issued (orphaned)"
}

wait_until_up() {
  local waited=0
  while [ $waited -lt 120 ]; do
    if probe; then
      log "server back UP after ~${waited}s"
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
  done
  return 1
}

log "=== dev-watchdog started (interval=${PROBE_INTERVAL}s, threshold=${FAIL_THRESHOLD}) ==="

fail_streak=0
boot_grace=true
while true; do
  if probe; then
    if [ "$fail_streak" -ge "$FAIL_THRESHOLD" ]; then
      log "RECOVERED server renders again after $fail_streak failures"
    fi
    fail_streak=0
    boot_grace=false
    sleep "$PROBE_INTERVAL"
    continue
  fi

  if [ "$boot_grace" = true ]; then
    # A freshly (re)started server may need up to BOOT_GRACE_SECS to compile
    # the first page before the probe can pass. Never stomp a booting server.
    log "server not answering during boot-grace window — waiting up to ${BOOT_GRACE_SECS}s"
    waited=0
    while [ $waited -lt "$BOOT_GRACE_SECS" ]; do
      if probe; then
        log "server responded during boot grace (after ~${waited}s)"
        break
      fi
      sleep 5
      waited=$((waited + 5))
    done
    if probe; then
      boot_grace=false
      fail_streak=0
      continue
    fi
    boot_grace=false
  fi

  fail_streak=$((fail_streak + 1))
  log "FAIL probe $fail_streak/$FAIL_THRESHOLD (no rendered body from $URL)"
  if [ "$fail_streak" -ge "$FAIL_THRESHOLD" ]; then
    start_server
    fail_streak=0
    if wait_until_up; then
      boot_grace=false
    else
      log "server still DOWN after relaunch + 120s — retrying next cycle"
    fi
    sleep "$PROBE_INTERVAL"
  else
    sleep "$PROBE_INTERVAL"
  fi
done
