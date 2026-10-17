// GET /api/public/leaderboard — the anonymous aggregate variant of the
// session-gated puzzle leaderboard: top 20 by puzzle rating among onboarded
// profiles (same qualification rules: >= 5 solved, rated), public display
// names only. No user ids, no emails, no account metadata. Empty list when
// nobody qualifies yet.
import { NextRequest, NextResponse } from 'next/server'
import { preflight, withPublic } from '@/lib/server/public-api'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  return withPublic(req, async () => {
    const top = await db.profile.findMany({
      where: {
        onboarded: true,
        puzzleRating: { not: null },
        puzzleCount: { gte: 5 },
        userId: { not: null },
      },
      orderBy: [{ puzzleRating: 'desc' }, { puzzleSolved: 'desc' }],
      take: 20,
      select: { name: true, puzzleRating: true, puzzleSolved: true },
    })
    return NextResponse.json({
      leaders: top.map((p) => ({
        name: p.name || 'Solver',
        puzzleRating: p.puzzleRating ?? 0,
        solved: p.puzzleSolved,
      })),
    })
  })
}

export function OPTIONS() {
  return preflight()
}
