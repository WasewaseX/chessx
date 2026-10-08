// Coach memory: a compact, factual brief about the student, assembled from
// the app's own ledger (games, labels, skill mastery, course progress,
// habits). No invented facts, no psychics: everything in the brief came from
// a table row. The chat uses it to open with what matters and to reference
// the student's real patterns when relevant.
import 'server-only'
import { db } from '@/lib/db'
import { CONCEPTS } from '@/content/schema'
import { findLevel } from '@/content/levels'
import { nextUnlockedId } from '@/lib/unlock'
import { dayKeyLocal } from '@/lib/day'

export interface MemoryFacts {
  courseLine: string | null
  weakestConcept: string | null
  topMissedTheme: string | null
  lastGamesLine: string | null
  mistakeLine: string | null
  habitLine: string | null
}

const CACHE_TTL_MS = 60_000
const cache = new Map<string, { at: number; facts: MemoryFacts; brief: string }>()

/** All memory facts in one pass. Every field is nullable: a fresh account
 * has almost nothing, and the brief degrades gracefully. */
export async function buildMemoryFacts(profileId: string): Promise<MemoryFacts> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000)
  const [profile, games, mastery, missed, progress, days] = await Promise.all([
    db.profile.findUnique({ where: { id: profileId } }),
    db.gameRecord.findMany({ where: { profileId }, orderBy: { createdAt: 'desc' }, take: 4 }),
    db.skillMastery.findMany({ where: { profileId, attempts: { gte: 2 } }, orderBy: { mastery: 'asc' }, take: 3 }),
    db.coachArtifact.findMany({ where: { profileId, solved: false }, orderBy: { createdAt: 'desc' }, take: 20 }),
    db.lessonProgress.findMany({ where: { profileId, completed: true } }),
    db.activityDay.findMany({ where: { profileId }, orderBy: { dayKey: 'desc' }, take: 14 }),
  ])

  // course position
  let courseLine: string | null = null
  const done = new Set(progress.map((p) => p.lessonId))
  const nextId = nextUnlockedId(done)
  const ref = nextId ? findLevel(nextId) : undefined
  if (ref) courseLine = `Working through ${ref.tier.title}, Level ${ref.level.n}: "${ref.level.title}" (${progress.length} lessons completed).`

  // weakest trained motif
  const weakest = mastery.filter((m) => (CONCEPTS as readonly string[]).includes(m.concept))[0]
  const weakestConcept = weakest
    ? `${weakest.concept} (${Math.round(weakest.mastery * 100)}% mastery over ${weakest.attempts} attempts)`
    : null

  // most-missed generated material theme
  const missedThemes = new Map<string, number>()
  for (const a of missed) {
    try {
      for (const t of JSON.parse(a.themes ?? '[]') as string[]) missedThemes.set(t, (missedThemes.get(t) ?? 0) + 1)
    } catch {
      /* malformed row */
    }
  }
  const topMissed = [...missedThemes.entries()].sort((x, y) => y[1] - x[1])[0]
  const topMissedTheme = topMissed ? `${topMissed[0]} (${topMissed[1]} unsolved)` : null

  // recent games
  let lastGamesLine: string | null = null
  if (games.length) {
    const parts = games.slice(0, 3).map((g) => {
      const acc = g.playerAcc != null ? `, ${Math.round(g.playerAcc)}% accuracy` : ''
      return `${g.result} vs ${g.botName} as ${g.color === 'w' ? 'White' : 'Black'}${acc}`
    })
    lastGamesLine = `Recent games: ${parts.join('; ')}.`
  }

  // recurring mistake labels
  let blunders = 0
  let mistakes = 0
  let analyzed = 0
  for (const g of games) {
    if (!g.analyzedAt) continue
    analyzed++
    try {
      const labels = JSON.parse(g.labelsJson ?? '{}') as Record<string, { w: number; b: number }>
      blunders += (labels.blunder?.w ?? 0) + (labels.blunder?.b ?? 0)
      mistakes += (labels.mistake?.w ?? 0) + (labels.mistake?.b ?? 0)
    } catch {
      /* malformed row */
    }
  }
  const mistakeLine =
    analyzed > 0 && mistakes + blunders > 0
      ? `Across ${analyzed} analyzed games: ${mistakes} mistakes and ${blunders} blunders flagged by the engine.`
      : null

  // habits
  const todayKey = dayKeyLocal(new Date())
  const today = days.find((d) => d.dayKey === todayKey)
  const active = new Set(days.filter((d) => d.minutes > 0 || d.puzzlesSolved > 0 || d.lessonSteps > 0 || d.gamesPlayed > 0).map((d) => d.dayKey))
  let streak = 0
  const cursor = new Date()
  if (!active.has(dayKeyLocal(cursor))) cursor.setDate(cursor.getDate() - 1)
  for (;;) {
    if (!active.has(dayKeyLocal(cursor))) break
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  const habitParts: string[] = []
  if (profile?.xp) habitParts.push(`${profile.xp} XP`)
  if (profile?.puzzleSolved) habitParts.push(`${profile.puzzleSolved} puzzles solved`)
  if (streak > 0) habitParts.push(`${streak}-day active streak`)
  if (today && !today.goalMet && profile?.goalMinutes) habitParts.push(`daily goal not met yet (${today.minutes}/${profile.goalMinutes} min)`)
  const habitLine = habitParts.length ? habitParts.join(', ') + '.' : null

  return { courseLine, weakestConcept, topMissedTheme, lastGamesLine, mistakeLine, habitLine }
}

/** The compact prompt block, cached for a minute per profile. Null when the
 * account has nothing worth remembering yet. */
export async function coachMemoryBrief(profileId: string): Promise<string | null> {
  const hit = cache.get(profileId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.brief
  try {
    const facts = await buildMemoryFacts(profileId)
    const lines: string[] = []
    if (facts.courseLine) lines.push(facts.courseLine)
    if (facts.weakestConcept) lines.push(`Weakest trained motif: ${facts.weakestConcept}.`)
    if (facts.topMissedTheme) lines.push(`Generated material missed most: ${facts.topMissedTheme}.`)
    if (facts.lastGamesLine) lines.push(facts.lastGamesLine)
    if (facts.mistakeLine) lines.push(facts.mistakeLine)
    if (facts.habitLine) lines.push(`Habits: ${facts.habitLine}`)
    const brief = lines.length >= 2 ? lines.join(' ') : null
    cache.set(profileId, { at: Date.now(), facts, brief })
    return brief
  } catch {
    return null
  }
}

/** One personalized hook for a bare greeting, chosen from the strongest
 * available fact. Deterministic mapping, honest wording, always optional. */
export async function memoryHook(profileId: string): Promise<string | null> {
  const hit = cache.get(profileId)
  const facts = hit && Date.now() - hit.at < CACHE_TTL_MS ? hit.facts : (await coachMemoryBrief(profileId)) ? cache.get(profileId)!.facts : null
  if (!facts) return null
  const hooks: string[] = []
  if (facts.weakestConcept) {
    hooks.push(`Your ${facts.weakestConcept.split(' (')[0]} could use some reps. Want a puzzle on it? Just say /puzzle ${facts.weakestConcept.split(' (')[0]}.`)
  }
  if (facts.topMissedTheme) {
    hooks.push(`There is still unsolved material waiting in your drills shelf.`)
  }
  if (facts.lastGamesLine) {
    hooks.push(`Fresh from your last game: ${facts.lastGamesLine.replace(/^Recent games: /, '').replace(/\.$/, '')}. Ask me to walk through it any time.`)
  }
  if (facts.habitLine?.includes('daily goal not met')) {
    hooks.push(`Your daily goal is still open today. A quick lesson or a few puzzles closes it.`)
  }
  if (!hooks.length) return null
  // weakest concept first when present, otherwise a stable pick
  return hooks[0]
}

/** Test hook: drop the cache for a profile. */
export function forgetMemory(profileId: string): void {
  cache.delete(profileId)
}
