// Today's Plan: a morning-built, 15-slot daily training plan derived
// deterministically from the player's own data — the chessigma loop:
//   Blunder Fix (5)   -> due Mistake Corrector drills, worst eval loss first
//   Blunder Shield (5)-> recurring-loss traps: lapsed review puzzles, filled
//                        from the last 7 days of failed rated attempts
//   Woodpecker (4) + Daily (1) -> sets due for a new cycle + today's puzzle
// Honest by construction: sections shrink when the data is missing; filler
// is never invented. No schema changes and no writes happen here — the plan
// is a read-only projection of Drill, ReviewItem, PuzzleAttempt,
// WoodpeckerSet and Profile.dailyDoneDate.
//
// Caching: the slot COMPOSITION (ids, titles, details) is cached per profile
// for 60s in module memory. The `done` flags are recomputed on every call so
// progress made elsewhere in the app shows up without waiting for the TTL.
import { db } from '@/lib/db'
import { dayKeyLocal } from '@/lib/day'
import { PUZZLES } from '@/content/puzzles'
import { humanizeTheme } from '@/content/schema'
import { lichessById } from '@/lib/server/lichess-bank'
import { buildDnaReport } from '@/lib/server/chess-dna'

const DAY_MS = 86_400_000

const FIX_SIZE = 5
const SHIELD_SIZE = 5
const WOODPECKER_SIZE = 4
const CACHE_TTL_MS = 60_000
const FAILED_WINDOW_DAYS = 7

/** Views the app's own switcher understands (src/lib/store.ts ViewName). */
export type PlanView = 'review' | 'puzzles'

export type PlanSectionKey = 'blunderFix' | 'blunderShield' | 'woodpecker'

/** What the done-recompute needs to find the slot's live state. */
interface SlotRef {
  kind: 'drill' | 'puzzle' | 'set'
  /** drill id / puzzle id (refId) / woodpecker set id */
  id: string
}

/** Cached, data-only shape of a slot. Never served directly. */
interface ComposedSlot {
  id: string
  section: PlanSectionKey
  title: string
  detail: string
  view: PlanView
  ref: SlotRef | null // null for the daily puzzle slot
  /** Honest per-item time estimate (minutes) and the DNA-domain label this
   *  slot trains — chessigma's plan tasks carry the same two numbers
   *  (estimatedMinutes + weighted trainsCategories); ours come from the slot
   *  kind's real cost, not from a per-task session estimate. */
  minutes: number
  trains: string
}

export interface PlanSlot {
  id: string
  title: string
  detail: string
  view: PlanView
  done: boolean
  /** Honest per-item minutes estimate + what it trains (DNA domain label). */
  minutes: number
  trains: string
}

/**
 * The weakest Chess DNA domain, spotlighted on the plan so the morning
 * loop visibly trains what the DNA measured. Carries the domain's own
 * drill deep link (view + hash arg). Null when the DNA is not ready yet —
 * the plan never pretends a focus it cannot measure.
 */
export interface PlanFocus {
  domain: string
  label: string
  score: number | null
  tip: string | null
  view: PlanView | 'tools'
  arg?: string
}

export interface PlanSection {
  key: PlanSectionKey
  label: string
  slots: PlanSlot[]
}

export interface DailyPlan {
  dayKey: string
  target: number
  doneCount: number
  sections: PlanSection[]
  focus: PlanFocus | null
}

export const PLAN_TARGET = FIX_SIZE + SHIELD_SIZE + WOODPECKER_SIZE + 1

const SECTION_LABELS: Record<PlanSectionKey, string> = {
  blunderFix: 'Blunder Fix',
  blunderShield: 'Blunder Shield',
  woodpecker: 'Woodpecker & Daily',
}

// ---------------------------------------------------------------------------
// Composition cache (module memory, one entry per profile)
// ---------------------------------------------------------------------------

const cache = new Map<string, { dayKey: string; builtAt: number; slots: ComposedSlot[] }>()

async function composedSlots(profileId: string, dayKey: string, refresh: boolean): Promise<ComposedSlot[]> {
  const hit = cache.get(profileId)
  if (!refresh && hit && hit.dayKey === dayKey && Date.now() - hit.builtAt < CACHE_TTL_MS) {
    return hit.slots
  }
  const now = new Date()
  const [fix, shield, wood] = await Promise.all([
    composeBlunderFix(profileId, now),
    composeBlunderShield(profileId, now),
    composeWoodpeckerAndDaily(profileId, dayKey),
  ])
  const slots = [...fix, ...shield, ...wood]
  cache.set(profileId, { dayKey, builtAt: Date.now(), slots })
  return slots
}

// ---------------------------------------------------------------------------
// Section a) Blunder Fix — the player's own stored errors, worst first
// ---------------------------------------------------------------------------

async function composeBlunderFix(profileId: string, now: Date): Promise<ComposedSlot[]> {
  // Due drills first (mastered=false, nextDueAt <= now), worst loss on top.
  // Drills whose engine answer is still pending (bestSan '') are not
  // playable yet — the drills queue hides them too, so the plan does as well.
  const due = await db.drill.findMany({
    where: { profileId, mastered: false, bestSan: { not: '' }, nextDueAt: { lte: now } },
    orderBy: [{ evalLossCp: 'desc' }],
    take: FIX_SIZE,
  })
  const picked = [...due]
  // Fill from the highest-loss unmastered drills regardless of due date.
  if (picked.length < FIX_SIZE) {
    const more = await db.drill.findMany({
      where: { profileId, mastered: false, bestSan: { not: '' }, id: { notIn: picked.map((d) => d.id) } },
      orderBy: [{ evalLossCp: 'desc' }],
      take: FIX_SIZE - picked.length,
    })
    picked.push(...more)
  }
  return picked.map((d) => ({
    id: `drill:${d.id}`,
    section: 'blunderFix' as const,
    // Neutral labels only: the played move and the answer stay server-side
    // until the drill is solved (same spoiler contract as the corrector UI).
    title: d.opponent ? `Error vs ${d.opponent}` : 'Error from your games',
    detail: `${d.opening ?? 'Your game'} · cost about ${d.evalLossCp}cp`,
    view: 'review' as const,
    ref: { kind: 'drill' as const, id: d.id },
    minutes: 4,
    trains: 'Blunders',
  }))
}

// ---------------------------------------------------------------------------
// Section b) Blunder Shield — recurring-loss traps
// ---------------------------------------------------------------------------

/** Rating + a safe (non-spoiler) theme label for any puzzle id the queues hold. */
function puzzleInfo(refId: string): { rating: number | null; theme: string | null } {
  const p = PUZZLES.find((x) => x.id === refId)
  if (p) return { rating: p.rating, theme: p.themes[0] ?? null }
  const lp = lichessById(refId)
  if (lp) return { rating: lp.rating, theme: lp.themes[0] ?? null }
  return { rating: null, theme: null }
}

function trapLabel(concept: string | null, refId: string): string {
  if (concept) return humanizeTheme(concept)
  const info = puzzleInfo(refId)
  return info.theme ? humanizeTheme(info.theme) : 'missed puzzle'
}

async function composeBlunderShield(profileId: string, now: Date): Promise<ComposedSlot[]> {
  // Lapsed puzzles (lapses > 0), due ones first, lapses descending inside
  // each group — the traps that keep beating the player come first.
  const rows = await db.reviewItem.findMany({
    where: { profileId, kind: 'puzzle', lapses: { gt: 0 } },
  })
  const byLapses = (a: { lapses: number }, b: { lapses: number }) => b.lapses - a.lapses
  const ordered = [
    ...rows.filter((r) => r.dueAt <= now).sort(byLapses),
    ...rows.filter((r) => r.dueAt > now).sort(byLapses),
  ].slice(0, SHIELD_SIZE)

  const usedPuzzleIds = new Set(ordered.map((r) => r.refId))
  const slots: ComposedSlot[] = ordered.map((r) => {
    const info = puzzleInfo(r.refId)
    return {
      id: `trap:${r.id}`,
      section: 'blunderShield' as const,
      title: `Repeat · ${trapLabel(r.concept, r.refId)}`,
      detail: info.rating != null ? `rating ${info.rating} · lapsed ${r.lapses}×` : `lapsed ${r.lapses}×`,
      view: 'review' as const,
      ref: { kind: 'puzzle' as const, id: r.refId },
      minutes: 3,
      trains: 'Blunders · Tactics',
    }
  })

  // Fill from the last week of failed rated attempts, newest first, deduped
  // by puzzleId and against the review picks above.
  if (slots.length < SHIELD_SIZE) {
    const fails = await db.puzzleAttempt.findMany({
      where: {
        profileId,
        kind: 'rated',
        solved: false,
        createdAt: { gte: new Date(now.getTime() - FAILED_WINDOW_DAYS * DAY_MS) },
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
    })
    for (const f of fails) {
      if (slots.length >= SHIELD_SIZE) break
      if (usedPuzzleIds.has(f.puzzleId)) continue
      usedPuzzleIds.add(f.puzzleId)
      const info = puzzleInfo(f.puzzleId)
      slots.push({
        id: `miss:${f.puzzleId}`,
        section: 'blunderShield',
        title: `Repeat · ${trapLabel(null, f.puzzleId)}`,
        detail: info.rating != null ? `missed in rated · rating ${info.rating}` : 'missed in rated',
        view: 'puzzles',
        ref: { kind: 'puzzle', id: f.puzzleId },
        minutes: 3,
        trains: 'Blunders · Tactics',
      })
    }
  }
  return slots
}

// ---------------------------------------------------------------------------
// Section c) Woodpecker cycles due today + the daily puzzle
// ---------------------------------------------------------------------------

async function composeWoodpeckerAndDaily(profileId: string, dayKey: string): Promise<ComposedSlot[]> {
  const sets = await db.woodpeckerSet.findMany({
    where: { profileId },
    // SQLite sorts NULL first in ASC: never-run sets lead, then the stalest.
    orderBy: { lastRunAt: 'asc' },
  })
  const dueSets = sets
    .filter((s) => !s.lastRunAt || dayKeyLocal(s.lastRunAt) !== dayKey)
    .slice(0, WOODPECKER_SIZE)

  const slots: ComposedSlot[] = dueSets.map((s) => ({
    id: `woodpecker:${s.id}`,
    section: 'woodpecker' as const,
    title: `Woodpecker · ${humanizeTheme(s.theme)}`,
    detail: s.bestMs != null ? `cycle ${s.cycle} · best ${(s.bestMs / 1000).toFixed(1)}s` : `cycle ${s.cycle} · first run`,
    view: 'puzzles' as const,
    ref: { kind: 'set' as const, id: s.id },
    minutes: 10,
    trains: 'Tactics',
  }))

  // The daily puzzle is the one slot every player always has.
  slots.push({
    id: 'daily:puzzle',
    section: 'woodpecker',
    title: 'Daily puzzle',
    detail: 'One rated puzzle, picked for today',
    view: 'puzzles',
    ref: null,
    minutes: 3,
    trains: 'Tactics',
  })
  return slots
}

// ---------------------------------------------------------------------------
// DNA focus — weakest domain spotlight (own cache, DNA changes are slow)
// ---------------------------------------------------------------------------

const FOCUS_TTL_MS = 10 * 60_000
const focusCache = new Map<string, { at: number; focus: PlanFocus | null }>()

async function dnaFocus(profileId: string): Promise<PlanFocus | null> {
  const hit = focusCache.get(profileId)
  if (hit && Date.now() - hit.at < FOCUS_TTL_MS) return hit.focus
  let focus: PlanFocus | null = null
  try {
    const report = await buildDnaReport(profileId)
    const domain = report.weakest ? report.domains.find((d) => d.key === report.weakest) : null
    if (report.ready && domain && domain.drill) {
      focus = {
        domain: domain.key,
        label: domain.label,
        score: domain.score,
        tip: report.tip,
        view: domain.drill.view,
        arg: domain.drill.arg,
      }
    }
  } catch (e) {
    // A failed DNA read must never break the plan — the strip just hides.
    console.error('[plan] dna focus failed', e)
  }
  focusCache.set(profileId, { at: Date.now(), focus })
  return focus
}

// ---------------------------------------------------------------------------
// Done flags — recomputed fresh on every call, never cached
// ---------------------------------------------------------------------------

export async function buildPlan(
  profileId: string,
  dayKey: string,
  opts: { refresh?: boolean } = {},
): Promise<DailyPlan> {
  const slots = await composedSlots(profileId, dayKey, opts.refresh === true)

  const drillIds = slots.filter((s) => s.ref?.kind === 'drill').map((s) => s.ref!.id)
  const puzzleIds = slots.filter((s) => s.ref?.kind === 'puzzle').map((s) => s.ref!.id)
  const setIds = slots.filter((s) => s.ref?.kind === 'set').map((s) => s.ref!.id)

  const [drills, attempts, sets, profile] = await Promise.all([
    drillIds.length
      ? db.drill.findMany({ where: { id: { in: drillIds }, profileId }, select: { id: true, mastered: true } })
      : Promise.resolve([] as { id: string; mastered: boolean }[]),
    puzzleIds.length
      ? db.puzzleAttempt.findMany({
          where: {
            profileId,
            puzzleId: { in: puzzleIds },
            solved: true,
            // "solved today": the attempt carries today's dayKey (the same
            // client-day convention the attempt route writes), with the UTC
            // wall-clock day as the honest fallback for rows without one.
            OR: [{ dayKey }, { createdAt: { gte: new Date(`${dayKey}T00:00:00Z`), lt: new Date(new Date(`${dayKey}T00:00:00Z`).getTime() + DAY_MS) } }],
          },
          select: { puzzleId: true },
          distinct: ['puzzleId'],
        })
      : Promise.resolve([] as { puzzleId: string }[]),
    setIds.length
      ? db.woodpeckerSet.findMany({ where: { id: { in: setIds }, profileId }, select: { id: true, lastRunAt: true } })
      : Promise.resolve([] as { id: string; lastRunAt: Date | null }[]),
    db.profile.findUnique({ where: { id: profileId }, select: { dailyDoneDate: true } }),
  ])

  const mastered = new Set(drills.filter((d) => d.mastered).map((d) => d.id))
  const solvedToday = new Set(attempts.map((a) => a.puzzleId))
  const runToday = new Set(
    sets.filter((s) => s.lastRunAt && dayKeyLocal(s.lastRunAt) === dayKey).map((s) => s.id),
  )
  const dailyDone = profile?.dailyDoneDate === dayKey

  const withDone: Array<PlanSlot & { section: PlanSectionKey }> = slots.map((s) => {
    let done = false
    if (s.ref?.kind === 'drill') done = mastered.has(s.ref.id)
    else if (s.ref?.kind === 'puzzle') done = solvedToday.has(s.ref.id)
    else if (s.ref?.kind === 'set') done = runToday.has(s.ref.id)
    else done = dailyDone // the daily puzzle slot (ref: null)
    return { id: s.id, title: s.title, detail: s.detail, view: s.view, done, section: s.section, minutes: s.minutes, trains: s.trains }
  })

  const sections: PlanSection[] = (['blunderFix', 'blunderShield', 'woodpecker'] as PlanSectionKey[]).map(
    (key) => ({
      key,
      label: SECTION_LABELS[key],
      slots: withDone
        .filter((s) => s.section === key)
        .map((s) => ({ id: s.id, title: s.title, detail: s.detail, view: s.view, done: s.done, minutes: s.minutes, trains: s.trains })),
    }),
  )

  return {
    dayKey,
    target: PLAN_TARGET,
    doneCount: withDone.filter((s) => s.done).length,
    sections,
    focus: await dnaFocus(profileId),
  }
}
