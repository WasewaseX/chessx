// Opening-training progress sync — chessreps port item 11 (the local-first
// progress envelope). The browser store (localStorage mastery map) is the
// source of play; this endpoint is the durable mirror so progress survives
// devices, reinstalls and lost storage — the same data-loss class that cost
// the user their account twice.
//
// Merge rules (field-level, chessreps-style — never invent, never lose):
//   - monotonic counters (reps, lapses, bestStreak): max(local, remote)
//   - everything else (confidence, due, lastGrade): the side with the newer
//     updatedAt wins (last-write-wins)
// Both sides converge to the same merged state because the rules are
// commutative, associative and idempotent.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getSessionUser, rateLimit, originOk, ORIGIN_BLOCKED_MSG } from '@/lib/auth'

// ts-fsrs v6 Card snapshot (JSON-safe shape, dates as epoch ms) — see
// src/lib/chess/opening-reps.ts. Stored as a JSON string column; merged with
// the LWW group (never blend two memory states from different timelines).
const fsrsCardSchema = z.object({
  due: z.number().int().min(0),
  stability: z.number().min(0).max(100_000),
  difficulty: z.number().min(0).max(10),
  scheduled_days: z.number().int().min(0).max(36_500),
  learning_steps: z.number().int().min(0).max(100),
  reps: z.number().int().min(0).max(100_000),
  lapses: z.number().int().min(0).max(100_000),
  state: z.number().int().min(0).max(3),
  last_review: z.number().int().min(0).nullable(),
})

const entrySchema = z.object({
  courseId: z.string().min(1).max(80),
  lineId: z.string().min(1).max(120),
  confidence: z.number().int().min(0).max(10),
  due: z.number().int().min(0),
  reps: z.number().int().min(0).max(100_000),
  lapses: z.number().int().min(0).max(100_000),
  lastGrade: z.enum(['good', 'hard', 'again', 'new']),
  bestStreak: z.number().int().min(0).max(100_000),
  updatedAt: z.number().int().min(0),
  fsrsCard: fsrsCardSchema.optional(),
})

const putSchema = z.object({ entries: z.array(entrySchema).max(2000) })

type Entry = z.infer<typeof entrySchema>

function rowToEntry(r: {
  courseId: string
  lineId: string
  confidence: number
  due: Date
  reps: number
  lapses: number
  lastGrade: string
  bestStreak: number
  updatedAt: Date
  fsrsCard: string | null
}): Entry {
  let fsrsCard: Entry['fsrsCard']
  if (r.fsrsCard) {
    try {
      const parsed = fsrsCardSchema.safeParse(JSON.parse(r.fsrsCard))
      if (parsed.success) fsrsCard = parsed.data
    } catch {
      /* torn/legacy write: treat as absent */
    }
  }
  return {
    courseId: r.courseId,
    lineId: r.lineId,
    confidence: r.confidence,
    due: r.due.getTime(),
    reps: r.reps,
    lapses: r.lapses,
    lastGrade: (r.lastGrade as Entry['lastGrade']) ?? 'new',
    bestStreak: r.bestStreak,
    updatedAt: r.updatedAt.getTime(),
    fsrsCard,
  }
}

export async function GET(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: ORIGIN_BLOCKED_MSG }, { status: 403 })
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (!rateLimit(`openings-progress-get:${user.id}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 })
  }
  const rows = await db.openingProgress.findMany({ where: { userId: user.id } })
  const progress: Record<string, Record<string, Entry>> = {}
  for (const r of rows) {
    const course = (progress[r.courseId] ??= {})
    course[r.lineId] = rowToEntry(r)
  }
  return NextResponse.json({ progress }, { headers: { 'cache-control': 'no-store' } })
}

/** Merge one client entry into one server row; returns the merged entry. */
function merge(local: Entry, remote: Entry | null): Entry {
  if (!remote) return local
  const newer = local.updatedAt >= remote.updatedAt ? local : remote
  return {
    courseId: local.courseId,
    lineId: local.lineId,
    confidence: newer.confidence,
    due: newer.due,
    lastGrade: newer.lastGrade,
    updatedAt: newer.updatedAt,
    fsrsCard: newer.fsrsCard,
    reps: Math.max(local.reps, remote.reps),
    lapses: Math.max(local.lapses, remote.lapses),
    bestStreak: Math.max(local.bestStreak, remote.bestStreak),
  }
}

export async function PUT(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: ORIGIN_BLOCKED_MSG }, { status: 403 })
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (!rateLimit(`openings-progress-put:${user.id}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 })
  }
  const parsed = putSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid entries' }, { status: 400 })

  const ids = [...new Set(parsed.data.entries.map((e) => e.courseId))]
  const existing = await db.openingProgress.findMany({
    where: { userId: user.id, courseId: { in: ids } },
  })
  const byKey = new Map(existing.map((r) => [`${r.courseId}\u0000${r.lineId}`, r]))

  const merged: Entry[] = []
  for (const entry of parsed.data.entries) {
    const row = byKey.get(`${entry.courseId}\u0000${entry.lineId}`)
    const remote: Entry | null = row ? rowToEntry(row) : null
    const next = merge(entry, remote)
    const fsrsCardJson = next.fsrsCard ? JSON.stringify(next.fsrsCard) : null
    await db.openingProgress.upsert({
      where: { userId_courseId_lineId: { userId: user.id, courseId: entry.courseId, lineId: entry.lineId } },
      create: {
        userId: user.id,
        courseId: next.courseId,
        lineId: next.lineId,
        confidence: next.confidence,
        due: new Date(next.due),
        reps: next.reps,
        lapses: next.lapses,
        lastGrade: next.lastGrade,
        bestStreak: next.bestStreak,
        updatedAt: new Date(next.updatedAt),
        fsrsCard: fsrsCardJson,
      },
      update: {
        confidence: next.confidence,
        due: new Date(next.due),
        reps: next.reps,
        lapses: next.lapses,
        lastGrade: next.lastGrade,
        bestStreak: next.bestStreak,
        updatedAt: new Date(next.updatedAt),
        fsrsCard: fsrsCardJson,
      },
    })
    merged.push(next)
  }
  return NextResponse.json({ entries: merged }, { headers: { 'cache-control': 'no-store' } })
}

/** Forget-line (chessreps "unlearn this line"): DELETE ?courseId&lineId. */
export async function DELETE(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: ORIGIN_BLOCKED_MSG }, { status: 403 })
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (!rateLimit(`openings-progress-del:${user.id}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 })
  }
  const courseId = req.nextUrl.searchParams.get('courseId')?.slice(0, 80)
  const lineId = req.nextUrl.searchParams.get('lineId')?.slice(0, 120)
  if (!courseId || !lineId) return NextResponse.json({ error: 'courseId and lineId required' }, { status: 400 })
  await db.openingProgress.deleteMany({ where: { userId: user.id, courseId, lineId } })
  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
}
