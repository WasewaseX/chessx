// Per-course high-score economy, ported from chessreps.com — their
// `high_scores` store merges `max` per period bucket (see
// docs/chessreps-re-report.md §4 + §7 item 8).
//
// Every score lives in four period buckets: daily, weekly, monthly, all-time.
// Writing a score keeps the max inside every bucket whose period key matches
// "now", and returns which buckets were newly beaten so the UI can celebrate
// honestly — a record that was not beaten is never claimed.
//
// Pure localStorage, no server: scores are personal-best math, not a ranking
// someone can grief.

export type RecordKind = 'drill' | 'time' | 'dojo'
export type PeriodKind = 'daily' | 'weekly' | 'monthly' | 'allTime'

export interface RecordEntry {
  value: number
  at: string // ISO timestamp of the record run
  period: string // period key the entry was set in ("" for allTime)
}

export type PeriodMap = Record<PeriodKind, RecordEntry | null>
export type CourseRecords = Record<RecordKind, PeriodMap>

type RecordStore = Record<string, CourseRecords> // key: courseId or 'dojo'

const KEY = 'chessx.openings.records.v1'

export const RECORD_PERIODS: PeriodKind[] = ['daily', 'weekly', 'monthly', 'allTime']

const KIND_LABEL: Record<RecordKind, string> = {
  drill: 'Drill streak',
  time: 'Time score',
  dojo: 'Dojo streak',
}

export function recordKindLabel(kind: RecordKind): string {
  return KIND_LABEL[kind]
}

/** Period key for a bucket at a given moment, in LOCAL time. */
export function periodKeyFor(period: PeriodKind, at: Date = new Date()): string {
  const y = at.getFullYear()
  const m = String(at.getMonth() + 1).padStart(2, '0')
  const d = String(at.getDate()).padStart(2, '0')
  switch (period) {
    case 'daily':
      return `${y}-${m}-${d}`
    case 'monthly':
      return `${y}-${m}`
    case 'weekly': {
      // ISO-8601 week: Thursday owns the week (same algorithm as chessreps'
      // `moment().isoWeek()` keys, verified in the report appendix).
      const t = new Date(at.getFullYear(), at.getMonth(), at.getDate())
      const day = (t.getDay() + 6) % 7 // Mon=0..Sun=6
      t.setDate(t.getDate() - day + 3) // this week's Thursday
      const isoYear = t.getFullYear()
      const jan4 = new Date(isoYear, 0, 4)
      const week1Thu = new Date(jan4)
      week1Thu.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + 3)
      const week = 1 + Math.round((t.getTime() - week1Thu.getTime()) / (7 * 86400_000))
      return `${isoYear}-W${String(week).padStart(2, '0')}`
    }
    case 'allTime':
      return 'all'
  }
}

function emptyPeriodMap(): PeriodMap {
  return { daily: null, weekly: null, monthly: null, allTime: null }
}

function emptyCourseRecords(): CourseRecords {
  return { drill: emptyPeriodMap(), time: emptyPeriodMap(), dojo: emptyPeriodMap() }
}

function loadStore(): RecordStore {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as RecordStore
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function saveStore(store: RecordStore): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // private mode: scores live in memory for the session only
  }
}

function courseRecordsOf(store: RecordStore, courseId: string): CourseRecords {
  const existing = store[courseId]
  if (!existing) return emptyCourseRecords()
  // Defensive fill for stores written by older app versions.
  return {
    drill: existing.drill ?? emptyPeriodMap(),
    time: existing.time ?? emptyPeriodMap(),
    dojo: existing.dojo ?? emptyPeriodMap(),
  }
}

/** Read the full record card for one course (or 'dojo'). Never mutates. */
export function loadRecords(courseId: string): CourseRecords {
  return courseRecordsOf(loadStore(), courseId)
}

/**
 * Write a score into every matching period bucket (max-merge).
 * Returns which periods were newly beaten (value strictly greater than the
 * previous record — ties do not count, chessreps semantics), plus the fresh
 * record card for rendering.
 */
export function recordScore(
  kind: RecordKind,
  courseId: string,
  value: number,
  at: Date = new Date(),
): { beaten: PeriodKind[]; records: CourseRecords } {
  const v = Math.max(0, Math.round(value))
  const store = loadStore()
  const after = courseRecordsOf(store, courseId)
  const beaten: PeriodKind[] = []
  for (const period of RECORD_PERIODS) {
    const key = periodKeyFor(period, at)
    const current = after[kind][period]
    if (!current || v > current.value) {
      after[kind][period] = { value: v, at: at.toISOString(), period: key }
      // A new all-time record implies the smaller buckets were beaten too —
      // the loop records each bucket honestly on its own.
      beaten.push(period)
    }
  }
  if (beaten.length > 0) {
    store[courseId] = after
    saveStore(store)
  }
  return { beaten, records: after }
}

/** One-line read: the all-time record for a kind (0 when none). */
export function allTimeBest(kind: RecordKind, courseId: string): number {
  return loadRecords(courseId)[kind].allTime?.value ?? 0
}

// ---------------------------------------------------------------------------
// Streak milestone labels — chessreps celebrates streaks with named tiers.
// Same thresholds as the report's evidence (5 / 10 / 25 / 50), plus a warm-up
// tier so the first clean lines feel labeled too.
// ---------------------------------------------------------------------------

const MILESTONES: { at: number; label: string }[] = [
  { at: 3, label: 'Warming up' },
  { at: 5, label: 'Sharp' },
  { at: 10, label: 'Locked in' },
  { at: 25, label: 'Automatic' },
  { at: 50, label: 'Repertoire savant' },
]

/** The highest milestone reached (null below the first threshold). */
export function milestoneFor(streak: number): { at: number; label: string } | null {
  let hit: { at: number; label: string } | null = null
  for (const m of MILESTONES) if (streak >= m.at) hit = m
  return hit
}

/** The next milestone above the streak, for "3 more to Sharp" style nudges. */
export function nextMilestone(streak: number): { at: number; label: string } | null {
  for (const m of MILESTONES) if (streak < m.at) return m
  return null
}
