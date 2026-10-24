// Local-first sync bridge for opening-training mastery — chessreps port
// item 11 (the {base, baseRevision, patch, clocks} envelope, adapted to the
// ChessX auth + SQLite backend).
//
// The browser's localStorage mastery map stays the source of play (zero-latency,
// offline-proof). The server keeps a durable mirror behind /api/openings/progress.
// Merge rules are field-level and convergent on both sides:
//   - monotonic counters (reps, lapses, bestStreak): max(local, remote)
//   - the rest (confidence, due, lastGrade): newer updatedAt wins (LWW)
// so any two devices converge to the same state without a sync protocol.

import type { LineMastery, MasteryMap, RepGrade } from '@/lib/chess/opening-reps'

export interface SyncEntry {
  courseId: string
  lineId: string
  confidence: number
  due: number
  reps: number
  lapses: number
  lastGrade: RepGrade | 'new'
  bestStreak: number
  updatedAt: number
}

/** Field-merge two versions of one line's mastery (see module rules). */
export function mergeMastery(local: LineMastery, remote: LineMastery): LineMastery {
  const lU = local.updatedAt ?? 0
  const rU = remote.updatedAt ?? 0
  const newer = lU >= rU ? local : remote
  return {
    confidence: newer.confidence,
    due: newer.due,
    lastGrade: newer.lastGrade,
    updatedAt: Math.max(lU, rU) || undefined,
    reps: Math.max(local.reps ?? 0, remote.reps ?? 0),
    lapses: Math.max(local.lapses ?? 0, remote.lapses ?? 0),
    bestStreak: Math.max(local.bestStreak ?? 0, remote.bestStreak ?? 0),
  }
}

/** Fold server entries into a local map (mutates in place, returns the map). */
export function foldEntries(map: MasteryMap, entries: SyncEntry[]): MasteryMap {
  for (const e of entries) {
    const course = (map[e.courseId] ??= {})
    const local = course[e.lineId]
    const remote: LineMastery = {
      confidence: e.confidence,
      due: e.due,
      reps: e.reps,
      lapses: e.lapses,
      lastGrade: e.lastGrade,
      bestStreak: e.bestStreak,
      updatedAt: e.updatedAt,
    }
    course[e.lineId] = local ? mergeMastery(local, remote) : remote
  }
  return map
}

function toEntry(courseId: string, lineId: string, m: LineMastery): SyncEntry {
  return {
    courseId,
    lineId,
    confidence: m.confidence,
    due: m.due,
    reps: m.reps ?? 0,
    lapses: m.lapses ?? 0,
    lastGrade: m.lastGrade ?? 'new',
    bestStreak: m.bestStreak ?? 0,
    updatedAt: m.updatedAt ?? 0,
  }
}

/**
 * Pull the server mirror and fold it into the local map. Returns the (possibly
 * unchanged) map. Silent no-op when signed out or offline — local-first means
 * the app never waits on the network to be usable.
 */
export async function pullProgress(map: MasteryMap): Promise<MasteryMap> {
  try {
    const res = await fetch('/api/openings/progress', { cache: 'no-store' })
    if (!res.ok) return map
    const data = (await res.json()) as { progress?: Record<string, Record<string, SyncEntry>> }
    if (!data.progress) return map
    const entries: SyncEntry[] = []
    for (const [courseId, lines] of Object.entries(data.progress)) {
      for (const [lineId, e] of Object.entries(lines)) entries.push({ ...e, courseId, lineId })
    }
    return foldEntries(map, entries)
  } catch {
    return map
  }
}

/**
 * Push changed lines to the mirror (debounced by the caller). Applies the
 * server-merged results back so both sides converge immediately.
 */
export async function pushProgress(
  map: MasteryMap,
  keys: { courseId: string; lineId: string }[],
): Promise<MasteryMap> {
  const entries: SyncEntry[] = []
  for (const { courseId, lineId } of keys) {
    const m = map[courseId]?.[lineId]
    if (m) entries.push(toEntry(courseId, lineId, m))
  }
  if (entries.length === 0) return map
  try {
    const res = await fetch('/api/openings/progress', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entries }),
      cache: 'no-store',
    })
    if (!res.ok) return map
    const data = (await res.json()) as { entries?: SyncEntry[] }
    if (data.entries?.length) return foldEntries(map, data.entries)
    return map
  } catch {
    return map
  }
}

/** Forget-line (chessreps "unlearn"): clear locally and on the mirror. */
export async function forgetLineProgress(courseId: string, lineId: string): Promise<void> {
  try {
    await fetch(`/api/openings/progress?courseId=${encodeURIComponent(courseId)}&lineId=${encodeURIComponent(lineId)}`, {
      method: 'DELETE',
      cache: 'no-store',
    })
  } catch {
    // offline: the local clear already happened; the row syncs away later
  }
}
