/**
 * Seed real theme attempts for the weak-themes strip, the honest way: every
 * attempt goes through the SAME server pipeline the browser uses — a legal
 * move is graded by /api/puzzles/move (the server owns the solution) and the
 * outcome is recorded by /api/puzzles/attempt. Nothing is fabricated: the
 * script plays a plausible but deliberately untested move and accepts whatever
 * the server's verdict is.
 *
 *   bun scripts/seed-theme-attempts.ts [theme=pin] [count=4] [rating=800]
 */
import { Chess } from 'chess.js'

const BASE = 'http://localhost:3000'
const THEME = process.argv[2] ?? 'pin'
const COUNT = Number(process.argv[3] ?? 4)
const RATING = Number(process.argv[4] ?? 800)

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: 'admin', password: 'admin1234' }),
})
if (!login.ok) throw new Error(`login failed: ${login.status}`)
const token = ((await login.json()) as { token?: string }).token
if (!token) throw new Error('no token in login response')
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

interface PoolPuzzle {
  id: string
  fen: string
  rating: number
  themes: string[]
  moveCount?: number
}

const idx = await fetch(`${BASE}/api/puzzles/index?themes=${THEME}&rating=${RATING}`, { headers: H })
if (!idx.ok) throw new Error(`index failed: ${idx.status}`)
const pool = ((await idx.json()) as { puzzles?: PoolPuzzle[] }).puzzles ?? []
if (pool.length === 0) throw new Error(`no ${THEME} puzzles near rating ${RATING}`)
console.log(`pool: ${pool.length} ${THEME} puzzles`)

let solved = 0
let missed = 0
for (const p of pool.slice(0, COUNT)) {
  // the pool fen is the position BEFORE the solver's move; pick a legal move
  // that is not mate-in-one greedily — most choices are not the tactic's point
  const chess = new Chess()
  chess.load(p.fen)
  const moves = chess.moves({ verbose: true })
  if (moves.length === 0) continue
  // prefer quiet moves: no captures, no checks — the least likely to be right
  const quiet = moves.filter((m) => !m.captured && !m.san.includes('+') && !m.san.includes('#'))
  const pick = (quiet.length ? quiet : moves)[Math.floor(Math.random() * (quiet.length || moves.length))]

  const grade = await fetch(`${BASE}/api/puzzles/move`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ puzzleId: p.id, played: [pick.san] }),
  })
  const verdict = (await grade.json()) as { correct?: boolean; error?: string }
  if (!grade.ok || typeof verdict.correct !== 'boolean') {
    console.log(`${p.id}: grading unavailable (${grade.status}) — skipped`)
    continue
  }
  // a one-move line is complete when the first move is correct; longer lines
  // are failed by design here (the script plays only the first move)
  const meta = await fetch(`${BASE}/api/puzzles/reveal`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ puzzleId: p.id }),
  }).catch(() => null)
  const lineLen = meta && meta.ok ? (((await meta.json()) as { solution?: string }).solution ?? '').trim().split(/\s+/).filter(Boolean).length : 1
  const isSolved = verdict.correct === true && lineLen <= 1

  const attempt = await fetch(`${BASE}/api/puzzles/attempt`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ puzzleId: p.id, solved: isSolved, kind: 'rated' }),
  })
  if (!attempt.ok) {
    console.log(`${p.id}: attempt not recorded (${attempt.status})`)
    continue
  }
  if (isSolved) solved++
  else missed++
  console.log(`${p.id} (${p.rating}): played ${pick.san} -> ${verdict.correct ? 'correct' : 'miss'}, recorded ${isSolved ? 'solved' : 'failed'}`)
}
console.log(`done: ${solved} solved, ${missed} missed (theme ${THEME})`)
