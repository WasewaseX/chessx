// Shared "press the win" continuation helpers for every puzzle surface.
// The rule: a puzzle does not stop at the first tactic when the position is
// still crushing. The scripted point is played, the engine then defends with
// best play, and the student keeps converting until the checkmate lands (or
// the advantage is fully banked). Thresholds are centipawns from the solver's
// point of view.

export const PRESS_ENTER_CP = 250 // tactic done + at least this = keep going
export const PRESS_HOLD_CP = 120 // every pressing move must keep at least this
export const PRESS_MATE = 90_000 // mate scores normalize to this for comparison
export const PRESS_MAX_PLIES = 60 // a conversion this long is already banked
export const PRESS_MISS_LIMIT = 4 // drifting misses before the finish is shown

export interface PressEval {
  scoreCp: number | null // centipawns, side-to-move POV
  mate: number | null // plies to mate, positive = side to move mates
}

/** Flip an engine eval (side-to-move POV) into the solver's perspective. */
export function solverPovCp(info: PressEval, solverIsMover: boolean): number {
  const sign = solverIsMover ? 1 : -1
  if (info.mate != null) {
    const m = info.mate * sign
    return m > 0 ? PRESS_MATE - m : -PRESS_MATE - m
  }
  return (info.scoreCp ?? 0) * sign
}

/** SAN comparison that ignores check, mate and promotion decorations. */
export function normSan(san: string): string {
  return san.replace(/[+#!?]/g, '').replace('=', '')
}
