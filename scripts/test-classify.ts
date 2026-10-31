// Proof test for the chess.com-accurate move classifier (task 2-b).
//
// Tests the PURE classifier in src/lib/chess/move-classification.ts plus the
// conservative book table in src/lib/chess/openings.ts. No server imports —
// the engine wiring (game-report.ts) feeds classifyMove the exact inputs
// crafted here.
//
// Run: bun scripts/test-classify.ts
import { Chess } from 'chess.js'
import {
  classifyMove,
  winPercentFromPawns,
  moverPov,
  type ClassifyInput,
} from '../src/lib/chess/move-classification'
import { isBookMove, BOOK_MAINLINES } from '../src/lib/chess/openings'

// ---------------------------------------------------------------------------
// The three test games' key positions
// ---------------------------------------------------------------------------

// Game 1 (probe position): Italian Game after 1.e4 e5 2.Nf3 Nc6 3.Bc4 — a
// normal middlegame position with 33 legal moves.
const ITALIAN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 6 4'

// Game 2: Morphy's Opera Game, after 15...Nxd7 — the famous Qb8+!! queen sac:
// 16.Qb8+! Nxb8 17.Rd8#. The engine gives White ~+7 before; after Qb8+ the
// position is a forced mate in 3 (flattened to +80 white POV).
const OPERA = '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16'

// Game 3: a back-rank mate position and a one-legal-reply position.
const BACKRANK_MATE = '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1'
const ONE_REPLY = '5k2/8/8/8/8/7q/8/R6K w - - 0 1' // Qh3+ — only Kg1

const legalCount = (fen: string) => new Chess(fen).moves().length

interface Case {
  name: string
  expected: string
  input: ClassifyInput
}

const emptyInput: ClassifyInput = {
  fenBefore: ITALIAN,
  san: '',
  color: 'w',
  before: 0,
  after: 0,
  mateBeforeForWhite: null,
  mateBeforePlies: null,
  mateAfterForWhite: null,
  mateAfterPlies: null,
  bestSan: null,
  secondBestSan: null,
  secondBestBefore: null,
  legalMoveCount: legalCount(ITALIAN),
  isBest: false,
  movedPiece: null,
  capturedPiece: null,
  offerCanBeTaken: false,
  bestReplyTakesOffer: false,
  bookHit: false,
  ply: 10,
}

const c = (name: string, expected: string, over: Partial<ClassifyInput>): Case => ({
  name,
  expected,
  input: { ...emptyInput, ...over },
})

const cases: Case[] = [
  // (a) best move, no sacrifice -> best
  c('a1 best: quiet best move, no sac', 'best', {
    san: 'Nc3',
    before: 0.35,
    after: 0.38,
    bestSan: 'Nc3',
    secondBestSan: 'O-O',
    secondBestBefore: 0.15,
    isBest: true,
    movedPiece: 'n',
    ply: 6,
  }),
  // (b) THE Opera Game queen sac — must be Brilliant
  c('b1 brilliant: Opera Game Qb8+!! queen sac', 'brilliant', {
    fenBefore: OPERA,
    san: 'Qb8+',
    legalMoveCount: legalCount(OPERA),
    before: 7.2,
    after: 80, // forced mate in 3 after the move, flattened
    mateAfterForWhite: true,
    mateAfterPlies: 5,
    bestSan: 'Qb8+',
    secondBestSan: 'Qb5',
    secondBestBefore: 2.5,
    isBest: true,
    movedPiece: 'q',
    capturedPiece: null,
    offerCanBeTaken: true, // ...Nxb8 is available
    bestReplyTakesOffer: true, // Nxb8 IS the engine's best reply
    ply: 30,
  }),
  // (c) a random sac that loses ~3 pawns -> blunder, NOT brilliant
  c('c1 blunder: sac drops 3 pawns, not best', 'blunder', {
    san: 'Bxf7+',
    before: 0.4,
    after: -2.6,
    bestSan: 'd4',
    isBest: false,
    movedPiece: 'b',
    capturedPiece: 'p',
    offerCanBeTaken: true,
    bestReplyTakesOffer: true,
    ply: 7,
  }),
  // (d) winning position drops to equality, not best -> missedwin
  c('d1 missedwin: +3.2 slips to +0.15', 'missedwin', {
    san: 'd3',
    before: 3.2,
    after: 0.15,
    bestSan: 'Ng5',
    secondBestSan: 'd3',
    secondBestBefore: 0.1,
    isBest: false,
    movedPiece: 'p',
    ply: 12,
  }),
  // (d2) missed win via a forced mate that was let slip
  c('d2 missedwin: forced mate let slip', 'missedwin', {
    san: 'Rd1',
    before: 80,
    after: 0.5,
    mateBeforeForWhite: true,
    mateBeforePlies: 3,
    bestSan: 'Qh7#',
    isBest: false,
    movedPiece: 'r',
    ply: 20,
  }),
  // (e) great: best move on a 10+ win%-point cliff
  c('e1 great: best on a 10+wp cliff', 'great', {
    san: 'O-O',
    before: 0.55,
    after: 0.55,
    bestSan: 'O-O',
    secondBestSan: 'Nh4',
    secondBestBefore: -1.75,
    isBest: true,
    movedPiece: 'k',
    ply: 9,
  }),
  // (e2) great clause 2: a working sacrifice that is NOT brilliant-grade
  // (cliff in [8,10) win% points, swing within -0.9) — lands here, never on brilliant
  c('e2 great: working sacrifice, not brilliant-grade', 'great', {
    san: 'Qxb7',
    before: 0.3,
    after: -0.35,
    bestSan: 'Qxb7',
    secondBestSan: 'Qe2',
    secondBestBefore: -0.9,
    isBest: true,
    movedPiece: 'q',
    capturedPiece: 'r',
    offerCanBeTaken: true,
    bestReplyTakesOffer: true,
    ply: 18,
  }),
  // (f) book: mainline Ruy Lopez move
  c('f1 book: mainline Ruy Lopez Bb5', 'book', {
    san: 'Bb5',
    bookHit: true,
    before: 0.3,
    after: 0.28,
    bestSan: 'Bb5',
    secondBestSan: 'Bc4',
    secondBestBefore: 0.2,
    isBest: true,
    movedPiece: 'b',
    ply: 5,
  }),
  // (g) forced: exactly one legal reply, small drop
  c('g1 forced: single legal reply', 'forced', {
    fenBefore: ONE_REPLY,
    san: 'Kg1',
    legalMoveCount: legalCount(ONE_REPLY),
    before: -0.5,
    after: -1.0,
    bestSan: 'Kg1',
    isBest: true,
    movedPiece: 'k',
    ply: 22,
  }),
  // (h) checkmate
  c('h1 checkmate: back-rank Re8#', 'checkmate', {
    fenBefore: BACKRANK_MATE,
    san: 'Re8#',
    legalMoveCount: legalCount(BACKRANK_MATE),
    before: 6.5,
    after: 80,
    mateAfterForWhite: true,
    mateAfterPlies: 1,
    bestSan: 'Re8#',
    isBest: true,
    movedPiece: 'r',
    ply: 34,
  }),
  // (j) REGRESSION for the user's complaint: the old rule (-0.6 drop allowed)
  // called this brilliant; the new gate must NOT. Best move, real QxR "sac",
  // -0.55 swing, second-best close -> plain best.
  c('j1 best (NOT brilliant): best QxR sac, small swing, rivals close', 'best', {
    san: 'Qxb7',
    before: 0.8,
    after: 0.25,
    bestSan: 'Qxb7',
    secondBestSan: 'Qd2',
    secondBestBefore: 0.4,
    isBest: true,
    movedPiece: 'q',
    capturedPiece: 'r',
    offerCanBeTaken: true,
    bestReplyTakesOffer: true,
    ply: 14,
  }),
  // (k/l/m/n/o) tier boundaries on the mover's win% drop
  c('k1 excellent: drop < 2wp', 'excellent', { san: 'a3', before: 1.2, after: 1.1, bestSan: 'h3', isBest: false, movedPiece: 'p', ply: 11 }),
  c('l1 good: 2 <= drop < 5wp', 'good', { san: 'a3', before: 1.2, after: 0.85, bestSan: 'h3', isBest: false, movedPiece: 'p', ply: 11 }),
  c('m1 inaccuracy: 5 <= drop < 10wp', 'inaccuracy', { san: 'a3', before: 1.2, after: 0.45, bestSan: 'h3', isBest: false, movedPiece: 'p', ply: 11 }),
  c('n1 mistake: 10 <= drop < 20wp', 'mistake', { san: 'a3', before: 0.6, after: -1.4, bestSan: 'h3', isBest: false, movedPiece: 'p', ply: 11 }),
  // (o1) a best sacrifice into a clearly worse position is NEVER brilliant:
  // after < -0.5 fails brilliant's comfort gate; the 10+wp cliff makes it great
  c('o1 great (NOT brilliant): best sac into a clearly worse position', 'great', {
    san: 'Rxe5',
    before: 0.9,
    after: -0.7,
    bestSan: 'Rxe5',
    secondBestSan: 'Qe2',
    secondBestBefore: -1.4,
    isBest: true,
    movedPiece: 'r',
    capturedPiece: 'p',
    offerCanBeTaken: true,
    bestReplyTakesOffer: true,
    ply: 16,
  }),
]

// (o2) comfort-gate boundary: sac leaves the position worse than -0.5, rivals
// close (cliff < 8) -> brilliant's comfort gate and both great clauses fail -> plain best
cases.push(
  c('o2 best (NOT brilliant): sac leaves position worse than -0.5', 'best', {
    san: 'Rxe5',
    before: 0.1,
    after: -0.55,
    bestSan: 'Rxe5',
    secondBestSan: 'Qe2',
    secondBestBefore: -0.75,
    isBest: true,
    movedPiece: 'r',
    capturedPiece: 'p',
    offerCanBeTaken: true,
    bestReplyTakesOffer: true,
    ply: 16,
  }),
)

// ---------------------------------------------------------------------------

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}

function checkBasics() {
  // win% helper sanity
  if (Math.abs(winPercentFromPawns(0) - 50) > 1e-9) fail('winPercentFromPawns(0) != 50')
  if (winPercentFromPawns(80) < 99.9) fail('winPercentFromPawns(80) should be ~100')
  if (winPercentFromPawns(-80) > 0.1) fail('winPercentFromPawns(-80) should be ~0')
  if (!(winPercentFromPawns(2) > winPercentFromPawns(1) && winPercentFromPawns(1) > 50)) fail('winPercentFromPawns not monotone')
  if (moverPov(3, 'b') !== -3 || moverPov(3, 'w') !== 3) fail('moverPov broken')

  // every compact theory mainline must be legal SAN from the start position
  for (const line of BOOK_MAINLINES) {
    const g = new Chess()
    for (const san of line.split(/\s+/)) {
      try {
        g.move(san)
      } catch {
        fail(`BOOK_MAINLINES has an illegal move: "${san}" in line "${line}"`)
      }
    }
  }

  // book table behavior: standard lines in, sidelines/out-of-book out
  const g = new Chess()
  if (!isBookMove(g.fen(), 'e4', 1)) fail('1.e4 should be book')
  if (!isBookMove(g.fen(), 'd4', 1)) fail('1.d4 should be book')
  if (isBookMove(g.fen(), 'h4', 1)) fail('1.h4 must NOT be book (conservative)')
  if (isBookMove(g.fen(), 'e4', 21)) fail('ply gate: 1.e4 at ply 21 must NOT be book')
  g.move('e4')
  for (const san of ['e5', 'Nf3', 'Nc6']) g.move(san)
  const fenAfter4 = g.fen()
  if (!isBookMove(fenAfter4, 'Bb5', 5)) fail('3.Bb5 should be book (Ruy Lopez mainline)')
  if (!isBookMove(fenAfter4, 'Bc4', 5)) fail('3.Bc4 should be book (Italian mainline)')
  if (isBookMove(fenAfter4, 'Na5', 5)) fail('3.Na5 must NOT be book')
  if (!isBookMove(fenAfter4, 'Bb5+', 5)) fail('book match must be suffix-insensitive')
  // position facts used by the crafted cases
  if (legalCount(ONE_REPLY) !== 1) fail(`ONE_REPLY position must have exactly 1 legal move, got ${legalCount(ONE_REPLY)}`)
  if (legalCount(OPERA) <= 1) fail('Opera position must have many legal moves')
  const operaProbe = new Chess(OPERA)
  const q = operaProbe.move('Qb8+')
  if (!q) fail('Qb8+ must be legal in the Opera position')
  const replies = new Chess(fenOfAfterQb8()).moves({ verbose: true })
  const takeB8 = replies.filter((m) => m.to === 'b8' && m.captured)
  if (takeB8.length !== 1 || takeB8[0].san.replace('+', '') !== 'Nxb8') fail('after Qb8+ the only capture of the queen must be Nxb8')
}

// helper: FEN after Qb8+ in the Opera position
function fenOfAfterQb8(): string {
  const g = new Chess(OPERA)
  g.move('Qb8+')
  return g.fen()
}

function main() {
  checkBasics()

  const rows: string[] = []
  let passed = 0
  for (const kase of cases) {
    const got = classifyMove(kase.input)
    const ok = got === kase.expected
    if (ok) passed++
    rows.push(`${ok ? 'PASS' : 'FAIL'}  ${kase.name.padEnd(62)} expected=${kase.expected.padEnd(11)} got=${got}`)
  }

  console.log('chess.com-accurate classifier — proof table')
  console.log('-'.repeat(110))
  for (const r of rows) console.log(r)
  console.log('-'.repeat(110))

  const brilliantCase = classifyMove(cases.find((k) => k.name.includes('Opera'))!.input)
  const legalOp = legalCount(OPERA)
  console.log(`\nOpera Game facts: legalMoveCount=${legalOp}, Qb8+ label=${brilliantCase} (MUST be brilliant)`)
  if (brilliantCase !== 'brilliant') fail('the Opera Game Qb8+ case did NOT classify as brilliant')

  // explicit non-brilliant regression assertions
  const j1 = classifyMove(cases.find((k) => k.name.startsWith('j1'))!.input)
  if (j1 === 'brilliant') fail('regression: the loose -0.6-drop sac got a brilliant again')

  console.log(`\n${passed}/${cases.length} cases passed`)
  if (passed !== cases.length) process.exit(1)
  console.log('ALL PASSED')
}

main()
