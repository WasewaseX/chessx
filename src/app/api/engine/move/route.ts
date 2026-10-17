// Bot moves run on the app's engine core (native Stockfish 19 when present),
// with real UCI Skill Level for strength shaping and an optional aggression
// style that prefers forcing moves among near-best candidates. The client
// keeps a wasm fallback for when the server engine is down.
import { NextRequest, NextResponse } from 'next/server'
import { Chess } from 'chess.js'
import { analyze, analyzeTop, engineIdentity, type EngineLine } from '@/lib/server/engine'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const fen = typeof body?.fen === 'string' ? body.fen.trim() : ''
  if (!fen) return NextResponse.json({ error: 'fen required' }, { status: 400 })

  let game: Chess
  try {
    game = new Chess(fen)
  } catch {
    return NextResponse.json({ error: 'invalid fen' }, { status: 400 })
  }
  if (game.isGameOver()) return NextResponse.json({ error: 'game over' }, { status: 400 })

  const legal = game.moves({ verbose: true })
  if (legal.length === 0) return NextResponse.json({ error: 'no legal moves' }, { status: 400 })

  const skill = clamp(Number(body?.skill ?? 20) || 0, 0, 20)
  const depth = clamp(Math.round(Number(body?.depth ?? 12) || 12), 1, 20)
  const minTime = clamp(Math.round(Number(body?.minTime ?? 300) || 300), 0, 2000)
  const blunder = clamp(Number(body?.blunder ?? 0) || 0, 0, 1)
  const aggression = clamp(Number(body?.aggression ?? 0) || 0, 0, 1)

  // Weak-bot spice: occasionally play a random legal move instead of a search.
  if (Math.random() < blunder) {
    const m = legal[Math.floor(Math.random() * legal.length)]
    await pace(minTime)
    return NextResponse.json({ uci: m.from + m.to + (m.promotion ?? ''), san: m.san, engine: await engineIdentity(), random: true })
  }

  const opts = { skill, movetimeMs: Math.max(120, minTime), timeoutMs: 12_000 }
  let uci: string | null = null
  let san: string | null = null

  // Aggressive personalities choose among near-best moves, weighting forcing
  // play (checks, captures) — never more than ~0.6 pawns worse than the best.
  const useStyle = aggression > 0.05 && skill >= 4 && depth >= 5
  if (useStyle) {
    const lines = await analyzeTop(fen, 4, depth, opts)
    const picked = pickForcing(fen, lines, aggression)
    if (picked) uci = picked
  }
  if (!uci) {
    const a = await analyze(fen, 1, depth, opts)
    if (a?.best && a.best !== '(none)') {
      uci = a.best
    }
  }

  // SAN conversion happens in one place, from the legal move list.
  if (uci && uci !== '(none)') {
    try {
      san = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined })?.san ?? null
      if (san) game.undo() // keep `game` untouched; the client replays the move itself
      else uci = null
    } catch {
      /* best was illegal (should not happen) */
      uci = null
    }
  }

  if (!uci || !san) {
    return NextResponse.json({ error: 'engine unavailable' }, { status: 503 })
  }

  await pace(minTime)
  return NextResponse.json({ uci, san, engine: await engineIdentity() })
}

/** Choose among near-best lines with a forcing bias. Returns a UCI move. */
function pickForcing(fen: string, lines: EngineLine[] | null, aggression: number): string | null {
  if (!lines || lines.length === 0) return null
  const best = lines[0]
  const margin = 60 // centipawns of licence for the personality
  const candidates = lines.filter((l) => best.score - l.score <= margin)
  if (candidates.length <= 1) return best.best

  let top: { uci: string; value: number } | null = null
  for (const l of candidates) {
    let forced = 0
    try {
      const g = new Chess(fen)
      const mv = g.move({ from: l.best.slice(0, 2), to: l.best.slice(2, 4), promotion: l.best.slice(4, 5) || undefined })
      if (!mv) continue
      if (g.isCheck()) forced += 18
      if (mv.captured) forced += 12
      if (mv.promotion) forced += 10
      if (!mv.captured && !g.isCheck()) forced -= 8
    } catch {
      continue
    }
    const value = l.score + aggression * forced * 10
    if (!top || value > top.value) top = { uci: l.best, value }
  }
  return top?.uci ?? best.best
}

async function pace(ms: number) {
  if (ms > 0) await new Promise((r) => setTimeout(r, ms))
}
