// Server-side skill model and spaced-repetition helpers.
// Concepts use the taxonomy in src/content/schema.ts (CONCEPTS).
import { db } from '@/lib/db'
import { CONCEPTS } from '@/content/schema'

const DAY_MS = 24 * 60 * 60 * 1000

export function sanitizeConcepts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const set = new Set<string>()
  for (const c of raw) {
    const s = String(c)
    if ((CONCEPTS as readonly string[]).includes(s)) set.add(s)
  }
  return [...set].slice(0, 6)
}

/** Record a hit or miss for a set of concepts and update mastery (0..1). */
export async function updateMastery(concepts: string[], correct: boolean) {
  for (const concept of concepts) {
    const existing = await db.skillMastery.findUnique({ where: { concept } })
    const attempts = (existing?.attempts ?? 0) + 1
    const correctCount = (existing?.correct ?? 0) + (correct ? 1 : 0)
    const prev = existing?.mastery ?? 0
    // Correct answers push mastery toward 1 with diminishing returns; misses pull it down harder.
    const next = correct
      ? Math.min(1, prev + 0.18 * (1.2 - prev))
      : Math.max(0, prev - 0.22)
    await db.skillMastery.upsert({
      where: { concept },
      update: { mastery: next, attempts, correct: correctCount },
      create: { concept, mastery: correct ? 0.18 : 0, attempts, correct: correctCount },
    })
  }
}

export interface ReviewGrade {
  intervalDays: number
  ease: number
  reps: number
  lapses: number
  dueAt: Date
}

/**
 * SM-2 derived scheduling. A miss resets the interval to one day and dents
 * the ease factor. Successes grow the interval 1d, 4d, then interval * ease.
 */
export function scheduleReview(current: { ease: number; intervalDays: number; reps: number; lapses: number }, success: boolean): ReviewGrade {
  let { ease, intervalDays, reps, lapses } = current
  if (!success) {
    reps = 0
    lapses += 1
    intervalDays = 1
    ease = Math.max(1.3, ease - 0.2)
  } else {
    reps += 1
    if (reps === 1) intervalDays = 1
    else if (reps === 2) intervalDays = 4
    else intervalDays = Math.round(intervalDays * ease * 10) / 10
    ease = Math.min(3, ease + 0.1)
  }
  return { ease, intervalDays, reps, lapses, dueAt: new Date(Date.now() + intervalDays * DAY_MS) }
}

/** Create or reset a review item after a miss. */
export async function missReview(kind: 'puzzle' | 'lesson', refId: string, concept?: string) {
  const existing = await db.reviewItem.findUnique({
    where: { kind_refId: { kind, refId } },
  })
  const grade = scheduleReview(
    {
      ease: existing?.ease ?? 2.5,
      intervalDays: existing?.intervalDays ?? 0,
      reps: existing?.reps ?? 0,
      lapses: existing?.lapses ?? 0,
    },
    false,
  )
  await db.reviewItem.upsert({
    where: { kind_refId: { kind, refId } },
    update: { ...grade, concept: concept ?? existing?.concept ?? null },
    create: { kind, refId, concept: concept ?? null, ...grade },
  })
}

/** Grade an existing review item after the student faced it again. */
export async function gradeReview(itemId: string, success: boolean) {
  const item = await db.reviewItem.findUnique({ where: { id: itemId } })
  if (!item) return null
  const grade = scheduleReview(
    { ease: item.ease, intervalDays: item.intervalDays, reps: item.reps, lapses: item.lapses },
    success,
  )
  return db.reviewItem.update({ where: { id: itemId }, data: grade })
}

/**
 * One row per active day. id is the dayKey. Counters are bumped by the
 * routes that observe the real event; goalMet recomputes from the profile goal.
 */
export async function bumpActivity(
  dayKey: string,
  field: 'minutes' | 'puzzlesSolved' | 'lessonSteps' | 'gamesPlayed',
  amount: number,
) {
  if (amount <= 0) return
  const profile = await db.profile.findUnique({ where: { id: 'me' } })
  const goal = profile?.goalMinutes ?? 15
  const day = await db.activityDay.upsert({
    where: { id: dayKey },
    update: {},
    create: { id: dayKey },
  })
  const minutes = field === 'minutes' ? Math.min(600, day.minutes + amount) : day.minutes
  const data = {
    minutes,
    puzzlesSolved: day.puzzlesSolved + (field === 'puzzlesSolved' ? amount : 0),
    lessonSteps: day.lessonSteps + (field === 'lessonSteps' ? amount : 0),
    gamesPlayed: day.gamesPlayed + (field === 'gamesPlayed' ? amount : 0),
    goalMet: minutes >= goal,
  }
  await db.activityDay.update({ where: { id: dayKey }, data })
}

/** Current streak: consecutive goal-met days ending today (or yesterday if today is still open). */
export async function computeStreaks(todayKey?: string) {
  const rows = await db.activityDay.findMany({ orderBy: { id: 'asc' } })
  const met = new Map(rows.filter((r) => r.goalMet).map((r) => [r.id, true]))
  const keyOf = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const today = todayKey && /^\d{4}-\d{2}-\d{2}$/.test(todayKey) ? todayKey : keyOf(new Date())

  let current = 0
  // walk back from `today` using calendar math on the key itself
  const shift = (key: string, n: number): string => {
    const [y, m, d] = key.split('-').map(Number)
    const date = new Date(Date.UTC(y, m - 1, d + n))
    return date.toISOString().slice(0, 10)
  }
  let cursor = today
  // Today not met yet does not break the streak, it is still open.
  if (!met.has(cursor)) cursor = shift(cursor, -1)
  while (met.has(cursor)) {
    current += 1
    cursor = shift(cursor, -1)
  }

  let best = 0
  let run = 0
  let prev: string | null = null
  for (const r of rows) {
    if (!r.goalMet) {
      run = 0
      prev = r.id
      continue
    }
    const continues = prev !== null && nextDay(prev) === r.id
    run = continues ? run + 1 : 1
    best = Math.max(best, run)
    prev = r.id
  }
  return { current, best }
}

function nextDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d + 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
