//! Blocking Rust client for the ChessX public API.
//!
//! ChessX exposes a small key-less, read-only JSON API (30 requests per
//! minute per IP, CORS open) over its Stockfish engine and its Lichess
//! puzzle bank. This crate wraps the five endpoints with typed responses
//! and surfaces the server's `X-RateLimit-Limit` / `X-RateLimit-Remaining`
//! headers after every call.
//!
//! ```no_run
//! use chessx_api::ChessxClient;
//!
//! let client = ChessxClient::new("http://localhost:3000");
//! let daily = client.daily_puzzle()?;
//! println!("Today's puzzle ({}): {}", daily.rating, daily.fen);
//!
//! let eval = client.position_eval(
//!     "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
//!     Some(8),
//! )?;
//! println!("Best move: {}", eval.best_move.uci);
//! # Ok::<(), chessx_api::ChessxError>(())
//! ```

use std::sync::atomic::{AtomicI64, Ordering};

use reqwest::blocking::{Client, Response};
use reqwest::{StatusCode, Url};
use serde::{de::DeserializeOwned, Deserialize, Serialize};

const DEFAULT_TIMEOUT_SECS: u64 = 60;
const RATE_UNKNOWN: i64 = -1;

// ---------------------------------------------------------------------------
// Response types (the server speaks camelCase; serde maps to snake_case)
// ---------------------------------------------------------------------------

/// One spoiler-free puzzle row: position, rating, themes and the solution's
/// move COUNT — never the solution itself, never the title.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PuzzleRow {
    pub id: String,
    pub fen: String,
    pub rating: i64,
    pub themes: Vec<String>,
    pub move_count: i64,
}

/// `GET /api/public/puzzles/daily`
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyPuzzle {
    pub id: String,
    pub fen: String,
    pub rating: i64,
    pub themes: Vec<String>,
    pub move_count: i64,
}

/// `GET /api/public/puzzles`
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PuzzlesResponse {
    /// Rows actually returned (always 10 while the bank is installed).
    pub count: i64,
    pub puzzles: Vec<PuzzleRow>,
    /// Honest size of the whole puzzle bank.
    pub total_available: i64,
}

/// The engine's best move in UCI ("e2e4") and SAN ("Nf3", when replayable).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BestMove {
    pub uci: String,
    pub san: Option<String>,
}

/// `POST /api/public/position/eval`
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionEval {
    pub fen: String,
    /// The deepest depth the search actually reported (may be below the ask).
    pub depth_reached: i64,
    pub best_move: BestMove,
    /// Centipawns from the side to move's POV; mate scores are huge.
    pub score_cp: i64,
    /// Some(1) when the side to move is mating, Some(-1) when it is getting
    /// mated, None when the score is not a mate score.
    pub mate: Option<i64>,
    pub pv_san: Vec<String>,
}

/// `GET|POST /api/public/opening/identify`
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpeningIdentity {
    pub eco: Option<String>,
    pub name: Option<String>,
    /// Plies of the matched table entry (0 when nothing matched).
    pub matched_plies: i64,
}

/// One leaderboard row — public display name only, no account metadata.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Leader {
    pub name: String,
    pub puzzle_rating: i64,
    pub solved: i64,
}

/// `GET /api/public/leaderboard`
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardResponse {
    pub leaders: Vec<Leader>,
}

#[derive(Debug, Clone, Deserialize)]
struct ApiError {
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct PositionEvalRequest<'a> {
    fen: &'a str,
    depth: Option<i64>,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Everything that can go wrong, with the 429 case spelled out because it is
/// the one every script eventually hits.
#[derive(Debug)]
pub enum ChessxError {
    /// Non-2xx, non-429 answer from the server (400 bad input, 404 no bank, 503 no engine…).
    Api { status: u16, message: String },
    /// HTTP 429 — the 30 req/min budget is exhausted for this IP.
    RateLimited { message: String, retry_after_secs: Option<u64> },
    /// Connection or timeout failure.
    Network(String),
    /// The body was not the JSON the docs promise.
    Parse(String),
}

impl std::fmt::Display for ChessxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ChessxError::Api { status, message } => write!(f, "server returned HTTP {status}: {message}"),
            ChessxError::RateLimited { message, retry_after_secs } => match retry_after_secs {
                Some(secs) => write!(f, "rate limited (429): {message} — retry after {secs}s"),
                None => write!(f, "rate limited (429): {message}"),
            },
            ChessxError::Network(msg) => write!(f, "request failed: {msg}"),
            ChessxError::Parse(msg) => write!(f, "unexpected response body: {msg}"),
        }
    }
}

impl std::error::Error for ChessxError {}

impl From<reqwest::Error> for ChessxError {
    fn from(e: reqwest::Error) -> Self {
        ChessxError::Network(e.to_string())
    }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

fn header_i64(resp: &Response, name: &str) -> Option<i64> {
    resp.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<i64>().ok())
}

fn read_atomic(cell: &AtomicI64) -> Option<i64> {
    let v = cell.load(Ordering::Relaxed);
    if v < 0 { None } else { Some(v) }
}

/// Blocking client for the ChessX public API. Create one per process and
/// reuse it: it remembers the last observed rate-limit window.
pub struct ChessxClient {
    base_url: String,
    http: Client,
    rate_limit: AtomicI64,
    rate_remaining: AtomicI64,
}

impl ChessxClient {
    /// Point at a ChessX origin, e.g. `ChessxClient::new("http://localhost:3000")`.
    /// The base must be an absolute http(s) URL without a trailing slash.
    ///
    /// # Panics
    /// Panics when `base_url` is not a parseable absolute URL.
    pub fn new(base_url: &str) -> Self {
        let trimmed = base_url.trim_end_matches('/');
        // Fail loudly and early on a malformed base: every later call would
        // otherwise fail with a much less obvious message.
        let parsed = Url::parse(trimmed).expect("ChessxClient::new: base_url must be an absolute http(s) URL");
        debug_assert!(matches!(parsed.scheme(), "http" | "https"), "base_url must be http(s)");
        let http = Client::builder()
            .timeout(std::time::Duration::from_secs(DEFAULT_TIMEOUT_SECS))
            .build()
            .unwrap_or_else(|_| Client::new());
        ChessxClient {
            base_url: trimmed.to_string(),
            http,
            rate_limit: AtomicI64::new(RATE_UNKNOWN),
            rate_remaining: AtomicI64::new(RATE_UNKNOWN),
        }
    }

    /// Last observed `X-RateLimit-Limit` (None before the first response).
    pub fn rate_limit(&self) -> Option<i64> {
        read_atomic(&self.rate_limit)
    }

    /// Last observed `X-RateLimit-Remaining` (None before the first response).
    pub fn rate_limit_remaining(&self) -> Option<i64> {
        read_atomic(&self.rate_remaining)
    }

    fn url(&self, path: &str) -> Url {
        Url::parse(&format!("{}{}", self.base_url, path)).expect("base_url + known path is a valid URL")
    }

    fn observe_rate_limit(&self, resp: &Response) {
        if let Some(v) = header_i64(resp, "x-ratelimit-limit") {
            self.rate_limit.store(v, Ordering::Relaxed);
        }
        if let Some(v) = header_i64(resp, "x-ratelimit-remaining") {
            self.rate_remaining.store(v, Ordering::Relaxed);
        }
    }

    fn send_json<T: DeserializeOwned>(&self, resp: Response) -> Result<T, ChessxError> {
        let status = resp.status();
        let retry_after = if status == StatusCode::TOO_MANY_REQUESTS {
            resp.headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
        } else {
            None
        };
        let body = resp.text().map_err(|e| ChessxError::Network(e.to_string()))?;
        if status == StatusCode::TOO_MANY_REQUESTS {
            let message = serde_json::from_str::<ApiError>(&body)
                .ok()
                .and_then(|e| e.error)
                .unwrap_or_else(|| "rate limit exceeded: 30 requests per minute per IP".to_string());
            return Err(ChessxError::RateLimited { message, retry_after_secs: retry_after });
        }
        if !status.is_success() {
            let message = serde_json::from_str::<ApiError>(&body)
                .ok()
                .and_then(|e| e.error)
                .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
            return Err(ChessxError::Api { status: status.as_u16(), message });
        }
        serde_json::from_str(&body).map_err(|e| ChessxError::Parse(e.to_string()))
    }

    /// Today's deterministic daily puzzle — the same position for everyone,
    /// spoiler-free (no solution, no title).
    pub fn daily_puzzle(&self) -> Result<DailyPuzzle, ChessxError> {
        let resp = self.http.get(self.url("/api/public/puzzles/daily")).send()?;
        self.observe_rate_limit(&resp);
        self.send_json(resp)
    }

    /// Ten puzzles around `rating` (the server clamps to 600-2800),
    /// optionally filtered by up to five theme ids, e.g. `&["mate", "fork"]`.
    pub fn puzzles(&self, rating: i64, themes: &[&str]) -> Result<PuzzlesResponse, ChessxError> {
        let mut url = self.url("/api/public/puzzles");
        url.query_pairs_mut().append_pair("rating", &rating.to_string());
        if !themes.is_empty() {
            url.query_pairs_mut().append_pair("themes", &themes.join(","));
        }
        let resp = self.http.get(url).send()?;
        self.observe_rate_limit(&resp);
        self.send_json(resp)
    }

    /// Engine evaluation of a FEN. `depth` is clamped server-side to 6-18
    /// (default 12); None asks for the default.
    pub fn position_eval(&self, fen: &str, depth: Option<i64>) -> Result<PositionEval, ChessxError> {
        let resp = self
            .http
            .post(self.url("/api/public/position/eval"))
            .json(&PositionEvalRequest { fen, depth })
            .send()?;
        self.observe_rate_limit(&resp);
        self.send_json(resp)
    }

    /// Match a move list (e.g. `&["e4", "e5", "Nf3", "Nc6", "Bb5"]`) against
    /// the ECO table. Move numbers are tolerated by the server.
    pub fn identify_opening(&self, moves: &[&str]) -> Result<OpeningIdentity, ChessxError> {
        let mut url = self.url("/api/public/opening/identify");
        url.query_pairs_mut().append_pair("moves", &moves.join(","));
        let resp = self.http.get(url).send()?;
        self.observe_rate_limit(&resp);
        self.send_json(resp)
    }

    /// Top 20 puzzle solvers — public display names only.
    pub fn leaderboard(&self) -> Result<LeaderboardResponse, ChessxError> {
        let resp = self.http.get(self.url("/api/public/leaderboard")).send()?;
        self.observe_rate_limit(&resp);
        self.send_json(resp)
    }
}
