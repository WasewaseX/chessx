#!/bin/bash
# ChessX dev boot script (sandbox entry: /start.sh -> .zscripts/dev.sh).
#
# WHY THIS EXISTS — the "session init failed" root-cause fix (Oct 24):
# dmesg proof:  Out of memory: Killed process 1693 (next-server) anon-rss:3.44GB
# on a 3.9GB box, seconds after boot, during the first webpack compile.
# The old script launched `bun run dev &`, health-checked ONCE, then exited —
# so when the kernel OOM-killed next-server, NOTHING brought it back and the
# preview panel reported "session init failed" / "render failed" until the
# whole sandbox was restarted.
#
# Architecture (PID-tree-free supervision — see scripts/dev-watchdog.sh):
#   1. bun install + db:push (db:push failure warns, never aborts boot)
#   2. scripts/dev-server.sh — idempotent detached start (frees orphaned
#      port, heap-caps node at 1536MB, logs to dev.log)
#   3. readiness + WARM-UP: compile `/` and `/api/auth/me` from the boot
#      flow itself so the user's preview never races a cold compile
#   4. mini-services
#   5. exec into scripts/dev-watchdog.sh — HTTP-health supervision for the
#      whole sandbox lifetime (restart on death, backoff, stop-flag)
#
# Manual off switch: `touch .zscripts/dev.stop` — remove the file to re-arm.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STOP_FLAG="$SCRIPT_DIR/dev.stop"

# Anti-OOM heap cap for every node process in this tree (V8 heap, not RSS).
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=1536"
export NEXT_TELEMETRY_DISABLED=1

log_step_start() {
        local step_name="$1"
        echo "=========================================="
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting: $step_name"
        echo "=========================================="
        export STEP_START_TIME
        STEP_START_TIME=$(date +%s)
}

log_step_end() {
        local step_name="${1:-Unknown step}"
        local end_time
        end_time=$(date +%s)
        local duration=$((end_time - STEP_START_TIME))
        echo "=========================================="
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Completed: $step_name"
        echo "[LOG] Step: $step_name | Duration: ${duration}s"
        echo "=========================================="
        echo ""
}

start_mini_services() {
        local mini_services_dir="$PROJECT_DIR/mini-services"
        local started_count=0

        log_step_start "Starting mini-services"
        if [ ! -d "$mini_services_dir" ]; then
                echo "Mini-services directory not found, skipping..."
                log_step_end "Starting mini-services"
                return 0
        fi

<<<<<<< HEAD
        echo "Found mini-services directory, scanning for sub-services..."

        for service_dir in "$mini_services_dir"/*; do
                if [ ! -d "$service_dir" ]; then
                        continue
                fi

                local service_name
                service_name=$(basename "$service_dir")
                echo "Checking service: $service_name"

                if [ ! -f "$service_dir/package.json" ]; then
                        echo "[$service_name] No package.json found, skipping..."
                        continue
                fi

                if ! grep -q '"dev"' "$service_dir/package.json"; then
                        echo "[$service_name] No dev script found, skipping..."
                        continue
                fi

                echo "Starting $service_name in background..."
                (
                        cd "$service_dir"
                        echo "[$service_name] Installing dependencies..."
                        bun install
                        echo "[$service_name] Running bun run dev..."
                        exec bun run dev
                ) >"$PROJECT_DIR/.zscripts/mini-service-${service_name}.log" 2>&1 &

                local service_pid=$!
                echo "[$service_name] Started in background (PID: $service_pid)"
                echo "[$service_name] Log: $PROJECT_DIR/.zscripts/mini-service-${service_name}.log"
                disown "$service_pid" 2>/dev/null || true
                started_count=$((started_count + 1))
        done

=======
        for service_dir in "$mini_services_dir"/*; do
                if [ ! -d "$service_dir" ]; then continue; fi
                local service_name
                service_name=$(basename "$service_dir")
                if [ ! -f "$service_dir/package.json" ]; then
                        echo "[$service_name] No package.json found, skipping..."
                        continue
                fi
                if ! grep -q '"dev"' "$service_dir/package.json"; then
                        echo "[$service_name] No dev script found, skipping..."
                        continue
                fi
                # Idempotency: if the service port already answers, skip. A restart of
                # this script must not double-bind sockets (EADDRINUSE crash loops).
                # The port is hardcoded in each service's index.ts (const PORT = nnnn).
                local port=""
                port=$(grep -hoP 'const PORT = \K[0-9]+' "$service_dir/index.ts" 2>/dev/null | head -1 || true)
                if [ -n "$port" ] && curl -s -o /dev/null -m 2 "http://localhost:$port/" 2>/dev/null; then
                        echo "[$service_name] port $port already answering — skipping"
                        continue
                fi

                echo "Starting $service_name in background..."
                (
                        cd "$service_dir"
                        bun install >/dev/null 2>&1 || true
                        exec bun run dev
                ) >"$SCRIPT_DIR/mini-service-${service_name}.log" 2>&1 &
                local service_pid=$!
                echo "[$service_name] Started in background (PID: $service_pid)"
                started_count=$((started_count + 1))
        done

>>>>>>> 183ec7a (boot: root out 'session init failed' — OOM-proof dev server)
        echo "Mini-services startup completed. Started $started_count service(s)."
        log_step_end "Starting mini-services"
}

<<<<<<< HEAD
wait_for_service() {
        local host="$1"
        local port="$2"
        local service_name="$3"
        local max_attempts="${4:-60}"
        local attempt=1

        echo "Waiting for $service_name to be ready on $host:$port..."

        while [ "$attempt" -le "$max_attempts" ]; do
                if curl -s --connect-timeout 2 --max-time 5 "http://$host:$port" >/dev/null 2>&1; then
                        echo "$service_name is ready!"
                        return 0
                fi

                echo "Attempt $attempt/$max_attempts: $service_name not ready yet, waiting..."
                sleep 1
                attempt=$((attempt + 1))
        done

        echo "ERROR: $service_name failed to start within $max_attempts seconds"
        return 1
}

cleanup() {
        if [ -n "${DEV_PID:-}" ] && kill -0 "$DEV_PID" >/dev/null 2>&1; then
                echo "Stopping Next.js dev server (PID: $DEV_PID)..."
                kill "$DEV_PID" >/dev/null 2>&1 || true
        fi
=======
wait_until_healthy() {
        local max_attempts="${1:-150}"
        local attempt=1
        while [ "$attempt" -le "$max_attempts" ]; do
                local code
                code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://localhost:3000/" 2>/dev/null || true)
                if [ "$code" ] && [[ "$code" == 2* || "$code" == 3* ]]; then
                        echo "Next.js dev server healthy (HTTP $code, attempt $attempt)"
                        return 0
                fi
                sleep 2
                attempt=$((attempt + 1))
        done
        echo "WARNING: dev server not healthy after $((max_attempts * 2))s"
        return 1
}

warm_up() {
        # Compile the entry routes from the boot flow itself: `/` is the page the
        # preview panel opens; /api/auth/me is the first XHR the app fires. After
        # this, the first user request is a cache hit — the platform health
        # deadline is never spent on a cold compile again.
        log_step_start "Warm-up compile"
        curl -s -m 240 -o /dev/null -w "[warm] GET / -> %{http_code} in %{time_total}s\n" "http://localhost:3000/" || echo "[warm] / warm-up request failed (watchdog will keep retrying)"
        curl -s -m 90 -o /dev/null -w "[warm] GET /api/auth/me -> %{http_code} in %{time_total}s\n" "http://localhost:3000/api/auth/me" || echo "[warm] /api/auth/me warm-up request failed"
        log_step_end "Warm-up compile"
>>>>>>> 183ec7a (boot: root out 'session init failed' — OOM-proof dev server)
}

rm -f "$STOP_FLAG"

cd "$PROJECT_DIR"

if ! command -v bun >/dev/null 2>&1; then
        echo "ERROR: bun is not installed or not in PATH"
        exit 1
fi

log_step_start "bun install"
bun install
log_step_end "bun install"

log_step_start "bun run db:push"
# Schema sync must NEVER abort the boot: a failed push is a warning (the
# server tolerates minor drift and the GitHub snapshot guards data), while a
# dead boot flow = "session init failed" for the user.
bun run db:push || echo "WARNING: db:push failed (schema drift) — continuing boot; fix the schema drift at the next edit"
log_step_end "bun run db:push"

<<<<<<< HEAD
log_step_start "Engine revival wrapper"
# Ensure the Stockfish binary is wrapped with the revival script (idempotent).
# Every engine spawn then health-checks port 3000 and revives the dev server
# if the sandbox OOM-killer took it down; a canary probes every 20s as well.
bash scripts/install-engine-wrapper.sh || true
log_step_end "Engine revival wrapper"

log_step_start "Starting Next.js dev server"
echo "[BUN] Starting development server..."
bun run dev &
DEV_PID=$!
log_step_end "Starting Next.js dev server"
=======
log_step_start "Starting dev server"
bash "$PROJECT_DIR/scripts/dev-server.sh"
log_step_end "Starting dev server"
>>>>>>> 183ec7a (boot: root out 'session init failed' — OOM-proof dev server)

if wait_until_healthy 150; then
        warm_up
        start_mini_services
        echo "ChessX is up; handing over to the HTTP-health watchdog."
else
        start_mini_services
        echo "ERROR: dev server did not become healthy; watchdog takes over retry duty."
fi

<<<<<<< HEAD
log_step_start "Health check"
echo "[BUN] Performing health check..."
curl -fsS localhost:3000 >/dev/null
echo "[BUN] Health check passed"
log_step_end "Health check"

start_mini_services

# Self-healing watchdog — DISABLED here on purpose.
#
# History: this used to arm scripts/dev-watchdog.sh (setsid'd bash probe
# loop) at boot. On the 2026-10-23 boot it armed, then died silently before
# writing a single log line (scripts/watchdog.log stayed empty while the dev
# server it was supposed to guard was OOM-killed at 11:01 — the site stayed
# down until the user reported "render failed again"). Root cause unknown.
#
# The single watchdog now lives inside the game-service mini-service
# (mini-services/game-service/index.ts): it is a boot-surviving bun process
# (proven alive across the whole session), hot-reload-safe via a globalThis
# guard, probes :3000 every 20s and respawns `bun run dev` detached with a
# 90s cooldown. Exactly ONE watchdog must run — two would fight over
# restarts. If you ever re-enable this block, remove the game-service
# watchdog first.
if false; then
        echo "(watchdog arming disabled — game-service watchdog is the single guard)"
fi

echo "Next.js dev server is running in background (PID: $DEV_PID)."
echo "Use 'kill $DEV_PID' to stop it."
disown "$DEV_PID" 2>/dev/null || true
unset DEV_PID
=======
# Become the watchdog. exec replaces this shell: sandbox shutdown signals hit
# the watchdog directly, and there is exactly ONE long-lived boot process.
exec bash "$PROJECT_DIR/scripts/dev-watchdog.sh"
>>>>>>> 183ec7a (boot: root out 'session init failed' — OOM-proof dev server)
