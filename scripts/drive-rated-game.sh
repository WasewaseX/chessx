#!/bin/bash
# Drives a full rated online game: browser player vs the scripted opponent.
set -e
cd /home/z/my-project

MY_UCIS=""
OPP_UCIS=""

click_square() {
  local sq="$1"
  local coords
  coords=$(agent-browser eval "(() => { const el = document.querySelector(\"[data-square='$sq']\"); if (!el) return null; const r = el.getBoundingClientRect(); return JSON.stringify([r.x + r.width/2, r.y + r.height/2]); })()" | tr -d '"')
  local x=$(echo "$coords" | sed 's/^\[//; s/,.*//')
  local y=$(echo "$coords" | sed 's/.*,//; s/\]//')
  agent-browser mouse move "$x" "$y" > /dev/null
  agent-browser mouse down > /dev/null
  agent-browser mouse up > /dev/null
  sleep 0.4
}

play_move() {
  local uci="$1"
  click_square "${uci:0:2}"
  sleep 0.4
  click_square "${uci:2:4}"
}

echo "=== waiting for match ==="
sleep 7

for i in 1 2 3 4 5 6 7; do
  echo "--- round $i: white to move ---"
  sleep 4
  OPP_UCIS=$(grep -oE "played [0-9]+: [a-h][1-8][a-h][1-8]" /tmp/opp.log | awk '{print $3}' | tail -20 | tr '\n' ' ')
  # interleave my moves (odd) with opponent moves (even)
  MOVES_JSON=$(bun -e "
const mine = '$MY_UCIS'.trim().split(/\s+/).filter(Boolean)
const opp = '$OPP_UCIS'.trim().split(/\s+/).filter(Boolean)
const seq = []
for (let i = 0; i < Math.max(mine.length, opp.length); i++) {
  if (mine[i]) seq.push(mine[i])
  if (opp[i]) seq.push(opp[i])
}
console.log(JSON.stringify(seq))
")
  UCI=$(bun scripts/compute-reply.ts "$MOVES_JSON")
  if [ -z "$UCI" ]; then echo "no legal move, stopping"; break; fi
  echo "white plays: $UCI  (seq: $MOVES_JSON)"
  play_move "$UCI"
  MY_UCIS="$MY_UCIS $UCI"
done

echo "=== waiting for game end ==="
sleep 9
agent-browser screenshot /tmp/shot-rated-end.png > /dev/null
tail -4 /tmp/opp.log
