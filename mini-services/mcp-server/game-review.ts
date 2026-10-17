// Per-ply game review for the MCP server: the same crude classification the
// spec defines (best / good / inaccuracy / mistake / blunder from eval drops),
// shared by analyze_game and review_online_game. Depth-N Stockfish eval before
// and after every played move; all engine work is serialized by the engine
// singleton's mutex.
import { Chess } from 'chess.js'
import { engine, mateScoreToCp } from './engine'

export class ToolError extends Error {}

export const MAX_GAME_PLIES = 200
/** Reported/averaged losses are capped so mate-score swings stay readable. */
export const LOSS_CAP_CP = 1500

export interface PlyDetail {
  ply: number
  san: string
  classification: 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'
  lossCp: number
  bestSan: string | null
}

interface SideErrors {
  blunders: number
  mistakes: number
  inaccuracies: number
}

export interface GameReviewResult {
  plies: number
  depth: number
  summary: { white: SideErrors; black: SideErrors }
  worstMove: { san: string; ply: number; lossCp: number } | null
  averageLossCp: { white: number; black: number }
  pliesDetail: PlyDetail[]
  elapsedMs: number
  note?: string
}

export function parsePgnOrThrow(pgn: string): Chess {
  const g = new Chess()
  try {
    g.loadPgn(pgn.trim())
  } catch {
    throw new ToolError('That PGN could not be parsed by chess.js')
  }
  return g
}

export async function reviewGame(pgn: string, depth: number, deadline: number): Promise<GameReviewResult> {
  const t0 = Date.now()
  const sans = parsePgnOrThrow(pgn).history()
  if (sans.length === 0) throw new ToolError('The PGN contains no moves')
  if (sans.length > MAX_GAME_PLIES) {
    throw new ToolError(
      `This game has ${sans.length} plies; the review tool handles games of up to ${MAX_GAME_PLIES} plies`,
    )
  }
  const evalTimeoutMs = Math.max(8_000, Math.round(depth * 1_500))
  const board = new Chess()
  const summary: { white: SideErrors; black: SideErrors } = {
    white: { blunders: 0, mistakes: 0, inaccuracies: 0 },
    black: { blunders: 0, mistakes: 0, inaccuracies: 0 },
  }
  const lossSums = { white: 0, black: 0 }
  const lossCounts = { white: 0, black: 0 }
  let worst: GameReviewResult['worstMove'] = null
  const detail: PlyDetail[] = []
  let note: string | undefined

  for (let i = 0; i < sans.length; i++) {
    if (Date.now() > deadline) {
      note = `Analysis stopped after ${i} of ${sans.length} plies: the per-request time budget ran out.`
      break
    }
    const color: 'white' | 'black' = i % 2 === 0 ? 'white' : 'black'
    const fenBefore = board.fen()
    let mv
    try {
      mv = board.move(sans[i])
    } catch {
      throw new ToolError(`The PGN is illegal at ply ${i + 1}: ${sans[i]}`)
    }
    const fenAfter = board.fen()
    const uciPlayed = mv.from + mv.to + (mv.promotion ?? '')

    // Eval before (mover to move) + after (opponent to move). Terminal
    // positions after the move get a synthetic eval instead of an engine
    // call: a mating move is a full win for the mover, a draw is 0. The
    // engine mutex serializes the two searches; Promise.all keeps it simple.
    const syntheticAfter = { depth: 0, bestMoveUci: '', bestMoveSan: '', scoreCp: null as number | null, mate: null as number | null, pvSan: [] as string[], elapsedMs: 0, stoppedEarly: false }
    const [before, after] = await Promise.all([
      engine.analyze(fenBefore, depth, evalTimeoutMs),
      board.isCheckmate()
        ? Promise.resolve({ ...syntheticAfter, mate: -1 }) // opponent POV: gets mated now
        : board.isDraw()
          ? Promise.resolve({ ...syntheticAfter, scoreCp: 0 }) // drawn position: 0 both ways
          : engine.analyze(fenAfter, depth, evalTimeoutMs),
    ])

    const cpBefore = before.mate !== null ? mateScoreToCp(before.mate) : (before.scoreCp ?? 0)
    const cpAfterOpp = after.mate !== null ? mateScoreToCp(after.mate) : (after.scoreCp ?? 0)
    const lossRaw = Math.max(0, cpBefore + cpAfterOpp) // mover-POV drop
    const loss = Math.min(LOSS_CAP_CP, Math.round(lossRaw))

    const matched = before.bestMoveUci !== '' && before.bestMoveUci === uciPlayed
    const classification: PlyDetail['classification'] = matched
      ? 'best'
      : lossRaw > 300
        ? 'blunder'
        : lossRaw > 150
          ? 'mistake'
          : lossRaw > 70
            ? 'inaccuracy'
            : 'good'

    detail.push({ ply: i + 1, san: mv.san, classification, lossCp: loss, bestSan: before.bestMoveSan || null })
    if (classification === 'blunder') summary[color].blunders++
    else if (classification === 'mistake') summary[color].mistakes++
    else if (classification === 'inaccuracy') summary[color].inaccuracies++
    lossSums[color] += loss
    lossCounts[color]++
    if (!worst || loss > worst.lossCp) worst = { san: mv.san, ply: i + 1, lossCp: loss }
  }

  return {
    plies: sans.length,
    depth,
    summary,
    worstMove: worst,
    averageLossCp: {
      white: lossCounts.white ? Math.round(lossSums.white / lossCounts.white) : 0,
      black: lossCounts.black ? Math.round(lossSums.black / lossCounts.black) : 0,
    },
    pliesDetail: detail,
    elapsedMs: Date.now() - t0,
    ...(note ? { note } : {}),
  }
}

// ---------------------------------------------------------------------------
// Online game import (lichess / chess.com) -> review each game
// ---------------------------------------------------------------------------

export interface OnlineReviewEntry {
  white: string
  black: string
  date: string
  site: string
  review: GameReviewResult
}

export interface OnlineReviewResult {
  source: 'lichess' | 'chesscom'
  username: string
  count: number
  games: OnlineReviewEntry[]
  errors: string[]
  note?: string
}

function pgnHeader(pgn: string, tag: string): string {
  const m = pgn.match(new RegExp(`^\\[${tag}\\s+"([^"]*)"\\]`, 'm'))
  return m ? m[1] : ''
}

function splitMultiPgn(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n(?=\[Event\s)/)
    .map((s) => s.trim())
    .filter(Boolean)
}

async function fetchLichessGames(username: string, max: number): Promise<string[]> {
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=${max}`
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/x-chess-pgn' },
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    throw new ToolError('lichess game export is not reachable from this host (network egress blocked or timed out)')
  }
  if (!res.ok) throw new ToolError(`lichess answered HTTP ${res.status} for user "${username}"`)
  const games = splitMultiPgn(await res.text())
  if (games.length === 0) throw new ToolError(`lichess returned no games for "${username}"`)
  return games
}

async function fetchChessComGames(username: string, max: number): Promise<string[]> {
  const u = encodeURIComponent(username)
  const pad = (n: number) => String(n).padStart(2, '0')
  const now = new Date()
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const months = [
    `${now.getUTCFullYear()}/${pad(now.getUTCMonth() + 1)}`,
    `${prev.getUTCFullYear()}/${pad(prev.getUTCMonth() + 1)}`,
  ]
  const settled = await Promise.allSettled(
    months.map(async (ym) => {
      const res = await fetch(`https://api.chess.com/pub/player/${u}/games/${ym}`, {
        headers: { 'User-Agent': 'ChessX-MCP/1.0 (chess learning app)' },
        signal: AbortSignal.timeout(12_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${ym}`)
      const data = (await res.json()) as { games?: { pgn?: string; end_time?: number }[] }
      return (data.games ?? []).filter((g) => typeof g.pgn === 'string' && g.pgn)
    }),
  )
  const anyRejected = settled.some((s) => s.status === 'rejected')
  const games: { pgn: string; end_time: number }[] = []
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      for (const g of s.value) games.push({ pgn: g.pgn as string, end_time: g.end_time ?? 0 })
    }
  }
  if (games.length === 0) {
    if (anyRejected) {
      throw new ToolError('chess.com monthly archives are not reachable from this host (network egress blocked or timed out)')
    }
    throw new ToolError(
      `chess.com has no games for "${username}" in the two most recent monthly archives (${months.join(', ')})`,
    )
  }
  games.sort((a, b) => b.end_time - a.end_time)
  return games.slice(0, max).map((g) => g.pgn)
}

export async function reviewOnlineGames(
  source: 'lichess' | 'chesscom',
  username: string,
  max: number,
  depth: number,
  deadline: number,
): Promise<OnlineReviewResult> {
  const pgns = source === 'lichess' ? await fetchLichessGames(username, max) : await fetchChessComGames(username, max)
  const games: OnlineReviewEntry[] = []
  const errors: string[] = []
  for (const pgn of pgns) {
    const label = `${pgnHeader(pgn, 'White') || '?'} vs ${pgnHeader(pgn, 'Black') || '?'} (${
      pgnHeader(pgn, 'Date') || pgnHeader(pgn, 'UTCDate') || 'no date'
    })`
    if (Date.now() > deadline) {
      errors.push(`Skipped ${label}: the per-request time budget ran out.`)
      continue
    }
    try {
      const review = await reviewGame(pgn, depth, deadline)
      games.push({
        white: pgnHeader(pgn, 'White'),
        black: pgnHeader(pgn, 'Black'),
        date: pgnHeader(pgn, 'Date') || pgnHeader(pgn, 'UTCDate'),
        site: pgnHeader(pgn, 'Site'),
        review,
      })
    } catch (e) {
      errors.push(`Could not review ${label}: ${e instanceof ToolError ? e.message : 'internal error'}`)
    }
  }
  if (games.length === 0 && errors.length > 0) {
    throw new ToolError(`None of the fetched games could be reviewed. First problem: ${errors[0]}`)
  }
  return { source, username, count: games.length, games, errors }
}
