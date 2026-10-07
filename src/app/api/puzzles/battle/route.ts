import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { bumpActivity } from '@/lib/server/skill'
import { dayKeyLocal } from '@/lib/day'
import { numOr, publicProfile } from '@/lib/api'
import { BOTS } from '@/lib/chess/bots'

/**
 * Puzzle Battle records. Casual head-to-head mode: puzzle Elo and
 * PuzzleAttempt rows are never touched here, an honest match record and
 * small capped XP are the whole prize.
 */

interface Totals {
  battles: number
  wins: number
  losses: number
  draws: number
}

async function aggregate(profileId: string) {
  const rows = await db.battleRecord.findMany({
    where: { profileId },
    orderBy: { createdAt: 'desc' },
    take: 500, // aggregate over a sane window; nobody relives 500 battles in one screen
  })
  const totals: Totals = { battles: rows.length, wins: 0, losses: 0, draws: 0 }
  const vsBot = new Map<string, Totals>()
  for (const r of rows) {
    const key = r.result === 'win' ? 'wins' : r.result === 'loss' ? 'losses' : 'draws'
    totals[key] += 1
    let t = vsBot.get(r.botId)
    if (!t) {
      t = { battles: 0, wins: 0, losses: 0, draws: 0 }
      vsBot.set(r.botId, t)
    }
    t.battles += 1
    t[key] += 1
  }
  return {
    totals,
    vsBot: Object.fromEntries(vsBot),
    recent: rows.slice(0, 5).map((r) => ({
      botId: r.botId,
      botName: r.botName,
      you: r.you,
      bot: r.bot,
      result: r.result,
      createdAt: r.createdAt.toISOString(),
    })),
  }
}

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) return NextResponse.json({ totals: { battles: 0, wins: 0, losses: 0, draws: 0 }, vsBot: {}, recent: [] })
  return NextResponse.json(await aggregate(profile.id))
}

/** POST: record a finished battle, award small capped XP. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  const body = await req.json().catch(() => ({}))
  // The opponent must be one of the real roster bots; anything else is junk.
  const bot = BOTS.find((b) => b.id === String(body.botId ?? ''))
  if (!bot) return NextResponse.json({ error: 'Unknown bot' }, { status: 400 })
  const you = numOr(body.you, 0, 0, 5)
  const botScore = numOr(body.bot, 0, 0, 5)
  const rounds = numOr(body.rounds, 5, 1, 9)
  const result = you > botScore ? 'win' : you < botScore ? 'loss' : 'draw'
  const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dayKey ?? '')) ? String(body.dayKey) : dayKeyLocal()

  await db.battleRecord.create({
    data: { profileId: pid, botId: bot.id, botName: bot.name, you, bot: botScore, result, rounds, dayKey },
  })

  // Winning a head-to-head is worth a fraction of a Rush run; losing still
  // counts as showing up, capped so grinding bots never prints XP.
  const xpGain = result === 'win' ? 40 : result === 'draw' ? 12 : 4

  await db.profile.update({
    where: { id: pid },
    data: { xp: { increment: xpGain } },
  })

  // Real solves in battle count as real puzzle activity, nothing invented.
  await bumpActivity(pid, dayKey, 'puzzlesSolved', you)

  const updated = await db.profile.findUnique({ where: { id: pid } })
  return NextResponse.json({
    profile: updated ? publicProfile(updated) : null,
    xpGain,
    result,
    ...(await aggregate(pid)),
  })
}
