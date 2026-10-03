// Elo updates and provisional handling.
// A rating of `null` means "unrated" — we never show invented numbers.

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

// Seed used the first time someone plays a rated game, based on the
// self-assessed level from onboarding. Shown as "provisional" until 10 games.
export const SKILL_SEEDS: Record<string, number> = {
  new: 500,
  beginner: 800,
  intermediate: 1100,
  advanced: 1400,
  expert: 1700,
}

export function seedForSkill(skill: string): number {
  return SKILL_SEEDS[skill] ?? 800
}

export function isProvisional(gamesPlayed: number): boolean {
  return gamesPlayed < 10
}

// Chess.com-style accuracy approximation from average centipawn loss.
export function accuracyFromLoss(avgLossCp: number): number {
  const a = 103.1668 * Math.exp(-0.04354 * avgLossCp) - 3.1669
  return Math.max(0, Math.min(100, Math.round(a * 10) / 10))
}

// XP titles — purely cosmetic, driven by real XP only.
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
