// Fallback engine used only if Stockfish fails to load. A compact
// alpha-beta search with piece-square tables. Not as strong as Stockfish,
// but dependable and fully offline.
/// <reference lib="webworker" />
import { Chess, type Move } from 'chess.js'

const PIECE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }

// piece-square tables (white POV, from a8..h1 rank order = index 0..63)
const PST_P = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
]
const PST_N = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50,
]
const PST_B = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20,
]
const PST_R = [
   0,  0,  0,  0,  0,  0,  0,  0,
   5, 10, 10, 10, 10, 10, 10,  5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
   0,  0,  0,  5,  5,  0,  0,  0,
]
const PST_Q = [
  -20,-10,-10, -5, -5,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5,  5,  5,  5,  0,-10,
   -5,  0,  5,  5,  5,  5,  0, -5,
    0,  0,  5,  5,  5,  5,  0, -5,
  -10,  5,  5,  5,  5,  5,  0,-10,
  -10,  0,  5,  0,  0,  0,  0,-10,
  -20,-10,-10, -5, -5,-10,-10,-20,
]
const PST_K_MID = [
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
   20, 20,  0,  0,  0,  0, 20, 20,
   20, 30, 10,  0,  0, 10, 30, 20,
]
const PST_K_END = [
  -50,-40,-30,-20,-20,-30,-40,-50,
  -30,-20,-10,  0,  0,-10,-20,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-30,  0,  0,  0,  0,-30,-30,
  -50,-30,-30,-30,-30,-30,-30,-50,
]

function mirror(i: number): number {
  const r = Math.floor(i / 8)
  const f = i % 8
  return (7 - r) * 8 + f
}

function evaluate(game: Chess): number {
  // white POV centipawns
  let score = 0
  let material = 0
  const board = game.board()
  let kings = 0
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = board[r][f]
      if (!sq) continue
      const idx = r * 8 + f
      const v = PIECE[sq.type]
      if (sq.type !== 'k' && sq.type !== 'p') material += v
      if (sq.type === 'k') kings++
      const table =
        sq.type === 'p' ? PST_P :
        sq.type === 'n' ? PST_N :
        sq.type === 'b' ? PST_B :
        sq.type === 'r' ? PST_R :
        sq.type === 'q' ? PST_Q :
        kings === 2 && material < 1300 ? PST_K_END : PST_K_MID
      const pst = table[sq.color === 'w' ? mirror(idx) : idx]
      score += sq.color === 'w' ? v + pst : -(v + pst)
    }
  }
  return score
}

function orderMoves(moves: Move[]): Move[] {
  return [...moves].sort((a, b) => {
    const va = (PIECE[a.captured ?? ''] ?? 0) * 10 - (PIECE[a.piece] ?? 0) + (a.promotion ? 800 : 0) + (a.san.includes('+') ? 50 : 0)
    const vb = (PIECE[b.captured ?? ''] ?? 0) * 10 - (PIECE[b.piece] ?? 0) + (b.promotion ? 800 : 0) + (b.san.includes('+') ? 50 : 0)
    return vb - va
  })
}

let nodes = 0
let hardStop = false

function qsearch(game: Chess, alpha: number, beta: number, depth: number, pov: number): number {
  nodes++
  const stand = evaluate(game) * pov
  if (depth === 0 || nodes > 60000) return stand
  if (stand >= beta) return beta
  if (stand > alpha) alpha = stand
  const caps = orderMoves(game.moves({ verbose: true }) as Move[]).filter((m) => m.captured || m.promotion)
  for (const m of caps) {
    game.move(m)
    const s = -qsearch(game, -beta, -alpha, depth - 1, -pov)
    game.undo()
    if (s >= beta) return beta
    if (s > alpha) alpha = s
  }
  return alpha
}

function search(game: Chess, depth: number, alpha: number, beta: number, pov: number): number {
  if (hardStop) return evaluate(game) * pov
  nodes++
  if (game.isCheckmate()) return -30000 + (10 - depth) * 10
  if (game.isDraw() || game.isStalemate()) return 0
  if (depth <= 0) return qsearch(game, alpha, beta, 6, pov)
  const moves = orderMoves(game.moves({ verbose: true }) as Move[])
  let best = -Infinity
  for (const m of moves) {
    game.move(m)
    const s = -search(game, depth - 1, -beta, -alpha, -pov)
    game.undo()
    if (s > best) best = s
    if (best > alpha) alpha = best
    if (alpha >= beta) break
    if (nodes > 180000) { hardStop = true; break }
  }
  return best
}

function pickMove(fen: string, level: number): { best: string; san: string } | null {
  const game = new Chess(fen)
  const moves = game.moves({ verbose: true }) as Move[]
  if (moves.length === 0) return null
  nodes = 0
  hardStop = false

  // Weaker levels sometimes just play something random.
  const blunderRates: Record<number, number> = { 1: 0.5, 2: 0.3, 3: 0.18, 4: 0.1 }
  const blunder = blunderRates[level] ?? 0
  if (Math.random() < blunder) {
    const m = moves[Math.floor(Math.random() * moves.length)]
    return { best: uciOf(m), san: m.san }
  }

  const depth = Math.max(1, Math.min(level + 1, 4))
  const pov = game.turn() === 'w' ? 1 : -1
  let bestMove = moves[0]
  let bestScore = -Infinity
  const scored: { m: Move; s: number }[] = []
  for (const m of orderMoves(moves)) {
    game.move(m)
    const s = -search(game, depth - 1, -Infinity, Infinity, -pov)
    game.undo()
    scored.push({ m, s })
    if (s > bestScore) {
      bestScore = s
      bestMove = m
    }
  }
  // Level 2-3: occasionally prefer a near-best move so play is less mechanical.
  if (level <= 3 && scored.length > 2) {
    scored.sort((a, b) => b.s - a.s)
    if (Math.random() < 0.3 && scored[1].s > bestScore - 60) bestMove = scored[1].m
  }
  return { best: uciOf(bestMove), san: bestMove.san }
}

function uciOf(m: Move): string {
  return m.from + m.to + (m.promotion ?? '')
}

function evalPosition(fen: string, depth: number): { scoreCp: number; mate: number | null; pv: string[] } {
  const game = new Chess(fen)
  nodes = 0
  hardStop = false
  const pov = game.turn() === 'w' ? 1 : -1
  if (game.isCheckmate()) return { scoreCp: 0, mate: game.turn() === 'w' ? -1 : 1, pv: [] }
  if (game.isDraw()) return { scoreCp: 0, mate: null, pv: [] }
  const moves = orderMoves(game.moves({ verbose: true }) as Move[])
  let bestMove = moves[0]
  let bestScore = -Infinity
  const pv: string[] = []
  const d = Math.max(1, Math.min(depth, 3))
  for (const m of moves) {
    game.move(m)
    const s = -search(game, d - 1, -Infinity, Infinity, -pov)
    game.undo()
    if (s > bestScore) {
      bestScore = s
      bestMove = m
    }
  }
  pv.push(uciOf(bestMove))
  // mate detection from score
  const abs = Math.abs(bestScore)
  if (abs > 29000) {
    const pliesToMate = d // rough
    return { scoreCp: 0, mate: bestScore > 0 ? Math.ceil(pliesToMate / 2) : -Math.ceil(pliesToMate / 2), pv }
  }
  return { scoreCp: Math.round(bestScore * pov), mate: null, pv }
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data
  try {
    if (msg.cmd === 'search') {
      const r = pickMove(msg.fen, msg.level ?? 5)
      ;(self as unknown as Worker).postMessage({ id: msg.id, type: 'bestmove', best: r?.best ?? null, san: r?.san ?? null })
    } else if (msg.cmd === 'eval') {
      const r = evalPosition(msg.fen, msg.depth ?? 2)
      ;(self as unknown as Worker).postMessage({ id: msg.id, type: 'eval', ...r })
    } else if (msg.cmd === 'ping') {
      ;(self as unknown as Worker).postMessage({ id: msg.id, type: 'pong' })
    }
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id: msg.id, type: 'error', error: String(err) })
  }
}
