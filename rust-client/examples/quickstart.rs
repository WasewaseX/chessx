//! Quickstart: today's puzzle + an evaluation of the starting position.
//!
//! Run against a local ChessX dev server (default http://localhost:3000):
//!
//! ```text
//! cargo run --example quickstart
//! cargo run --example quickstart -- https://your-chessx-host
//! ```

use chessx_api::ChessxClient;

const START_FEN: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

fn main() {
    let base = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "http://localhost:3000".to_string());
    let client = ChessxClient::new(&base);

    match client.daily_puzzle() {
        Ok(daily) => {
            println!(
                "Today's puzzle — id {} · rating {} · {} solution move(s)",
                daily.id, daily.rating, daily.move_count
            );
            println!("  FEN:    {}", daily.fen);
            println!(
                "  Themes: {}",
                if daily.themes.is_empty() { "-".to_string() } else { daily.themes.join(", ") }
            );
        }
        Err(e) => eprintln!("daily_puzzle failed: {e}"),
    }

    match client.position_eval(START_FEN, Some(8)) {
        Ok(eval) => {
            println!("\nStarting position, depth reached {}:", eval.depth_reached);
            println!(
                "  best:  {} ({})",
                eval.best_move.san.as_deref().unwrap_or("?"),
                eval.best_move.uci
            );
            println!("  score: {} cp (side to move)", eval.score_cp);
            println!(
                "  pv:    {}",
                if eval.pv_san.is_empty() { "-".to_string() } else { eval.pv_san.join(" ") }
            );
        }
        Err(e) => eprintln!("position_eval failed: {e}"),
    }

    match (client.rate_limit(), client.rate_limit_remaining()) {
        (Some(limit), Some(remaining)) => println!("\nRate limit: {remaining}/{limit} requests left this minute"),
        _ => println!("\nRate limit: unknown (no response observed)"),
    }
}
