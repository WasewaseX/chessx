// Given a list of UCI moves played so far (JSON array) and the side to move,
// pick a reasonable legal move and print it as UCI.
import { Chess } from 'chess.js'

const moves: string[] = JSON.parse(process.argv[2] ?? '[]')
const chess = new Chess()
for (const uci of moves) {
  if (uci.length >= 4) {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined })
  }
}

const verbose = chess.moves({ verbose: true })
if (verbose.length === 0) process.exit(0)

// prefer: mate > big capture > any capture > quiet developing move
function value(t?: string) {
  return t === 'q' ? 9 : t === 'r' ? 5 : t === 'b' || t === 'n' ? 3 : 1
}
let best = verbose[0]
let bestScore = -Infinity
for (const m of verbose) {
  let score = 0
  if (m.san.includes('#')) score = 1000
  else if (m.captured) score = 10 + value(m.captured) - value(m.piece) / 10
  else if (['d4', 'e4', 'd5', 'e5', 'c4', 'c5', 'Nf3', 'Nc6', 'Bc4', 'Bf8', 'Be7', 'Nf6'].includes(m.san)) score = 2
  // small randomness among equals
  score += Math.random()
  if (score > bestScore) {
    bestScore = score
    best = m
  }
}
process.stdout.write(best.from + best.to + (best.promotion ?? ''))
