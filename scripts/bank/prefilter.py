#!/usr/bin/env python3
"""Prefilter the lichess combined puzzle sample into verifier candidates.

Quality gates BEFORE the engine runs:
  - rating 500..2000, rating deviation <= 80, popularity >= 88, nb_plays >= 400
  - 3..7 plies total (1..3 solver moves after the opponent setup move)
  - at least one theme mapped to ChessX concepts
  - dedupe by board, spread across theme x rating-band buckets
All chess logic (legality, SAN) is left to the TypeScript verifier.
"""
import json, random

random.seed(11)

SRC = "/tmp/p50k.ndjson"
OUT = "/home/z/my-project/scripts/bank/candidates.json"
MAX_PER_BUCKET = 18

THEME_MAP = {
    "mate": "mate", "mateIn1": "mate", "mateIn2": "mate", "mateIn3": "mate",
    "backRankMate": "mate", "smotheredMate": "mate", "anastasiaMate": "mate",
    "arabianMate": "mate", "hookMate": "mate", "bodenMate": "mate",
    "doubleBishopMate": "mate", "dovetailMate": "mate",
    "kingsideAttack": "kingSafety",
    "fork": "fork", "skewer": "skewer", "pin": "pin",
    "discoveredAttack": "discoveredAttack", "doubleCheck": "doubleAttack",
    "sacrifice": "sacrifice", "removingDefender": "removingDefender",
    "deflection": "removingDefender",
    "promotion": "promotion", "underPromotion": "promotion",
    "endgame": "endgame",
    "hangingPiece": "winningMaterial", "trappedPiece": "winningMaterial",
    "intermezzo": "calculation", "quietMove": "calculation",
    "zugzwang": "zugzwang",
}

buckets = {}
seen_board = set()
n = 0
kept = 0
with open(SRC) as f:
    for line in f:
        n += 1
        try:
            row = json.loads(line)
        except Exception:
            continue
        p = row.get("puzzle") or {}
        try:
            rating = int(p.get("Rating") or 0)
            rd = int(p.get("RatingDeviation") or 999)
            pop = int(p.get("Popularity") or 0)
            plays = int(p.get("NbPlays") or 0)
        except Exception:
            continue
        if not (500 <= rating <= 2000) or rd > 90 or pop < 82 or plays < 300:
            continue
        themes = (p.get("Themes") or "").split()
        concepts = []
        for t in themes:
            c = THEME_MAP.get(t)
            if c and c not in concepts:
                concepts.append(c)
        if not concepts:
            continue
        moves = (p.get("Moves") or "").split()
        if not (3 <= len(moves) <= 7):
            continue
        fen = p.get("FEN") or ""
        if not fen or fen.split(" ")[0] in seen_board:
            continue
        if len(fen.split(" ")[0].replace("/", "")) > 30:
            continue
        seen_board.add(fen.split(" ")[0])
        game = row.get("game") or {}
        opening = ((game.get("opening") or {}).get("name") or "")
        players = game.get("players") or {}
        we = (players.get("white") or {}).get("rating")
        be = (players.get("black") or {}).get("rating")
        band = "low" if rating < 900 else ("mid" if rating < 1400 else "high")
        bucket_key = (concepts[0], band)
        b = buckets.setdefault(bucket_key, [])
        if len(b) >= MAX_PER_BUCKET:
            continue
        b.append({
            "id": p.get("PuzzleId"),
            "rootFen": fen,
            "setupUci": moves[0],
            "solutionUci": moves[1:],
            "rating": rating,
            "lichessThemes": themes,
            "concepts": concepts,
            "opening": opening,
            "whiteElo": we,
            "blackElo": be,
            "gameUrl": p.get("GameUrl"),
        })
        kept += 1

out = []
for k, v in sorted(buckets.items()):
    random.shuffle(v)
    out.extend(v)
random.shuffle(out)
with open(OUT, "w") as f:
    json.dump(out, f, indent=1)
print(f"scanned={n} kept={kept} buckets={len(buckets)} -> {OUT}")
for k in sorted(buckets):
    print(" ", k, len(buckets[k]))
