#!/bin/bash
# Next.js canary — periodic health probe + revival for the main dev server.
#
# Why: the sandbox OOM-kills next-server occasionally and nothing restarts it.
# The engine revival wrapper (engine-native/stockfish/stockfish-linux-x86-64-
# universal) revives on every engine spawn, but only when an engine is actually
# used. This canary closes the gap: it probes port 3000 every 20s and revives
# on two consecutive failures, independent of app usage.
#
# Spawned detached (setsid) by the engine wrapper and/or at dev-server boot;
# pidfile-guarded so only one instance ever runs. Lives as a PID-1 descendant,
# so it survives sandbox process reaping.
PIDFILE=/tmp/next-canary.pid
LOG=/home/z/my-project/next-supervisor.log

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  exit 0 # another canary is already on duty
fi
echo $$ > "$PIDFILE"
echo "[canary] $(date -Is) on duty (pid $$)" >> "$LOG"

FAILS=0
while true; do
  if curl -sf -o /dev/null -m 5 http://127.0.0.1:3000/ 2>/dev/null; then
    FAILS=0
  else
    FAILS=$((FAILS + 1))
    if [ "$FAILS" -ge 2 ]; then
      echo "[canary] $(date -Is) port 3000 down x$FAILS -> reviving next dev" >> "$LOG"
      setsid bash -c 'cd /home/z/my-project && exec bun run dev' </dev/null >/dev/null 2>&1 &
      FAILS=-8 # cool down ~3.3 min while next dev boots (gh-restore + compile)
    fi
  fi
  sleep 20
done
