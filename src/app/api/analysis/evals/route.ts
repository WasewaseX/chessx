// Deep game review, server side: the app's engine core (native Stockfish 19
// when available) evaluates every position, classifies each move through the
// frozen chess.com-accurate classifier and produces factual reasons.
//
// The client sends a chunk of plies (fen + san + color) plus the SANs played
// before the chunk, so opening-theory detection spans the whole game across
// chunked reviews. Overlapping positions across chunks are answered from the
// engine result cache, so a chunked review never searches the same position
// twice. When the engine is unavailable the route answers with an empty eval
// list and `engineAvailable: false` instead of faking numbers — the GUI falls
// back to its own wasm path.
import { NextRequest, NextResponse } from 'next/server'
import { Chess } from 'chess.js'
import { engineAvailable, engineIdentity } from '@/lib/server/engine'
import { evalPlies, computeTheory, type PlyIn } from '@/lib/server/game-report'
import type { ReviewAreas } from '@/lib/chess/review-types'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

const EMPTY_AREAS: ReviewAreas = { blunders: [], tactics: [], clock: null, conversion: [], openings: { openingName: '', theoryPlies: 0, firstDeviationSan: null } }

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const rawPlies: unknown[] = Array.isArray(body?.plies) ? body.plies : []
  const plies: PlyIn[] = []
  for (const raw of rawPlies.slice(0, 24)) {
    if (typeof raw !== 'object' || raw === null) continue
    const p = raw as Record<string, unknown>
    const fen = typeof p.fenBefore === 'string' ? p.fenBefore.trim() : ''
    const san = typeof p.san === 'string' ? p.san.trim() : ''
    const color = p.color === 'w' || p.color === 'b' ? p.color : null
    if (!fen || !san || !color) continue
    try {
      // replay sanity: the SAN must be legal in the given FEN
      const g = new Chess(fen)
      if (!g.move(san)) continue
    } catch {
      continue
    }
    plies.push({ san, color, fenBefore: fen })
  }
  if (plies.length === 0) {
    return NextResponse.json({ error: 'no valid plies (fenBefore + san + color required)' }, { status: 400 })
  }

  const depth = clamp(Math.round(Number(body?.depth ?? 14) || 14), 8, 26)

  // context: the SANs played before this chunk, so book hits and theoryPlies
  // are measured against the whole game, not just the chunk
  const sansBefore: string[] = (Array.isArray(body?.sansBefore) ? body.sansBefore : [])
    .filter((s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 16)
    .slice(0, 1024)

  if (!(await engineAvailable())) {
    // honest degradation: theory detection needs no engine, evals wait for one
    const opening = computeTheory([...sansBefore, ...plies.map((p) => p.san)])
    return NextResponse.json({
      evals: [],
      depth,
      engine: null,
      engineAvailable: false,
      opening,
      areas: { ...EMPTY_AREAS, openings: opening },
      bestMove: null,
      worstMove: null,
    })
  }

  const result = await evalPlies(plies, depth, { priorSans: sansBefore })
  return NextResponse.json({
    evals: result.plies,
    depth,
    engine: await engineIdentity(),
    engineAvailable: result.engineAvailable,
    opening: result.opening,
    areas: result.areas,
    bestMove: result.bestMove,
    worstMove: result.worstMove,
  })
}
