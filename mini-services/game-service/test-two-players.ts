// Two real clients playing a rated game through the game service.
// Verifies matchmaking, clocks, resign and Glicko updates end to end.
// Usage: COOKIE_A=<token> COOKIE_B=<token> bun mini-services/game-service/test-two-players.ts
import { io, Socket } from 'socket.io-client'

const BASE = 'http://localhost:3000'
const COOKIE_A = process.env.COOKIE_A!
const COOKIE_B = process.env.COOKIE_B!

async function ticket(cookie: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/ticket`, { method: 'POST', headers: { cookie } })
  if (!res.ok) throw new Error(`ticket failed: ${res.status}`)
  const d = await res.json()
  return d.ticket
}

function client(cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io('http://localhost:3030', { transports: ['websocket'] })
    s.on('connect', async () => {
      s.emit('auth', { ticket: await ticket(cookie) })
    })
    s.on('auth:ok', () => resolve(s))
    s.on('auth:failed', (d: unknown) => reject(new Error(JSON.stringify(d))))
    setTimeout(() => reject(new Error('connect timeout')), 8000)
  })
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface OverPayload {
  result: string
  termination: string
  color: string
  myDelta: number | null
  myNewRating: number | null
  rated: boolean
}

async function main() {
  const a = await client(COOKIE_A)
  const b = await client(COOKIE_B)
  console.log('both authed')

  const games: Record<string, { id: string; color: string; opponent: { username: string; rating: number; provisional: boolean } }> = {}
  const stateCount = { a: 0, b: 0 }

  a.on('match:found', (d: { game: { id: string; color: string; opponent: { username: string; rating: number } } }) => { games.a = d.game })
  b.on('match:found', (d: { game: { id: string; color: string; opponent: { username: string; rating: number } } }) => { games.b = d.game })
  a.on('game:state', () => { stateCount.a++ })
  b.on('game:state', () => { stateCount.b++ })

  const overA = new Promise<OverPayload>((res) => a.on('game:over', res))
  const overB = new Promise<OverPayload>((res) => b.on('game:over', res))

  a.emit('queue:join', { tc: '5+0' })
  b.emit('queue:join', { tc: '5+0' })
  await wait(2500)

  const ga = games.a
  const gb = games.b
  if (!ga || !gb) {
    console.error('NO MATCH', { ga: Boolean(ga), gb: Boolean(gb) })
    process.exit(1)
  }
  console.log('matched. A is', ga.color, 'opponent seen by A:', ga.opponent.username, ga.opponent.rating, ga.opponent.provisional ? '(prov)' : '')
  if (ga.id !== gb.id) {
    console.error('GAME ID MISMATCH')
    process.exit(1)
  }

  const script = [
    ['e2', 'e4'], ['e7', 'e5'],
    ['g1', 'f3'], ['b8', 'c6'],
    ['f1', 'b5'], ['g8', 'f6'],
  ]
  const whiteSock = ga.color === 'w' ? a : b
  const blackSock = ga.color === 'w' ? b : a
  for (let i = 0; i < script.length; i++) {
    const [from, to] = script[i]
    const sock = i % 2 === 0 ? whiteSock : blackSock
    sock.emit('move:make', { gameId: ga.id, from, to })
    await wait(350)
  }
  await wait(500)
  console.log('state events seen:', stateCount)

  blackSock.emit('resign', { gameId: ga.id })
  const ra = await Promise.race([overA, wait(5000).then(() => null)])
  const rb = await Promise.race([overB, wait(5000).then(() => null)])
  console.log('A result:', JSON.stringify(ra))
  console.log('B result:', JSON.stringify(rb))

  const meA = await (await fetch(`${BASE}/api/auth/me`, { headers: { cookie: COOKIE_A } })).json()
  const meB = await (await fetch(`${BASE}/api/auth/me`, { headers: { cookie: COOKIE_B } })).json()
  console.log('A overall:', JSON.stringify(meA.ratings?.find((r: { pool: string }) => r.pool === 'overall')))
  console.log('B overall:', JSON.stringify(meB.ratings?.find((r: { pool: string }) => r.pool === 'overall')))

  // color-aware expectation: white (result 1-0) should gain, black should lose
  const aWhite = ra.color === 'w'
  const aDelta = ra.myDelta
  const bDelta = rb.myDelta
  const ok = Boolean(
    ra && rb && ra.rated && rb.rated && ra.result === '1-0' &&
    aDelta != null && bDelta != null &&
    aDelta === -bDelta &&
    ((aWhite && aDelta > 0 && bDelta < 0) || (!aWhite && aDelta < 0 && bDelta > 0)),
  )
  console.log(ok ? 'MULTIPLAYER TEST PASS' : 'MULTIPLAYER TEST FAIL')
  a.close()
  b.close()
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error('TEST FAIL:', e.message)
  process.exit(1)
})
