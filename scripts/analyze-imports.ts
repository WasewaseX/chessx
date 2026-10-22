// Drive the exact review pipeline the GUI uses, for imported games that are
// still unanalyzed: chunk the PGN into 24-ply batches, eval each batch through
// /api/analysis/evals (native Stockfish), then persist via /api/games/report.
// Usage: bun run scripts/analyze-imports.ts <limit>
import { Chess } from 'chess.js'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const LIMIT = Number(process.argv[2] ?? '5')
const DEPTH = 14

interface GameRow {
  id: string
  color: string
  result: string
  reason: string | null
  pgn: string
  analyzedAt: string | null
}

async function main(): Promise<void> {
  // 1. admin session
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({ identity: 'admin', password: 'admin1234' }),
  })
  const { token } = (await login.json()) as { token?: string }
  if (!token) throw new Error('admin login failed')
  const auth = { Authorization: `Bearer ${token}`, 'Sec-Fetch-Site': 'same-origin' }

  // 2. unanalyzed games
  const gamesRes = await fetch(`${BASE}/api/games?limit=50`, { headers: auth })
  const gamesJson = (await gamesRes.json()) as { games?: GameRow[] } | GameRow[]
  const games = Array.isArray(gamesJson) ? gamesJson : (gamesJson.games ?? [])
  const todo = games.filter((g) => !g.analyzedAt).slice(0, LIMIT)
  console.log(`games total=${games.length} todo=${todo.length}`)

  for (const g of todo) {
    const chess = new Chess()
    chess.loadPgn(g.pgn, { strict: false })
    const history = chess.history()
    if (history.length === 0) {
      console.log(`skip ${g.id}: empty PGN`)
      continue
    }

    // 3. chunked eval
    const replay = new Chess()
    type Ply = { san: string; color: 'w' | 'b'; fenBefore: string }
    const plies: Ply[] = []
    for (const san of history) {
      plies.push({ san, color: replay.turn(), fenBefore: replay.fen() })
      replay.move(san)
    }

    const allEvals: unknown[] = []
    let opening: unknown = null
    for (let i = 0; i < plies.length; i += 24) {
      const chunk = plies.slice(i, i + 24)
      const res = await fetch(`${BASE}/api/analysis/evals`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plies: chunk,
          depth: DEPTH,
          sansBefore: plies.slice(0, i).map((p) => p.san),
        }),
      })
      if (!res.ok) {
        console.log(`chunk failed for ${g.id} at ${i}: HTTP ${res.status}`)
        break
      }
      const data = (await res.json()) as { evals?: unknown[]; opening?: unknown }
      allEvals.push(...(data.evals ?? []))
      if (data.opening) opening = data.opening
    }
    if (allEvals.length === 0) {
      console.log(`skip ${g.id}: no evals`)
      continue
    }

    // 4. persist the report
    const rep = await fetch(`${BASE}/api/games/report`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: g.id, plies: allEvals, opening }),
    })
    const out = (await rep.json()) as Record<string, unknown>
    console.log(`game ${g.id.slice(0, 10)} plies=${allEvals.length} report HTTP ${rep.status}`, rep.ok ? 'ok' : JSON.stringify(out).slice(0, 200))
  }

  // 5. DNA after analysis
  const dna = await fetch(`${BASE}/api/dna`, { headers: auth })
  const d = (await dna.json()) as { ready?: boolean; games?: number; domains?: { key: string; score: number | null }[] }
  console.log('DNA:', d.ready, 'games=', d.games)
  for (const dom of d.domains ?? []) console.log(`  ${dom.key}: ${dom.score ?? '—'}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
