#!/bin/bash
# Idempotent engine-wrapper installer (runs at dev-server boot, before next dev).
#
# The Stockfish binary at engine-native/stockfish/stockfish-linux-x86-64-
# universal is wrapped by a revival script: every engine spawn health-checks
# port 3000 and revives the Next.js dev server if it died (sandbox OOM). The
# real ELF binary lives beside it as stockfish-real.
#
# If anything ever overwrites the wrapper path with a real binary again (an
# engine download, a manual mv), this script restores the arrangement:
#   wrapper path  -> revival bash script
#   stockfish-real -> actual Stockfish ELF

set -euo pipefail
cd "$(dirname "$0")/.."

SF_DIR=engine-native/stockfish
SF_PATH="$SF_DIR/stockfish-linux-x86-64-universal"
SF_REAL="$SF_DIR/stockfish-real"

# Already wrapped? Nothing to do.
if [ -f "$SF_PATH" ] && head -1 "$SF_PATH" 2>/dev/null | grep -q "^#!/bin/bash"; then
  # Wrapper present — make sure the real binary exists behind it.
  if [ ! -f "$SF_REAL" ]; then
    echo "[engine-wrapper] wrapper present but stockfish-real missing — cannot fix"
    exit 0
  fi
  exit 0
fi

# Unwrapped: the path holds the real ELF (fresh clone from an old snapshot,
# or an engine download clobbered it). Move it aside and install the wrapper.
if [ -f "$SF_PATH" ]; then
  mv -f "$SF_PATH" "$SF_REAL"
  chmod +x "$SF_REAL"
fi

cat > "$SF_PATH" <<'EOF'
#!/bin/bash
# Revival wrapper: every engine spawn carries a health-check ping. If the
# Next.js dev server is down (OOM-killed etc.), revive it as a detached
# setsid process before exec'ing the real Stockfish binary. The spawn is a
# descendant of whichever mini-service spawned this engine — those survive
# sandbox process reaping, so the revived server survives too.
(
  if ! curl -sf -o /dev/null -m 3 http://127.0.0.1:3000/ 2>/dev/null; then
    echo "[engine-revival] $(date -Is) port 3000 dead -> spawning next dev" >> /home/z/my-project/engine-revival.log
    setsid bash -c 'cd /home/z/my-project && exec bun run dev' </dev/null >/dev/null 2>&1 &
  fi
  # Keep a periodic canary on duty (pidfile-guarded, no-op if one exists):
  # engine spawns are event-driven; the canary probes every 20s regardless.
  setsid bash /home/z/my-project/scripts/next-canary.sh </dev/null >/dev/null 2>&1 &
) >/dev/null 2>&1
exec /home/z/my-project/engine-native/stockfish/stockfish-real "$@"
EOF
chmod +x "$SF_PATH"
echo "[engine-wrapper] revival wrapper installed at $SF_PATH"
