# One-shot importer: streams the official Lichess puzzle dump
# (database.lichess.org/lichess_db_puzzle.csv.zst, ~4.5M puzzles) straight
# into the app's SQLite database as the LichessPuzzle table.
#
#   python3 scripts/import-lichess-puzzles.py [path/to/lichess_db_puzzle.csv.zst]
#
# Requires: pip3 install --break-system-packages zstandard
# No intermediate uncompressed file: the zstd stream is decoded incrementally
# and fed straight into batched executemany() inserts.
import json
import os
import sqlite3
import sys
import time

try:
    import zstandard as zstd
except ImportError:
    print("zstandard missing: pip3 install --break-system-packages zstandard")
    sys.exit(1)

DEFAULT_DUMP = "data/lichess_db_puzzle.csv.zst"
dump_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", DEFAULT_DUMP)
dump_path = os.path.abspath(dump_path)

if not os.path.exists(dump_path):
    print(f"Dump not found: {dump_path}")
    print("Fetch it first:  curl -L -o data/lichess_db_puzzle.csv.zst https://database.lichess.org/lichess_db_puzzle.csv.zst")
    sys.exit(1)

# DATABASE_URL looks like file:/abs/path.db
db_url = os.environ.get("DATABASE_URL", "file:./db/custom.db")
db_file = db_url.replace("file:", "", 1) or "db/custom.db"
if not os.path.isabs(db_file):
    db_file = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", db_file))
if not os.path.exists(db_file):
    print(f"DATABASE_URL does not point at an existing SQLite file: {db_url}")
    sys.exit(1)

print(f"[import] dump:   {dump_path} ({os.path.getsize(dump_path) / 1e6:.1f} MB)")
print(f"[import] target: {db_file}")

conn = sqlite3.connect(db_file, isolation_level=None)  # autocommit; we manage transactions
conn.execute("PRAGMA journal_mode=WAL")
conn.execute("PRAGMA synchronous=NORMAL")
conn.execute("PRAGMA cache_size=-65536")  # 64MB page cache

conn.execute(
    """CREATE TABLE IF NOT EXISTS "LichessPuzzle" (
  "id" INTEGER PRIMARY KEY,
  "fen" TEXT NOT NULL,
  "solutionUci" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "deviation" INTEGER NOT NULL,
  "popularity" INTEGER NOT NULL,
  "plays" INTEGER NOT NULL,
  "themes" TEXT NOT NULL,
  "gameUrl" TEXT NOT NULL,
  "openingTags" TEXT NOT NULL
)"""
)
conn.execute('CREATE INDEX IF NOT EXISTS "LichessPuzzle_rating_idx" ON "LichessPuzzle"("rating")')
conn.execute('CREATE INDEX IF NOT EXISTS "LichessPuzzle_popularity_idx" ON "LichessPuzzle"("popularity")')

before = conn.execute("SELECT COUNT(*) FROM LichessPuzzle").fetchone()[0]
print(f"[import] rows already present: {before}")

INSERT = (
    "INSERT OR IGNORE INTO LichessPuzzle (id, fen, solutionUci, rating, deviation, popularity, plays, themes, gameUrl, openingTags) "
    "VALUES (?,?,?,?,?,?,?,?,?,?)"
)

BATCH = 25_000
# Resume support: skip this many data lines before inserting (already imported).
SKIP_LINES = int(os.environ.get("SKIP_LINES", "0"))
total = 0
inserted_total = 0
theme_counts = {}

t0 = time.time()


def flush(rows):
    global inserted_total
    conn.execute("BEGIN IMMEDIATE")
    conn.executemany(INSERT, rows)
    conn.execute("COMMIT")
    inserted_total += len(rows)


def split_csv10(line):
    # PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags[,DailyDate]
    # FEN/Moves/Themes contain no commas; OpeningTags may. Take first 9 exact
    # commas, the rest is OpeningTags(+DailyDate, dropped).
    parts = line.split(",", 9)
    return parts


with open(dump_path, "rb") as fh:
    dctx = zstd.ZstdDecompressor(max_window_size=2 ** 31)
    reader = dctx.stream_reader(fh, read_across_frames=True)
    header_seen = False
    batch = []
    buf = b""
    while True:
        chunk = reader.read(1 << 22)  # 4MB
        if not chunk:
            break
        buf += chunk
        # process complete lines only; keep the tail for the next chunk
        end = buf.rfind(b"\n")
        if end == -1:
            continue
        block, buf = buf[:end], buf[end + 1:]
        for line in block.split(b"\n"):
            line = line.strip(b"\r").decode("utf-8", "replace")
            if not line:
                continue
            if not header_seen:
                header_seen = True
                if line.startswith("PuzzleId"):
                    continue
            if SKIP_LINES and total < SKIP_LINES:
                total += 1
                continue
            p = split_csv10(line)
            if len(p) < 9:
                continue
            try:
                pid = p[0]
                if not pid or len(pid) > 12:
                    continue
                rating = int(p[3])
                deviation = int(p[4])
                popularity = int(p[5])
                plays = int(p[6])
            except ValueError:
                continue
            themes = p[7] or ""
            batch.append((pid, p[1], p[2], rating, deviation, popularity, plays, themes, p[8] or "", p[9] if len(p) > 9 else ""))
            total += 1
            if themes:
                for t in themes.split(" "):
                    if t:
                        theme_counts[t] = theme_counts.get(t, 0) + 1
            if len(batch) >= BATCH:
                flush(batch)
                batch = []
                rate = int(total / max(1e-6, time.time() - t0))
                print(f"\r[import] {total:,} lines, {rate:,}/s   ", end="", flush=True)
    # tail line (last row has no trailing newline guard)
    if buf:
        line = buf.strip(b"\r").decode("utf-8", "replace")
        if line and not line.startswith("PuzzleId"):
            p = split_csv10(line)
            if len(p) >= 9:
                try:
                    pid = p[0]
                    if pid and len(pid) <= 12:
                        batch.append((pid, p[1], p[2], int(p[3]), int(p[4]), int(p[5]), int(p[6]), p[7] or "", p[8] or "", p[9] if len(p) > 9 else ""))
                        total += 1
                except ValueError:
                    pass
    if batch:
        flush(batch)
        batch = []

after = conn.execute("SELECT COUNT(*) FROM LichessPuzzle").fetchone()[0]
secs = time.time() - t0
print(f"\n[import] done in {secs:.1f}s: {total:,} lines read, {inserted_total:,} newly inserted, table now {after:,} rows")

out_path = os.path.join(os.path.dirname(__file__), "..", "data", "lichess-summary.json")
summary = {
    "total": after,
    "themes": dict(sorted(theme_counts.items(), key=lambda kv: -kv[1])),
    "importedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}
with open(out_path, "w") as f:
    json.dump(summary, f)
print(f"[import] theme summary written to {os.path.abspath(out_path)}")
conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
conn.close()
