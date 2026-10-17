# chessx-api

Blocking Rust client for the [ChessX](https://chess.com-style ChessX app) **public API** — a small
key-less, read-only JSON surface over ChessX's Stockfish 19 engine and its Lichess puzzle bank.

**Rate limit:** 30 requests per minute per IP, no key required. Every response carries
`X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers; the client surfaces the
last observed values via `rate_limit()` and `rate_limit_remaining()`.

## Endpoints wrapped

| Method | Path | Client method |
| ------ | ---- | ------------- |
| GET | `/api/public/puzzles/daily` | `daily_puzzle()` |
| GET | `/api/public/puzzles?rating=&themes=` | `puzzles(rating, themes)` |
| POST | `/api/public/position/eval` | `position_eval(fen, depth)` |
| GET/POST | `/api/public/opening/identify` | `identify_opening(moves)` |
| GET | `/api/public/leaderboard` | `leaderboard()` |

Errors are a single `ChessxError` enum; HTTP 429 is its own variant with the server's
`Retry-After` value when present.

## Usage

```rust
use chessx_api::ChessxClient;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = ChessxClient::new("http://localhost:3000");

    // Today's deterministic daily puzzle (spoiler-free).
    let daily = client.daily_puzzle()?;
    println!("Daily ({}): {} — {:?}", daily.rating, daily.fen, daily.themes);

    // Browse the bank: 10 puzzles around rating 1200 tagged mate/fork.
    let page = client.puzzles(1200, &["mate", "fork"])?;
    println!("{} of {} puzzles available", page.count, page.total_available);

    // Engine evaluation of the starting position (depth clamped 6-18 server-side).
    let eval = client.position_eval(
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        Some(12),
    )?;
    println!("best {} ({})", eval.best_move.san.unwrap_or_default(), eval.best_move.uci);

    // ECO identification.
    let opening = client.identify_opening(&["e4", "e5", "Nf3", "Nc6", "Bb5"])?;
    println!("{} {}", opening.eco.unwrap_or_default(), opening.name.unwrap_or_default());

    // Leaderboard (public display names only).
    for leader in client.leaderboard()?.leaders {
        println!("{} — {} ({} solved)", leader.name, leader.puzzle_rating, leader.solved);
    }

    Ok(())
}
```

A runnable version ships as an example:

```sh
cargo run --example quickstart                # against http://localhost:3000
cargo run --example quickstart -- https://your-chessx-host
```

Add to your `Cargo.toml` (once published):

```toml
[dependencies]
chessx-api = "0.1"
```

Or straight from a checkout:

```toml
[dependencies]
chessx-api = { path = "../path/to/rust-client" }
```

## Publishing to crates.io

The crate ships as a plain source package; the standard flow applies.

1. **Verify the package locally**

   ```sh
   cargo package --list        # inspect what would be packed into the .crate
   cargo test                  # compile + run any tests
   cargo publish --dry-run     # full publish rehearsal
   ```

2. **Log in once** (token from <https://crates.io/settings/tokens>)

   ```sh
   cargo login <your-token>
   ```

3. **Publish** — `cargo publish` builds and uploads the source distribution (`.crate` sdist) to
   crates.io. There is no binary to build server-side; the sdist is the artifact:

   ```sh
   cargo publish
   ```

4. **Versioning** — bump `version` in `Cargo.toml` for every release; crates.io rejects duplicate
   versions. The API is additive: new fields on response structs are ignorable by serde only when
   declared with `#[serde(default)]`, so patch releases stay compatible.

## Notes

- **Blocking I/O** — the client uses `reqwest`'s blocking client. Fine for scripts and CLIs; for
  async runtimes, wrap calls in `tokio::task::spawn_blocking` (or ask for an async client).
- **Engine latency** — `position_eval` runs a real Stockfish search; depth 18 can take a few
  seconds. The default 60 s HTTP timeout comfortably covers the clamped 6-18 range.
- **Honest payloads** — puzzle rows never contain the solution; `move_count` is the count only.
