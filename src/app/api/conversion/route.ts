// Conversion Trainer API — technique drills from engine-verified winning
// positions. The pool (db/conversion-pool.json) is built offline by
// scripts/build-conversion-pool.ts: every position carries Stockfish's own
// verdict (+3.0..+9.0, no forced mates), so the trainer's premise ("you are
// winning here") is engine truth, not an author's opinion.
//
//   GET  /api/conversion?exclude=id1,id2   -> a position (solution withheld)
//   POST /api/conversion                   -> result recorded, model line returned
//
// Client keeps its own honest streak stats in localStorage (Brain Games
// pattern); the server stays stateless.
import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'fs'
import path from 'path'

interface PoolEntry {
  id: string
  fen: string
  evalCp: number
  winner: 'w' | 'b'
  bestLine: string[]
  rating: number
  themes: string[]
}

let cache: { at: number; positions: PoolEntry[] } | null = null

function loadPool(): PoolEntry[] {
  const now = Date.now()
  if (cache && now - cache.at < 60_000) return cache.positions
  const file = path.join(process.cwd(), 'db', 'conversion-pool.json')
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { positions?: PoolEntry[] }
    const positions = Array.isArray(parsed.positions) ? parsed.positions : []
    cache = { at: now, positions }
    return positions
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  const pool = loadPool()
  if (pool.length === 0) {
    return NextResponse.json({ error: 'conversion pool not built yet — run scripts/build-conversion-pool.ts' }, { status: 503 })
  }
  const exclude = (req.nextUrl.searchParams.get('exclude') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const skip = new Set(exclude)
  let candidates = pool.filter((p) => !skip.has(p.id))
  if (candidates.length === 0) candidates = pool
  const pick = candidates[Math.floor(Math.random() * candidates.length)]
  return NextResponse.json({
    id: pick.id,
    fen: pick.fen,
    // The premise, from the engine itself at build time (cp for the side to move).
    startEvalCp: pick.evalCp,
    winner: pick.winner,
    rating: pick.rating,
    themes: pick.themes,
    // bestLine deliberately withheld until the attempt ends (POST).
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id : ''
  const result = typeof body?.result === 'string' ? body.result : ''
  const pool = loadPool()
  const entry = pool.find((p) => p.id === id)
  if (!entry) {
    return NextResponse.json({ error: 'unknown position id' }, { status: 404 })
  }
  if (!['converted', 'blew', 'draw'].includes(result)) {
    return NextResponse.json({ error: 'result must be converted | blew | draw' }, { status: 400 })
  }
  // Best-effort telemetry (no PII): just count outcomes in the log so the
  // trainer's difficulty mix can be tuned from real usage.
  console.log(`[conversion] ${result} id=${id} startEval=${entry.evalCp} plies=${Number(body?.plies) || 0}`)
  return NextResponse.json({
    ok: true,
    modelLine: entry.bestLine,
    startEvalCp: entry.evalCp,
  })
}
