import { NextResponse } from 'next/server'
import { Chess } from 'chess.js'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'

// Chess Wrapped: one honest year-in-review payload built from what this
// account actually stored — nothing seeded, nothing invented. Everything is
// zero-defaulted, so a fresh account gets the same shape with empty numbers
// and the UI can render its honest empty state.

const DAY_MS = 24 * 60 * 60 * 1000
const YEAR_DAYS = 365
const MAX_GAMES_SCANNED = 1000

interface UnifiedGame {
  color: 'w' | 'b'
  result: 'win' | 'loss' | 'draw'
  opponent: string
  opening: string | null
  playerAcc: number | null
  /** half-moves replayed from the stored PGN, null when it will not parse */
  plies: number | null
  pool: string | null // online games only
  at: Date
}

function monthKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function dayKeyOf(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Next calendar day key (yyyy-mm-dd -> yyyy-mm-dd), via UTC calendar math. */
function nextDayKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

/** Half-move count by replaying the stored PGN; null when it will not parse. */
function pliesFromPgn(pgn: string): number | null {
  if (!pgn || !pgn.trim()) return null
  try {
    const board = new Chess()
    board.loadPgn(pgn)
    const history = board.history()
    return history.length > 0 ? history.length : null
  } catch {
    return null
  }
}

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })
  const pid = profile.id

  const now = new Date()
  const since = new Date(now.getTime() - YEAR_DAYS * DAY_MS)
  const sinceDayKey = dayKeyOf(since)

  // -- the raw material ------------------------------------------------------
  const [botRows, onlineRows, activityRows, lessonRows, profileFresh, dailyAttempts] = await Promise.all([
    db.gameRecord.findMany({ where: { profileId: pid }, orderBy: { createdAt: 'desc' }, take: MAX_GAMES_SCANNED }),
    db.onlineGame.findMany({
      where: { OR: [{ whiteId: user.id }, { blackId: user.id }], result: { not: '*' } },
      orderBy: { createdAt: 'desc' },
      take: MAX_GAMES_SCANNED,
    }),
    db.activityDay.findMany({ where: { profileId: pid }, orderBy: { dayKey: 'asc' } }),
    db.lessonProgress.findMany({ where: { profileId: pid } }),
    db.profile.findUnique({
      where: { id: pid },
      select: { puzzleRating: true, puzzleSolved: true, puzzleFailed: true, bestPuzzleStreak: true, puzzleCount: true },
    }),
    db.puzzleAttempt.count({
      where: { profileId: pid, kind: 'daily', solved: true, createdAt: { gte: since } },
    }),
  ])

  const yearBots = botRows.filter((g) => g.createdAt >= since)
  const yearOnline = onlineRows.filter((g) => (g.endedAt ?? g.createdAt) >= since)

  // -- one unified game list from both sources -------------------------------
  const games: UnifiedGame[] = []
  for (const g of yearBots) {
    games.push({
      color: g.color === 'b' ? 'b' : 'w',
      result: g.result === 'win' || g.result === 'loss' ? g.result : 'draw',
      opponent: g.botName,
      opening: g.opening,
      playerAcc: g.playerAcc,
      plies: pliesFromPgn(g.pgn),
      pool: null,
      at: g.createdAt,
    })
  }
  for (const g of yearOnline) {
    const iAmWhite = g.whiteId === user.id
    games.push({
      color: iAmWhite ? 'w' : 'b',
      result: g.result === '1/2-1/2' ? 'draw' : (g.result === '1-0') === iAmWhite ? 'win' : 'loss',
      opponent: iAmWhite ? g.blackName : g.whiteName,
      opening: null, // online games carry no stored opening
      playerAcc: null, // no report exists for online games
      plies: pliesFromPgn(g.pgn),
      pool: g.pool,
      at: g.endedAt ?? g.createdAt,
    })
  }
  games.sort((a, b) => a.at.getTime() - b.at.getTime())

  const total = games.length
  const wins = games.filter((g) => g.result === 'win').length
  const draws = games.filter((g) => g.result === 'draw').length
  const losses = games.filter((g) => g.result === 'loss').length
  const asWhite = games.filter((g) => g.color === 'w').length
  const asBlack = total - asWhite

  // -- by month: fixed 12-month axis, zero-filled ----------------------------
  const monthKeys: string[] = []
  for (let i = 11; i >= 0; i--) {
    monthKeys.push(monthKeyOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))))
  }
  const monthCounts = new Map(monthKeys.map((k) => [k, 0]))
  for (const g of games) {
    const key = monthKeyOf(g.at)
    if (monthCounts.has(key)) monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1)
  }
  const byMonth = monthKeys.map((month) => ({ month, count: monthCounts.get(month) ?? 0 }))

  // -- accuracy, openings, time controls, longest battle ---------------------
  const accs = games.filter((g) => g.playerAcc != null)
  const avgAccuracy = accs.length
    ? Math.round((accs.reduce((s, g) => s + (g.playerAcc ?? 0), 0) / accs.length) * 10) / 10
    : null
  let bestAccGame: (typeof games)[number] | null = null
  for (const g of accs) {
    if (!bestAccGame || (g.playerAcc ?? 0) > (bestAccGame.playerAcc ?? 0)) bestAccGame = g
  }

  const openingCounts = new Map<string, number>()
  for (const g of games) {
    if (!g.opening) continue
    openingCounts.set(g.opening, (openingCounts.get(g.opening) ?? 0) + 1)
  }
  let favoriteOpening: { name: string; count: number } | null = null
  for (const [name, count] of openingCounts) {
    if (!favoriteOpening || count > favoriteOpening.count) favoriteOpening = { name, count }
  }

  const tcCounts = new Map<string, number>()
  for (const g of games) {
    const key = g.pool ?? 'bots' // bot/imported games have no stored clock; their own category
    tcCounts.set(key, (tcCounts.get(key) ?? 0) + 1)
  }
  const timeControls = [...tcCounts.entries()]
    .map(([pool, count]) => ({ pool, count }))
    .sort((a, b) => b.count - a.count)

  let longestGamePlies = 0
  for (const g of games) {
    if (g.plies != null && g.plies > longestGamePlies) longestGamePlies = g.plies
  }

  // -- puzzles, lessons, activity -------------------------------------------
  const yearActivity = activityRows.filter((r) => r.dayKey >= sinceDayKey)
  const puzzlesSolvedYear = yearActivity.reduce((s, r) => s + r.puzzlesSolved, 0)
  const totalMinutes = yearActivity.reduce((s, r) => s + r.minutes, 0)

  // best run of active days (any activity or goal met) inside the year window
  let bestActivityStreak = 0
  let run = 0
  let prev: string | null = null
  for (const r of yearActivity) {
    const active = r.minutes > 0 || r.goalMet
    if (!active) {
      run = 0
      prev = r.dayKey
      continue
    }
    run = prev !== null && nextDayKey(prev) === r.dayKey ? run + 1 : 1
    bestActivityStreak = Math.max(bestActivityStreak, run)
    prev = r.dayKey
  }

  const lessonsSteps = lessonRows.reduce((s, l) => s + l.stepsDone, 0)
  const lessonsCompleted = lessonRows.filter((l) => l.completed).length

  // -- the single pivotal moment of the year --------------------------------
  let pivotal: { fen: string; san: string; lossCp: number; date: string } | null = null
  for (const g of yearBots) {
    if (g.pivotLoss == null || !g.pivotFen || !g.pivotSan) continue
    if (!pivotal || g.pivotLoss > pivotal.lossCp) {
      pivotal = { fen: g.pivotFen, san: g.pivotSan, lossCp: Math.round(g.pivotLoss), date: g.createdAt.toISOString() }
    }
  }

  // -- milestones: generated from the numbers, never invented ----------------
  const milestones: string[] = []
  if (total > 0) {
    milestones.push(
      total >= 5
        ? `You played ${total} games — enough to fill a weekend tournament.`
        : `You played ${total} ${total === 1 ? 'game' : 'games'} this year.`,
    )
  }
  if (wins > 0) {
    const winRate = Math.round((wins / total) * 100)
    milestones.push(`You won ${wins} ${wins === 1 ? 'game' : 'games'} — a ${winRate}% score across everything you finished.`)
  }
  if (asWhite > 0 && asBlack > 0) {
    milestones.push(`You saw both sides: ${asWhite} games as White, ${asBlack} as Black.`)
  }
  if (longestGamePlies >= 20) {
    milestones.push(`Your longest battle lasted ${Math.ceil(longestGamePlies / 2)} moves (${longestGamePlies} half-moves).`)
  }
  if (bestAccGame?.playerAcc != null) {
    milestones.push(`Your sharpest game scored ${bestAccGame.playerAcc}% accuracy against ${bestAccGame.opponent}.`)
  }
  if (pivotal) {
    milestones.push(`One move threw away ${(pivotal.lossCp / 100).toFixed(1)} pawns — Game review flagged it as the turning point.`)
  }
  if (puzzlesSolvedYear > 0) {
    milestones.push(`You solved ${puzzlesSolvedYear} ${puzzlesSolvedYear === 1 ? 'puzzle' : 'puzzles'} this year.`)
  }
  if (profileFresh && profileFresh.bestPuzzleStreak > 1) {
    milestones.push(`Best puzzle streak: ${profileFresh.bestPuzzleStreak} in a row.`)
  }
  if (profileFresh?.puzzleRating != null && profileFresh.puzzleCount >= 10) {
    milestones.push(`Your puzzle rating settled at ${profileFresh.puzzleRating} over ${profileFresh.puzzleCount} rated puzzles.`)
  }
  if (lessonsCompleted > 0) {
    milestones.push(`You completed ${lessonsCompleted} ${lessonsCompleted === 1 ? 'lesson' : 'lessons'}${lessonsSteps > 0 ? ` — ${lessonsSteps} steps drilled` : ''}.`)
  }
  if (totalMinutes > 0) {
    const h = Math.floor(totalMinutes / 60)
    const m = totalMinutes % 60
    milestones.push(`You put in ${h > 0 ? `${h}h ` : ''}${m}m of active time. Idle minutes never counted.`)
  }
  if (bestActivityStreak >= 3) {
    milestones.push(`You showed up ${bestActivityStreak} days in a row — that is the habit that moves ratings.`)
  }

  // honest emptiness: nothing at all was stored in the window
  const hasData =
    total > 0 || puzzlesSolvedYear > 0 || lessonsSteps > 0 || totalMinutes > 0 || profileFresh?.puzzleRating != null

  return NextResponse.json({
    windowDays: YEAR_DAYS,
    generatedAt: now.toISOString(),
    hasData,
    games: {
      total,
      byMonth,
      wins,
      draws,
      losses,
      asWhite,
      asBlack,
      avgAccuracy,
      bestAccuracyGame: bestAccGame
        ? {
            accuracy: bestAccGame.playerAcc,
            date: bestAccGame.at.toISOString(),
            opponent: bestAccGame.opponent,
            opening: bestAccGame.opening,
          }
        : null,
      longestGamePlies,
      favoriteOpening,
      timeControls,
    },
    puzzles: {
      solved: puzzlesSolvedYear,
      solvedAllTime: profileFresh?.puzzleSolved ?? profile.puzzleSolved,
      bestStreak: profileFresh?.bestPuzzleStreak ?? 0,
      currentRating: profileFresh?.puzzleRating ?? null,
      dailyDone: dailyAttempts,
    },
    lessons: { stepsDone: lessonsSteps, completed: lessonsCompleted },
    streaks: { bestActivityStreak, totalMinutes },
    pivotalMoment: pivotal,
    milestones,
  })
}
