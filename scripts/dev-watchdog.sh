#!/bin/bash
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
done
