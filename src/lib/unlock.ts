// Level unlock rules for the course. One source of truth for every surface
// that opens a lesson: the Study contents, the lesson player guard, the home
// continue card and the completion screen.
//
// Rules, kept honest and simple:
//   - a completed level is always open, replays are free
//   - level 1 of every chapter is always open, so someone who already plays
//     can start at Beginner without replaying Newbie
//   - any other level unlocks the moment the previous level of its chapter
//     is completed. Unlocks chain inside the chapter, so finishing level 3
//     opens level 4 no matter what happened in other chapters.

import { TIERS, findLevel } from '@/content/levels'

/** Self-assessed skill (onboarding) to course tier number. Single source of
 * truth: the coach skills layer imports this instead of keeping its own copy.
 * 'new' -> Newbie(1), 'beginner' -> Beginner(2), 'intermediate' ->
 * Intermediate(3), 'advanced' -> Advanced(4), 'expert' -> Master(5). */
export const SKILL_TIER_N: Record<string, number> = {
  new: 1,
  beginner: 2,
  intermediate: 3,
  advanced: 4,
  expert: 5,
}

/** Admin accounts see the whole course open: every gate steps aside for
 * them, without faking completion (done counts stay honest). */
export function isLevelUnlocked(levelId: string, done: Set<string>, role?: string | null): boolean {
  if (role === 'admin') return true
  if (done.has(levelId)) return true
  const ref = findLevel(levelId)
  if (!ref) return false
  if (ref.level.n === 1) return true
  const prev = ref.tier.levels[ref.level.n - 2]
  return done.has(prev.id)
}

/** Human line for a locked level, e.g. "Finish Level 3, The knight". Null when the level is a chapter opener. */
export function unlockRequirement(levelId: string): string | null {
  const ref = findLevel(levelId)
  if (!ref || ref.level.n === 1) return null
  const prev = ref.tier.levels[ref.level.n - 2]
  return `Finish Level ${prev.n}, ${prev.title}`
}

/** First unlocked and uncompleted level in course order: the recommended next
 * one. Always exists while the course is unfinished.
 *
 * `skillLevel` is the student's onboarding self-assessment ('new'..'expert').
 * A fresh student (zero completed lessons) who self-assessed above Newbie is
 * anchored at the entry level of their own tier, not at Newbie 1: every
 * anchor consumer (home continue card, coach header, generated material
 * calibration, /next, coach memory) reads the course position from here, so
 * one honest start honors the self-assessment everywhere at once. Real
 * progress overtakes immediately: the moment anything is completed, the rule
 * steps aside and normal course order resumes. */
export function nextUnlockedId(
  done: Set<string>,
  skillLevel?: string | null,
  role?: string | null,
): string | null {
  if (done.size === 0 && skillLevel) {
    const n = SKILL_TIER_N[skillLevel] ?? 1
    if (n > 1) {
      const tier = TIERS.find((t) => t.n === n)
      const entry = tier?.levels[0]
      if (entry && !done.has(entry.id) && isLevelUnlocked(entry.id, done, role)) return entry.id
    }
  }
  for (const tier of TIERS) {
    for (const level of tier.levels) {
      if (!done.has(level.id) && isLevelUnlocked(level.id, done, role)) return level.id
    }
  }
  return null
}
