import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PUZZLES } from '@/content/puzzles'
import { lichessById } from '@/lib/server/lichess-bank'
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
  // Attempts live against BOTH sources historically: the 5.77M-puzzle bank
  // (what every serving surface uses today) and the old static content pool
  // (early attempts). Resolve themes from the bank first, fall back to the
  // static pool so legacy history keeps counting.
  const staticThemes = new Map(PUZZLES.map((p) => [p.id, p.themes]))
  const bankCache = new Map<string, string[] | null>()
  const themesFor = (id: string): string[] | null => {
    if (bankCache.has(id)) return bankCache.get(id) ?? null
    const row = lichessById(id)
    const themes = row ? row.themes : (staticThemes.get(id) ?? null)
    bankCache.set(id, themes)
    return themes
  }
  const stats: Record<string, { attempts: number; solved: number }> = {}
  for (const a of attempts) {
    const themes = themesFor(a.puzzleId)
    if (!themes) continue // attempt on a puzzle id outside both pools: no theme to credit
    for (const t of themes) {
      const s = stats[t] ?? (stats[t] = { attempts: 0, solved: 0 })
      s.attempts += 1
      if (a.solved) s.solved += 1
    }
  }
  return NextResponse.json({ themes: stats })
}
