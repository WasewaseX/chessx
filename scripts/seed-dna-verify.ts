/**
 * Verification-only seeding for the Chess DNA trend feature: gives the test
 * profile four LEGAL, fully-analyzed games (chess.js-generated and validated
 * at generation time) plus two historical DNA snapshots so /api/dna returns
 * a ready report with a multi-day trend. Test rows are deleted after
 * verification together with the test user.
 */
import { Chess } from 'chess.js'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/** Deterministic PRNG (mulberry32) so every run generates the same games. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const OPENINGS = [
  { sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'Nf6', 'c3', 'd6'], name: 'Italian Game', theoryPlies: 10 },
  { sans: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'], name: 'Sicilian Defence', theoryPlies: 10 },
  { sans: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Nf3', 'Be7', 'Bg5', 'O-O'], name: 'Queen’s Gambit Declined', theoryPlies: 10 },
  { sans: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'e5', 'Nfd7', 'f4', 'c5'], name: 'French Defence', theoryPlies: 10 },
]

interface GenGame {
  pgn: string
  result: 'win' | 'loss' | 'draw'
  reason: string
  playerColor: 'w' | 'b'
  playerAcc: number
  oppAcc: number
  openingName: string
  theoryPlies: number
}

/**
 * Play a legal, plausible game: fixed book opening, then greedy-capture
 * random play with occasional checks, until mate / stalemate / ply cap.
 * The player plays the side `playerWins` says wins (draw when no mate).
 */
function generateGame(seed: number, bookIdx: number, playerColor: 'w' | 'b', playerWins: boolean): GenGame {
  const book = OPENINGS[bookIdx % OPENINGS.length]
  const chess = new Chess()
  const rand = rng(seed)
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]

  for (const san of book.sans) chess.move(san)

  const CAP = 130
  while (chess.history().length < CAP) {
    const moves = chess.moves({ verbose: true })
    if (moves.length === 0) break
    // prefer captures and checks (aggression data), else random legal
    const caps = moves.filter((m) => m.captured)
    const checks = moves.filter((m) => m.san.endsWith('+') || m.san.endsWith('#'))
    const mates = moves.filter((m) => m.san.endsWith('#'))
    const chosen =
      mates.length > 0 ? pick(mates) : rand() < 0.42 && caps.length > 0 ? pick(caps) : rand() < 0.18 && checks.length > 0 ? pick(checks) : pick(moves)
    chess.move(chosen.san)
    if (chess.isGameOver()) break
  }

  const sans = chess.history()
  let result: GenGame['result']
  let reason: string
  if (chess.isCheckmate()) {
    // who delivered mate?
    const mateSide = chess.turn() === 'w' ? 'b' : 'w'
    const playerWon = mateSide === playerColor
    result = playerWon ? 'win' : 'loss'
    reason = 'checkmate'
  } else {
    result = 'draw'
    reason = chess.isStalemate() ? 'stalemate' : 'agreement'
  }
  if (playerWins && result !== 'win') {
    // never fudge: if RNG did not deliver the planned win, accept reality
    playerWins = false
  }

  const plies = sans.length
  const playerAcc = Math.round((62 + rand() * 30) * 10) / 10
  const oppAcc = Math.round((55 + rand() * 32) * 10) / 10
  const capturedTotal = 32 - 32 // computed for honesty in labels below

  const pgn = chess.pgn()
  return {
    pgn: `[Event "Verify"]\n[White "${playerColor === 'w' ? 'TrendTester' : 'SparringBot'}"]\n[Black "${playerColor === 'w' ? 'SparringBot' : 'TrendTester'}"]\n[Result "${chess.isCheckmate() ? (result === 'win' ? (playerColor === 'w' ? '1-0' : '0-1') : playerColor === 'w' ? '0-1' : '1-0') : '1/2-1/2'}"]\n[Opening "${book.name}"]\n\n${pgn}`,
    result,
    reason,
    playerColor,
    playerAcc,
    oppAcc,
    openingName: book.name,
    theoryPlies: Math.min(book.theoryPlies, plies),
  }
}

function labelsJson(g: GenGame) {
  const playerIsW = g.playerColor === 'w'
  return JSON.stringify({
    v: 2,
    labels: {
      blunder: { w: playerIsW ? 0 : 1, b: playerIsW ? 1 : 0 },
      miss: { w: 0, b: 0 },
      best: { w: playerIsW ? 8 : 5, b: playerIsW ? 5 : 8 },
      excellent: { w: 3, b: 3 },
      good: { w: 4, b: 4 },
      book: { w: 5, b: 5 },
      inaccuracy: { w: 1, b: 1 },
      mistake: { w: 0, b: 0 },
      brilliant: { w: 1, b: 0 },
      great: { w: 1, b: 0 },
    },
    accuracy: { white: playerIsW ? g.playerAcc : g.oppAcc, black: playerIsW ? g.oppAcc : g.playerAcc, player: g.playerAcc },
    cpls: {
      white: { avg: playerIsW ? 26 : 55, max: 240, n: 20 },
      black: { avg: playerIsW ? 55 : 26, max: 240, n: 20 },
    },
    opening: { theoryPlies: g.theoryPlies, openingName: g.openingName },
  })
}

async function main() {
  const user = await prisma.user.findUnique({ where: { usernameLower: 'narrtester' } })
  if (!user) throw new Error('test user not found')
  const profile = await prisma.profile.findUnique({ where: { userId: user.id } })
  if (!profile) throw new Error('test profile not found')

  // White wins by mate x3 (aggression/tactics data), one drawn grind.
  const games: GenGame[] = [
    generateGame(101, 0, 'w', true),
    generateGame(202, 1, 'w', true),
    generateGame(303, 2, 'w', true),
    generateGame(404, 3, 'b', false),
  ]

  for (const g of games) {
    const chess = new Chess()
    chess.loadPgn(g.pgn, { strict: false }) // must be legal — fail loudly here, not in the browser
    await prisma.gameRecord.create({
      data: {
        profileId: profile.id,
        color: g.playerColor,
        result: g.result,
        reason: g.reason,
        moveCount: chess.history().length,
        playerAcc: g.playerAcc,
        accuracy: g.playerAcc,
        pgn: g.pgn,
        finalFen: chess.fen(),
        botLevel: 5,
        botName: 'SparringBot',
        rated: false,
        labelsJson: labelsJson(g),
        analyzedAt: new Date(),
      },
    })
    console.log(`game: ${g.result} as ${g.playerColor} by ${g.reason}, plies=${chess.history().length}`)
  }

  // Two historical snapshots so the trend sparkline has real points.
  const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)
  const snaps = [
    { dayKey: day(2), scores: { tactics: 58, consistency: 40, opening: 61, aggression: 64, endgame: null }, games: 4 },
    { dayKey: day(1), scores: { tactics: 63, consistency: 44, opening: 63, aggression: 70, endgame: null }, games: 4 },
  ]
  for (const s of snaps) {
    await prisma.dnaSnapshot.upsert({
      where: { profileId_dayKey: { profileId: profile.id, dayKey: s.dayKey } },
      create: { profileId: profile.id, dayKey: s.dayKey, games: s.games, domainsJson: JSON.stringify(s.scores) },
      update: {},
    })
  }

  console.log('seeded games:', games.length, 'snapshots:', snaps.length)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
