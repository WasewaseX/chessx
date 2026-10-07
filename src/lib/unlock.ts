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

export function isLevelUnlocked(levelId: string, done: Set<string>): boolean {
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

/** First unlocked and uncompleted level in course order: the recommended next one. Always exists while the course is unfinished. */
export function nextUnlockedId(done: Set<string>): string | null {
  for (const tier of TIERS) {
    for (const level of tier.levels) {
      if (!done.has(level.id) && isLevelUnlocked(level.id, done)) return level.id
    }
  }
  return null
}
