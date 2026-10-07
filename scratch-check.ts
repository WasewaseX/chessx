// Scratch check for 5-c-1 planned additions. Delete after use.
import { Chess } from 'chess.js'

const cases: Array<{ name: string; fen: string; moves: string[]; expectMateEnd?: boolean }> = [
  { name: 'adv-01 payoff Qd8#', fen: '6k1/5ppp/8/8/8/8/8/3Q2K1 w - - 0 1', moves: ['Qd8#'], expectMateEnd: true },
  { name: 'adv-02 payoff Qxd8#', fen: '3r2k1/5ppp/8/8/8/8/5PPP/3QR1K1 w - - 0 1', moves: ['Qxd8#'], expectMateEnd: true },
  { name: 'adv-03 demo smothered', fen: '5r1k/6pp/7N/8/2Q5/8/8/6K1 w - - 0 1', moves: ['Qg8+', 'Rxg8', 'Nf7#'], expectMateEnd: true },
  { name: 'adv-03 payoff Nf7#', fen: '6rk/6pp/7N/8/8/8/8/6K1 w - - 0 2', moves: ['Nf7#'], expectMateEnd: true },
  { name: 'adv-04 payoff g5 Nd7 h5', fen: 'r1bq1rk1/ppp2ppp/2n2n2/3p4/3P2PP/2N2N2/PPP2P2/R1BQ1RK1 w - - 0 10', moves: ['g5', 'Nd7', 'h5'] },
  { name: 'adv-06 payoff Qg7#', fen: '6k1/5p1p/7Q/8/8/8/1B6/6K1 w - - 0 1', moves: ['Qg7#'], expectMateEnd: true },
  { name: 'adv-07 payoff Nc7+ Kd7 Nxa8', fen: 'r1r1k3/8/8/1N6/8/8/8/6K1 w - - 0 1', moves: ['Nc7+', 'Kd7', 'Nxa8'] },
  { name: 'adv-08 payoff Nxd5', fen: 'r1bqk2r/pppp1ppp/2n5/3p4/3P4/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 7', moves: ['Nxd5'] },
  { name: 'adv-11 payoff Bc4', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', moves: ['Bc4'] },
  { name: 'adv-12 payoff Rxd5', fen: '6k1/pp3ppp/8/3p4/8/8/PP3PPP/3R2K1 w - - 0 1', moves: ['Rxd5'] },
  { name: 'adv-14 payoff Rd1+ Kc6 Rc1+', fen: '4k3/8/3K4/4P3/8/8/8/7r b - - 0 1', moves: ['Rd1+', 'Kc6', 'Rc1+'] },
  { name: 'adv-15 payoff Ra8#', fen: '7k/R7/6K1/8/8/8/8/8 w - - 0 1', moves: ['Ra8#'], expectMateEnd: true },
  { name: 'adv-17 payoff Ne7+ Kf8 Nxc8', fen: '2r3k1/5ppp/8/3N4/8/8/8/6K1 w - - 0 1', moves: ['Ne7+', 'Kf8', 'Nxc8'] },
]

let bad = 0
for (const c of cases) {
  let g: Chess
  try {
    g = new Chess(c.fen)
  } catch (e) {
    console.log(`FAIL ${c.name}: bad FEN ${c.fen} (${e})`)
    bad++
    continue
  }
  let ok = true
  for (let i = 0; i < c.moves.length; i++) {
    const san = c.moves[i]
    try {
      const mv = g.move(san)
      if (!mv) throw new Error('null move')
      if (san.includes('x') && !mv.captured) { console.log(`FAIL ${c.name}: "${san}" says capture but is not`); ok = false }
      if (mv.captured && !san.includes('x')) { console.log(`FAIL ${c.name}: "${san}" hides a capture`); ok = false }
      if (san.includes('#') && !g.isCheckmate()) { console.log(`FAIL ${c.name}: "${san}" says mate but is not`); ok = false }
      if (san.includes('+') && !g.isCheck()) { console.log(`FAIL ${c.name}: "${san}" says check but is not`); ok = false }
      if (g.isCheckmate() && !san.includes('#')) { console.log(`FAIL ${c.name}: mate but SAN lacks #`); ok = false }
      if (g.isCheck() && !san.includes('+') && !san.includes('#')) { console.log(`FAIL ${c.name}: check but SAN lacks +`); ok = false }
    } catch (e) {
      console.log(`FAIL ${c.name}: illegal "${san}" at ply ${i + 1} (${e})`)
      ok = false
      break
    }
  }
  if (ok && c.expectMateEnd && !g.isCheckmate()) { console.log(`FAIL ${c.name}: should end in mate`); ok = false }
  if (ok) console.log(`OK   ${c.name}  (final fen: ${g.fen()})`)
  else bad++
}
console.log(bad === 0 ? '\nAll planned lines valid.' : `\n${bad} case(s) failed.`)
process.exit(bad === 0 ? 0 : 1)
