// End-to-end check of the server game-review pipeline using the user's
// chess.com game (raheltherich vs Checkacabra-BOT, 0-1).
// Mirrors what the client does: chunked POSTs to /api/analysis/evals.
import { Chess } from 'chess.js'

const PGN = `[Event "Play vs Bot"]
[Site "Chess.com"]
[White "raheltherich"]
[Black "Checkacabra-BOT"]
[Result "0-1"]
[ECO "B00"]
[Termination "Checkacabra-BOT won by checkmate"]

1. d4 d5 2. e4 Nc6 3. Nc3 e6 4. Bb5 Qd7 5. Qd3 a6 6. Bxc6 Qxc6 7. Bg5 h6 8. Bf4
Rb8 9. Nf3 dxe4 10. Qxe4 Qxe4+ 11. Nxe4 g5 12. Bxc7 Ra8 13. O-O f5 14. Nd6+ Kd7
15. Ne5+ Kxc7 16. Ndf7 Rh7 17. Rfc1 Bg7 18. c4 Bxe5 19. Nxe5 Re7 20. c5 Rb8 21.
c6 Rh7 22. cxb7+ Kxb7 23. Rc6 Bd7 24. Rd6 Be8 25. Rxe6 Re7 26. Rd6 Kc7 27. Rxa6
Bb5 28. Rc1+ Kd8 29. Rd6+ Bd7 30. a4 Ke8 31. a5 Bc8 32. a6 Ra8 33. b4 Kf8 34. b5
Kg7 35. Ra1 Kf8 36. a7 Raxa7 37. Rxa7 Rxa7 38. b6 Ra1# 0-1`

interface PlyEval {
  san: string
  color: 'w' | 'b'
  before: number
  after: number
  bestUci: string | null
  bestSan: string | null
  label: string
  reason?: string
}

async function main() {
  const parser = new Chess()
  parser.loadPgn(PGN)
  const history = parser.history({ verbose: true })
  const plies: { san: string; color: 'w' | 'b'; fenBefore: string }[] = []
  const replay = new Chess()
  for (const h of history) {
    plies.push({ san: h.san, color: h.color, fenBefore: replay.fen() })
    replay.move(h.san)
  }
  console.log(`parsed ${plies.length} plies`)

  const all: PlyEval[] = []
  const depth = 15
  const CHUNK = 12
  const t0 = Date.now()
  for (let from = 0; from < plies.length; from += CHUNK) {
    const slice = plies.slice(from, from + CHUNK)
    const res = await fetch('http://localhost:3000/api/analysis/evals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plies: slice, depth }),
    })
    if (!res.ok) {
      console.error(`chunk at ${from} failed: ${res.status} ${await res.text()}`)
      process.exit(1)
    }
    const data = (await res.json()) as { evals: PlyEval[]; engine: string }
    all.push(...data.evals)
    console.log(`  chunk ${from}-${from + slice.length}: ${data.evals.length} evals (engine: ${data.engine})`)
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`done in ${secs}s, ${all.length} evals\n`)

  // accuracy (same math as the app)
  const acc = (color: 'w' | 'b') => {
    const losses = all.filter((e) => e.color === color).map((e) => Math.max(0, (color === 'w' ? e.before : -e.before) - (color === 'w' ? e.after : -e.after)))
    if (!losses.length) return null
    const avg = losses.reduce((a, b) => a + b, 0) / losses.length
    return Math.max(0, Math.min(100, Math.round((103.1668 * Math.exp(-0.04354 * avg) - 3.1669) * 10) / 10))
  }
  console.log(`White accuracy: ${acc('w')}%  Black accuracy: ${acc('b')}%`)

  const counts: Record<string, { w: number; b: number }> = {}
  for (const e of all) {
    counts[e.label] = counts[e.label] ?? { w: 0, b: 0 }
    counts[e.label][e.color]++
  }
  console.log('label counts:', JSON.stringify(counts))

  // key moments: biggest drops
  const moments = all
    .map((e, i) => ({ i, e, drop: Math.max(0, (e.color === 'w' ? e.before : -e.before) - (e.color === 'w' ? e.after : -e.after)) }))
    .filter((m) => m.e.label !== 'best' && m.e.label !== 'excellent' && m.e.label !== 'good')
    .sort((a, b) => b.drop - a.drop)
    .slice(0, 6)
  console.log('\nkey moments:')
  for (const m of moments) {
    const mv = Math.floor(m.i / 2) + 1
    console.log(`  ${mv}. ${m.e.san} (${m.e.color === 'w' ? 'White' : 'Black'}) [${m.e.label}] ${m.e.before.toFixed(1)} -> ${m.e.after.toFixed(1)}`)
    console.log(`     best: ${m.e.bestSan ?? '-'} | ${m.e.reason ?? '(no reason)'}`)
  }

  // the final move must read as mate / the losing side must not be called best
  const last = all.at(-1)
  console.log(`\nlast ply: ${last?.san} label=${last?.label} (${last?.before} -> ${last?.after})`)
}

main()
