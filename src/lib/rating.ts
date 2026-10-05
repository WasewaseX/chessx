// Elo updates and provisional handling.
// A rating of `null` means "unrated": we never show invented numbers.

export function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400))
}

export function newRating(
  rating: number,
  opponent: number,
  score: number, // 1 win, 0.5 draw, 0 loss
  gamesPlayed: number,
  baseK = 24,
  provisionalK = 48,
): { rating: number; delta: number } {
  const k = gamesPlayed < 10 ? provisionalK : baseK
  const exp = expectedScore(rating, opponent)
  const delta = Math.round(k * (score - exp))
  return { rating: Math.max(100, rating + delta), delta }
}

// Seed used the first time someone plays a rated game, from the
// self-assessed level picked during onboarding. Same ladder chess.com offers
// at signup: a 1100 chess.com player self-selects "intermediate" and starts
// at 1200 with RD 350, then Glicko-1 pulls them to their true strength.
// Shown as "provisional" (rating + ?) until the RD settles.
export const SKILL_SEEDS: Record<string, number> = {
  new: 400,
  beginner: 800,
  intermediate: 1200,
  advanced: 1600,
  expert: 2000,
}

export function seedForSkill(skill: string): number {
  return SKILL_SEEDS[skill] ?? 800
}

export function isProvisional(gamesPlayed: number): boolean {
  return gamesPlayed < 10
}

/**
 * Estimated Elo potential: where the player's online rating would likely
 * settle, judged only from games already played. Bot games carry most of the
 * signal (the chess.com-style estimate against each bot's fixed rating) and
 * rated puzzles add a small correction. Every input is measured, never
 * invented; with no signal at all the potential is simply unknown.
 */
export function potentialElo(input: {
  botElo: number
  botGames: number
  puzzleRating: number | null
  puzzleCount: number
}): { value: number; from: 'bots and puzzles' | 'bot games' | 'puzzles' } | null {
  const hasBot = input.botGames > 0 && input.botElo > 0
  const hasPuzzle = input.puzzleCount > 0 && input.puzzleRating != null
  if (hasBot && hasPuzzle && input.puzzleRating != null) {
    const value = Math.round(input.botElo * 0.8 + input.puzzleRating * 0.2)
    return { value, from: 'bots and puzzles' }
  }
  if (hasBot) return { value: input.botElo, from: 'bot games' }
  if (hasPuzzle && input.puzzleRating != null) return { value: input.puzzleRating, from: 'puzzles' }
  return null
}

// Label for a time control, e.g. 180+2 -> "3+2". Used anywhere a game needs
// a short human name; the old per-time-class rating pools are gone, so this
// describes the clock only, never a rating.
export function tcLabel(initialSec: number, incSec: number): string {
  const minutes = Math.round(initialSec / 60)
  return incSec > 0 ? `${minutes}+${incSec}` : `${minutes}+0`
}

// Chess.com-style accuracy approximation from average centipawn loss.
export function accuracyFromLoss(avgLossCp: number): number {
  const a = 103.1668 * Math.exp(-0.04354 * avgLossCp) - 3.1669
  return Math.max(0, Math.min(100, Math.round(a * 10) / 10))
}

// XP titles: purely cosmetic, driven by real XP only.
export function titleForXp(xp: number): string {
  if (xp >= 15000) return 'Master'
  if (xp >= 8000) return 'Expert'
  if (xp >= 4000) return 'Candidate'
  if (xp >= 1800) return 'Club Player'
  if (xp >= 600) return 'Improver'
  if (xp >= 150) return 'Amateur'
  return 'Novice'
}

export const XP_STEP = 5
export const XP_LESSON_DONE = [60, 80, 100, 120, 150] // by lesson level (1-5)
