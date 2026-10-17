import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { lichessCount } from '@/lib/server/lichess-bank'

/**
 * GET: the puzzle-solver leaderboard.
 *
 * - Top 20 by puzzle rating among onboarded profiles with at least 5 solved
 *   puzzles and a rating, joined to User for the display name.
 * - The caller's own rank (null while unranked), computed with the same
 *   ordering rules so it matches the table even outside the top 20.
 * - lichessTotal: the honest size of the Lichess bank behind the puzzles.
 */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const where = {
    onboarded: true,
    puzzleRating: { not: null },
    puzzleCount: { gte: 5 },
    userId: { not: null },
  }

  const top = await db.profile.findMany({
    where,
    orderBy: [{ puzzleRating: 'desc' }, { puzzleSolved: 'desc' }],
    take: 20,
    select: {
      puzzleRating: true,
      puzzleSolved: true,
      user: { select: { username: true } },
    },
  })

  const rows = top.map((p, i) => ({
    rank: i + 1,
    name: p.user?.username ?? 'Solver',
    rating: p.puzzleRating ?? 0,
    solved: p.puzzleSolved,
  }))

  // The caller's rank, if they qualify. Same ordering as the table:
  // rating desc, then solved count desc.
  let me: { rank: number; name: string; rating: number; solved: number } | null = null
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
    select: { name: true, puzzleRating: true, puzzleSolved: true, puzzleCount: true, onboarded: true, user: { select: { username: true } } },
  })
  if (
    profile &&
    profile.onboarded &&
    profile.puzzleRating != null &&
    profile.puzzleCount >= 5
  ) {
    const rating = profile.puzzleRating
    const solved = profile.puzzleSolved
    const ahead = await db.profile.count({
      where: {
        ...where,
        OR: [
          { puzzleRating: { gt: rating } },
          { puzzleRating: rating, puzzleSolved: { gt: solved } },
        ],
      },
    })
    me = {
      rank: ahead + 1,
      name: profile.user?.username ?? profile.name,
      rating,
      solved,
    }
  }

  return NextResponse.json({ rows, me, lichessTotal: lichessCount() })
}
