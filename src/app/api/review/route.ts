import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PUZZLES } from '@/content/puzzles'
import { findLevel } from '@/content/levels'
import { gradeReview, sanitizeConcepts, updateMastery } from '@/lib/server/skill'

/**
 * GET: the review queue. Due items first, plus a look at upcoming load and
 * the weakest concepts from the skill model.
 */
export async function GET() {
  const now = new Date()
  const items = await db.reviewItem.findMany({ orderBy: { dueAt: 'asc' } })
  const due = items.filter((i) => i.dueAt <= now)
  const upcoming = items.filter((i) => i.dueAt > now)

  const queue = due.slice(0, 30).map((item) => {
    if (item.kind === 'puzzle') {
      const p = PUZZLES.find((x) => x.id === item.refId)
      return {
        id: item.id,
        kind: item.kind,
        refId: item.refId,
        concept: item.concept,
        reps: item.reps,
        lapses: item.lapses,
        dueAt: item.dueAt,
        puzzle: p ? { id: p.id, title: p.title, rating: p.rating, themes: p.themes, fen: p.fen } : null,
      }
    }
    const ref = findLevel(item.refId)
    return {
      id: item.id,
      kind: item.kind,
      refId: item.refId,
      concept: item.concept,
      reps: item.reps,
      lapses: item.lapses,
      dueAt: item.dueAt,
      lesson: ref ? { id: ref.level.id, title: ref.level.title, tierTitle: ref.tier.title } : null,
    }
  })

  const mastery = await db.skillMastery.findMany({ orderBy: { mastery: 'asc' } })
  const touched = mastery.filter((m) => m.attempts > 0)

  return NextResponse.json({
    queue,
    dueCount: due.length,
    upcomingCount: upcoming.length,
    mastery: touched.map((m) => ({
      concept: m.concept,
      mastery: m.mastery,
      attempts: m.attempts,
      correct: m.correct,
    })),
    nextDueAt: upcoming[0]?.dueAt ?? null,
  })
}

/** POST: grade a review item from the client after the student faced it. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const itemId = String(body.itemId ?? '')
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 })
  const success = Boolean(body.success)
  const concepts = sanitizeConcepts(body.concepts)

  const graded = await gradeReview(itemId, success)
  if (!graded) return NextResponse.json({ error: 'item not found' }, { status: 404 })
  if (concepts.length > 0) await updateMastery(concepts, success)

  return NextResponse.json({ item: graded })
}
