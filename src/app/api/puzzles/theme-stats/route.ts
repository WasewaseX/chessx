import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PUZZLES } from '@/content/puzzles'
import { getSessionUser } from '@/lib/auth'

// Per-theme practice stats, counted only from PuzzleAttempt rows that the
// player actually created. Nothing is seeded or projected: a theme with no
// attempts is simply absent from the response.
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const attempts = await db.puzzleAttempt.findMany({
    where: { profileId: profile.id },
    select: { puzzleId: true, solved: true },
  })
  const themesByPuzzle = new Map(PUZZLES.map((p) => [p.id, p.themes]))
  const stats: Record<string, { attempts: number; solved: number }> = {}
  for (const a of attempts) {
    const themes = themesByPuzzle.get(a.puzzleId)
    if (!themes) continue // attempt on a puzzle id outside the pool: no theme to credit
    for (const t of themes) {
      const s = stats[t] ?? (stats[t] = { attempts: 0, solved: 0 })
      s.attempts += 1
      if (a.solved) s.solved += 1
    }
  }
  return NextResponse.json({ themes: stats })
}
