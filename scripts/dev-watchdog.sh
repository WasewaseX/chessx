#!/usr/bin/env bash
# Dev-server watchdog: the sandbox OOM-killer has repeatedly murdered
# next-server (3.3GB RSS spikes during route compilation), leaving port 3000
# dead and the user staring at "render failed". This loop self-heals:
# every 15s, if :3000 does not answer, it restarts `bun run dev` detached.
#
# Start with:  setsid nohup bash scripts/dev-watchdog.sh >/dev/null 2>&1 &
# It logs restarts to scripts/watchdog.log (rotated at ~1000 lines).

LOG="$(dirname "$0")/watchdog.log"
STATE="$(dirname "$0")/watchdog.state"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
  # keep the log bounded
  if [ "$(wc -l < "$LOG")" -gt 1000 ]; then
    tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
}

check_alive() {
  curl -s -o /dev/null -m 8 http://127.0.0.1:3000/api/health 2>/dev/null && return 0
  curl -s -o /dev/null -m 8 http://127.0.0.1:3000/ 2>/dev/null && return 0
  return 1
}

start_server() {
  cd /home/z/my-project || return 1
  log "starting dev server (bun run dev, detached)"
  setsid nohup bun run dev >/dev/null 2>&1 &
  echo $! > "$STATE"
}

log "watchdog started (pid $$)"

# Wait for an already-running server before taking any action
boot_grace=true
while true; do
  if check_alive; then
    boot_grace=false
    sleep 15
    continue
  fi

  if [ "$boot_grace" = true ]; then
    # Give a freshly started server up to 90s to compile the first page
    boot_grace=false
    waited=0
    while [ $waited -lt 90 ]; do
      if check_alive; then break; fi
      sleep 5
      waited=$((waited + 5))
    done
    if check_alive; then
      log "existing server responded after grace period"
      continue
    fi
  fi

  log "server DOWN on :3000 - restarting"
  # Kill any stale wrappers so we don't stack duplicates
  pkill -f "next dev" 2>/dev/null
  sleep 2
  start_server

  # Wait for it to come up before resuming normal polling
  waited=0
  while [ $waited -lt 120 ]; do
    if check_alive; then
      log "server back UP after ${waited}s"
      break
    fi
    sleep 5
    waited=$((waited + 5))
  done
  if ! check_alive; then
    log "server still DOWN after 120s - will retry next cycle"
  fi
  sleep 15
done
