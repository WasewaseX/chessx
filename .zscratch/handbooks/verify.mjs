import { Chess } from 'chess.js'

// ---- line verifier: replay a FEN + SAN list, report legality + mate truth ----
function checkLine(name, fen, moves) {
  let g
  try { g = new Chess(fen) } catch (e) { console.log(`FEN FAIL [${name}]: ${fen}`); return }
  let ok = true
  for (let i = 0; i < moves.length; i++) {
    const san = moves[i]
    try {
      const mv = g.move(san)
      if (!mv) throw new Error('null')
      if (san.includes('x') && !mv.captured) { console.log(`[${name}] "${san}" claims capture but is not`); ok = false }
      if (mv.captured && !san.includes('x')) { console.log(`[${name}] "${san}" captures but SAN hides it`); ok = false }
      if (san.includes('#') && !g.isCheckmate()) { console.log(`[${name}] "${san}" says # but not mate`); ok = false }
      if (san.includes('+') && !g.isCheck()) { console.log(`[${name}] "${san}" says + but not check`); ok = false }
      if (g.isCheckmate() && !san.includes('#')) { console.log(`[${name}] mate but no "#" on ${san}`); ok = false }
      if (g.isCheck() && !san.includes('+') && !san.includes('#')) { console.log(`[${name}] check but no "+" on ${san}`); ok = false }
    } catch (e) {
      console.log(`[${name}] ILLEGAL "${san}" at ply ${i+1} from ${g.fen()}`)
      ok = false; break
    }
  }
  console.log(`${ok ? 'OK ' : 'BAD'} [${name}] ${fen} :: ${moves.join(' ')}`)
}

// KBN: corner net one-mover
checkLine('kbn-net', '7k/5K2/5N2B/8/8/8/8/8 w - - 0 1', ['Bg7#'])
// KBN: only-move drill (any quiet move = stalemate)
checkLine('kbn-only', '7k/5K2/5N2/2B5/8/8/8/8 w - - 0 1', ['Bg7#'])
// KBN: stalemate trap demo (Nf6 would be stalemate if bishop were quiet)
checkLine('kbn-stale', '7k/5K2/5N2/7B/8/8/8/8 w - - 0 1', ['Nf6'])
// KBN playout start position legality
checkLine('kbn-playout-start', '7k/8/8/5K2/3N4/8/7B/8 w - - 0 1', [])
// QvR fork exercise
checkLine('qvr-fork', '7k/6r1/6K1/8/8/8/1Q6/8 w - - 0 1', ['Qb8+', 'Rg8', 'Qh2#'])
// QvR trap: Qxg8+ Kxg8 = draw (bare kings)
let g = new Chess('7k/6r1/6K1/8/8/8/1Q6/8 w - - 0 1')
g.move('Qb8+'); g.move('Rg8'); g.move('Qxg8+'); g.move('Kxg8')
console.log(`qvr-trap end: ${g.fen()} materialWhite=${g.material().white} materialBlack=${g.material().black} isDraw50=${g.isDraw()}`)
