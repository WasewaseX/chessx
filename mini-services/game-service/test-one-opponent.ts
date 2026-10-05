// One real opponent client that plays a legitimate game against whoever is
// in the queue: it tracks the live FEN, replies with a legal capture-biased
// move using chess.js, and resigns after the agreed number of full moves so
// the game is long enough to rate (chess.com rule: 2+ moves per side).
// Usage: COOKIE=<token> [TC=10+0] [FULLMOVES=6] bun mini-services/game-service/test-one-opponent.ts
import { io, Socket } from 'socket.io-client'
import { Chess } from 'chess.js'

const BASE = 'http://localhost:3000'
const COOKIE = process.env.COOKIE!
const TC = process.env.TC ?? '10+0'
const FULLMOVES = Number(process.env.FULLMOVES ?? '6')

async function ticket(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/ticket`, { method: 'POST', headers: { cookie: COOKIE } })
  if (!res.ok) throw new Error(`ticket failed: ${res.status}`)
  const d = await res.json()
  return d.ticket
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function pickMove(chess: Chess): { from: string; to: string; promotion?: string } | null {
  const moves = chess.moves({ verbose: true })
  if (moves.length === 0) return null
  // prefer captures and checks, then development moves, to keep the game honest
  const captures = moves.filter((m) => m.captured)
  const pool = captures.length > 0 ? captures : moves
  const m = pool[Math.floor(Math.random() * Math.min(pool.length, 6))]
  return { from: m.from, to: m.to, promotion: m.promotion }
}

async function main() {
  const s: Socket = await new Promise((resolve, reject) => {
    const sock = io('http://localhost:3030', { transports: ['websocket'] })
    sock.on('connect', async () => {
      console.log('connected', sock.id)
      sock.emit('auth', { ticket: await ticket() })
    })
    sock.on('auth:ok', () => resolve(sock))
    sock.on('auth:failed', (d: unknown) => reject(new Error(JSON.stringify(d))))
    setTimeout(() => reject(new Error('connect timeout')), 8000)
  })
  console.log('authed, queueing', TC)
  s.emit('queue:join', { tc: TC })

  const game: { id: string; color: string } = await new Promise((res) =>
    s.on('match:found', (d: { game: { id: string; color: string } }) => res(d.game)),
  )
  const myColor = game.color
  console.log('matched as', myColor, 'in', game.id)

  const chess = new Chess()
  let myMoveCount = 0
  let resigned = false

  s.on('game:state', (st: { fen: string; turn: string; moves: string[] }) => {
    try {
      chess.load(st.fen)
    } catch {
      return
    }
    if (chess.turn() !== myColor) return
    if (myMoveCount >= FULLMOVES) {
      // our full quota is played; hand the human the full point
      if (!resigned) {
        resigned = true
        s.emit('resign', { gameId: game.id })
        console.log('resigned after', myMoveCount, 'moves')
      }
      return
    }
    const mv = pickMove(chess)
    if (!mv) return
    myMoveCount++
    setTimeout(() => {
      s.emit('move:make', { gameId: game.id, from: mv.from, to: mv.to, promotion: mv.promotion })
      console.log(`played ${myMoveCount}: ${mv.from}${mv.to}`)
    }, 900 + Math.random() * 900)
  })

  // resign once both sides made FULLMOVES moves (game is then rateable)
  const over: { result: string; myDelta: number | null; myNewRating: number | null } = await new Promise((res) =>
    s.on('game:over', (d: { result: string; myDelta: number | null; myNewRating: number | null }) => res(d)),
  )
  console.log('game over:', JSON.stringify(over))
  s.close()
  process.exit(0)
}

// The resign trigger: when the opponent (human or script) has replied to our
// FULLMOVES-th move, we offer our resignation to hand them the full point.
setInterval(() => {}, 10_000)

main().catch((e) => {
  console.error('OPPONENT FAIL:', e.message)
  process.exit(1)
})
