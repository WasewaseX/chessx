#!/bin/bash
# ChessX dev boot script (sandbox entry: /start.sh -> .zscripts/dev.sh).
#
# MISSION — the "session init failed" / "render failed" class is dead:
# kernel evidence (dmesg, three separate incidents): the OOM killer took
# next-server (3.3-3.4GB RSS on a 3.9GB box) during the first post-boot
# compile, and nothing revived it — the preview panel reported "session
# init failed" until a full sandbox reboot.
#
# This boot script contributes the PREVENTION and WARM-UP layers:
#   1. bun install + db:push (db:push failure warns, never aborts boot)
#   2. scripts/dev-server.sh — idempotent detached start: frees an orphaned
#      port, heap-caps node (anti-OOM), appends to dev.log
#   3. WARM-UP: compiles `/` and `/api/auth/me` from the boot flow itself,
#      so the user's preview never races a cold compile against the
#      platform health deadline
#   4. mini-services (idempotent via port probes)
#
# SUPERVISION BELONGS ELSEWHERE — do NOT arm a bash watchdog here (an
# earlier revision did). Lessons, all learned the hard way (worklog tasks
# 18, 20, 23, 25, 26):
#   - processes spawned from agent tool calls are reaped at the tool-call
#     boundary (setsid/nohup/disown all tested);
#   - a bash watchdog was found dead SILENTLY on one boot before writing a
#     single log line;
#   - two restarters FIGHT: this script's starter kills whoever holds the
#     port, which can murder the platform watchdog's freshly spawned server.
# The ONE supervisor is mini-services/game-service/watchdog-child.ts:
# spawned by the platform-owned game-service (reaper-immune), pid-lockfile
# singleton, /proc guard (never double-spawns during a long compile), and a
# 10-minute hung-server kill. scripts/dev-server.sh and
# scripts/dev-watchdog.sh remain as MANUAL operator tools only (`bun run
# dev-server` / `bun run watchdog`).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Anti-OOM heap cap for every node process in this tree (V8 heap, not RSS).
# Belt and braces: the dev script in package.json carries the same cap so
# the platform watchdog's respawn path is capped too.
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

	echo "Mini-services startup completed. Started $started_count service(s)."
	log_step_end "Starting mini-services"
}

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
	curl -s -m 240 -o /dev/null -w "[warm] GET / -> %{http_code} in %{time_total}s\n" "http://localhost:3000/" || echo "[warm] / warm-up request failed (platform watchdog covers revival)"
	curl -s -m 90 -o /dev/null -w "[warm] GET /api/auth/me -> %{http_code} in %{time_total}s\n" "http://localhost:3000/api/auth/me" || echo "[warm] /api/auth/me warm-up request failed"
	log_step_end "Warm-up compile"
}

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
# dead boot flow = "session init failed" for the user. (Real incident: prisma
# refused to drop the dead OpeningProgress table and exited 1 under set -e.)
bun run db:push || echo "WARNING: db:push failed (schema drift) — continuing boot; fix the schema drift at the next edit"
log_step_end "bun run db:push"

log_step_start "Starting dev server"
# Idempotent: healthy server on :3000 -> no-op; orphaned socket -> freed and
# restarted detached with the heap cap.
bash "$PROJECT_DIR/scripts/dev-server.sh"
log_step_end "Starting dev server"

if wait_until_healthy 150; then
	warm_up
	start_mini_services
	echo "ChessX is up. Server supervision belongs to the platform-owned watchdog."
else
	start_mini_services
	echo "ERROR: dev server did not become healthy; the platform watchdog keeps retrying."
fi
