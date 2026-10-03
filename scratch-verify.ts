// Scratch verification for Level 5 master-class content.
// Run: bun scratch-verify.ts
import { Chess } from 'chess.js'

let fails = 0
function ok(cond: boolean, msg: string) {
  if (!cond) { fails++; console.log('  FAIL: ' + msg) } else { console.log('  ok: ' + msg) }
}

function play(fen: string, moves: string[], label: string): string {
  const g = new Chess(fen)
  for (let i = 0; i < moves.length; i++) {
    const san = moves[i]
    try {
      const mv = g.move(san)
      if (!mv) throw new Error('null')
      if (san.includes('x') && !mv.captured) { fails++; console.log(`FAIL [${label}] "${san}" not a capture`) }
      if (mv.captured && !san.includes('x')) { fails++; console.log(`FAIL [${label}] "${san}" hides capture`) }
      if (san.includes('#') && !g.isCheckmate()) { fails++; console.log(`FAIL [${label}] "${san}" not mate`) }
      if (san.includes('+') && !g.isCheck()) { fails++; console.log(`FAIL [${label}] "${san}" not check`) }
      if (g.isCheckmate() && !san.includes('#')) { fails++; console.log(`FAIL [${label}] mate without #`) }
      if (g.isCheck() && !san.includes('+') && !san.includes('#')) { fails++; console.log(`FAIL [${label}] check without +`) }
    } catch {
      fails++
      console.log(`FAIL [${label}] illegal "${san}" ply ${i + 1} from ${fen} line [${moves.join(' ')}]`)
      return g.fen()
    }
  }
  console.log(`  ok: [${label}] line played: ${moves.join(' ')}`)
  return g.fen()
}

function isMate(fen: string, san: string, label: string) {
  const g = new Chess(fen)
  try { g.move(san) } catch { fails++; console.log(`FAIL [${label}] illegal ${san} from ${fen}`); return }
  ok(g.isCheckmate(), `[${label}] ${san} is checkmate`)
}

function onlyMove(fen: string, expected: string, label: string) {
  const g = new Chess(fen)
  const legal = g.moves()
  ok(legal.length === 1 && legal[0] === expected, `[${label}] sole legal move is ${expected} (got: ${legal.join(', ')})`)
}

console.log('=== OPERA GAME: full line + chained FENs ===')
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const seg1 = ['e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4']
const seg2 = ['dxe5', 'Bxf3', 'Qxf3', 'dxe5']
const seg3 = ['Bc4', 'Nf6', 'Qb3', 'Qe7']
const seg4 = ['Nc3', 'c6', 'Bg5', 'b5']
const seg5 = ['Nxb5', 'cxb5', 'Bxb5+', 'Nbd7', 'O-O-O', 'Rd8', 'Rxd7']
const seg6 = ['Rxd7', 'Rd1', 'Qe6', 'Bxd7+', 'Nxd7', 'Qb8+']
const seg7 = ['Nxb8', 'Rd8#']

const f1 = play(START, seg1, 'opera 1')
const f2 = play(f1, seg2, 'opera 2')
const f3 = play(f2, seg3, 'opera 3')
const f4 = play(f3, seg4, 'opera 4')
const f5 = play(f4, seg5, 'opera 5')
const f6 = play(f5, seg6, 'opera 6')
play(f6, seg7, 'opera 7 (mate)')

// full game in one go as cross-check
const full = [...seg1, ...seg2, ...seg3, ...seg4, ...seg5, ...seg6, ...seg7]
const gFull = new Chess(START)
for (const m of full) gFull.move(m)
ok(gFull.isCheckmate(), 'opera full game ends in mate')

console.log('\nChained FENs to paste:')
console.log('after seg1 (3...Bg4):   ' + f1)
console.log('after seg2 (5...dxe5):  ' + f2)
console.log('after seg3 (7...Qe7):   ' + f3)
console.log('after seg4 (9...b5):    ' + f4)
console.log('after seg5 (13.Rxd7):   ' + f5)
console.log('after seg6 (16.Qb8+):   ' + f6)

console.log('\n=== BODEN construct ===')
const BODEN = 'k..r...r/ppp..ppp/8/q.b..b../8/2N2N2/PP..PPPP/..KR...R b - - 0 1'
const fBoden = play(BODEN, ['Qxc3+', 'bxc3', 'Ba3#'], 'boden demo')
// forcedness of the recapture: after Qxc3+ White must have exactly one legal move
{
  const g = new Chess(BODEN)
  g.move('Qxc3+')
  onlyMove(g.fen(), 'bxc3', 'boden forced reply')
}
// mate-in-1 exercise position (after bxc3)
const BODEN2 = 'k..r...r/ppp..ppp/8/..b..b../8/2P5/P...PPPP/..KR...R b - - 0 1'
isMate(BODEN2, 'Ba3#', 'boden exercise')
// full 3-move exercise line
play(BODEN, ['Qxc3+', 'bxc3', 'Ba3#'], 'boden exercise full')

console.log('\n=== DOVETAIL construct ===')
const DOVE = '..rrb.../pp1k1ppp/8/4Q3/5B2/8/PPP2PPP/5RK1 w - - 0 1'
isMate(DOVE, 'Qd6#', 'dovetail demo')

console.log('\n=== PHILIDOR smothered demo ===')
const PHIL = 'r4r1k/ppp3pp/8/6N1/8/1Q6/PP3PPP/4R1K1 w - - 0 1'
play(PHIL, ['Nf7+', 'Kg8', 'Nh6+', 'Kh8', 'Qg8+', 'Rxg8', 'Nf7#'], 'philidor demo')
{
  const g = new Chess(PHIL)
  g.move('Nf7+')
  // show White is not losing the knight immediately: Rxf7 Qxf7 exists
  const g2 = new Chess(g.fen())
  ok(g2.moves().includes('Rxf7'), 'philidor: Rxf7 is a legal Black try (demo notes Qxf7)')
}

console.log('\n=== PHILIDOR exercise (given FEN) ===')
const PHILEX = '3r3k/6pp/7N/8/8/1Q6/8/6K1 w - - 0 1'
play(PHILEX, ['Qg8+', 'Rxg8', 'Nf7#'], 'philidor exercise')
{
  const g = new Chess(PHILEX)
  g.move('Qg8+')
  onlyMove(g.fen(), 'Rxg8', 'philidor exercise forced reply')
}

console.log('\n=== GREEK GIFT demo ===')
const GREEK = '2b3rk/pp3ppp/5n2/4N3/8/3B1N2/PPP2PPP/6KR w - - 0 1'
play(GREEK, ['Bxh7+', 'Kxh7', 'Ng5+', 'Kg8'], 'greek gift demo')
{
  // verify claims: after Ng5+ Kg6 is illegal (Ne5 covers g6); queen path d1-h5 is clear after Nf3 moves
  const g = new Chess(GREEK)
  g.move('Bxh7+'); g.move('Kxh7'); g.move('Ng5+')
  ok(!g.moves().includes('Kg6'), 'greek: Kg6 illegal after Ng5+ (Ne5 covers)')
  ok(g.moves().includes('Kg8'), 'greek: Kg8 legal')
}

console.log('\n=== GREEK GIFT exercise (Qh7# mate in 1) ===')
const GREEKEX = '5rk1/5pp1/8/6NQ/8/8/5PPP/6K1 w - - 0 1'
isMate(GREEKEX, 'Qh7#', 'greek exercise')

console.log('\n=== ROOK LIFT demo ===')
const LIFT = 'r4rk1/ppp1bppp/3p1n2/8/8/3B4/PPPQNPPP/R1B2RK1 w - - 0 9'
play(LIFT, ['f4', 'Rf3', 'Rg3'], 'rook lift demo')

console.log('\n=== PLAYOUT FEN legality ===')
const PLAYOUT = 'r1bq1rk1/ppp2ppp/2n2n2/3pp3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 7'
try { new Chess(PLAYOUT); console.log('  ok: playout FEN parses') } catch { fails++; console.log('  FAIL: playout FEN') }

console.log('\n=== SANITY: quiz FENs parse (they are the chained opera FENs) ===')
for (const [i, f] of [f4, f5, f6].entries()) {
  try { new Chess(f); console.log(`  ok: quiz fen ${i + 1} parses`) } catch { fails++; console.log(`  FAIL: quiz fen ${i + 1}`) }
}

console.log(fails === 0 ? '\nALL SCRATCH CHECKS PASSED' : `\n${fails} SCRATCH FAILURES`)
process.exit(fails === 0 ? 0 : 1)
