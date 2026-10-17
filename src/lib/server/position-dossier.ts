// The ground-truth dossier: every fact the coach may state about the current
// position, computed by chess.js and the engine BEFORE the model speaks. The
// model never has to guess what is on the board, what a move attacks, or what
// the evaluation is: the dossier states it, and the claim guard (claim-guard.ts)
// rejects replies that contradict it. This is the structural fix for the
// hallucination loop: not better prompting, fewer ways to be wrong.
import 'server-only'
import { Chess } from 'chess.js'
import { describeFen } from './chess-describe'
import { analyzeTop } from './engine'

const ENGINE_TIMEOUT_MS = 9_000

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

interface MoveInfo {
  san: string
  givesCheck: boolean
  captures?: { piece: string; square: string; defended: boolean }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((r) => setTimeout(() => r(null), ms)),
  ])
}

function uciToSan(fen: string, uci: string): string | null {
  try {
    const g = new Chess(fen)
    return g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined })?.san ?? null
  } catch {
    return null
  }
}

function scoreText(cp: number, povWhite: boolean): string {
  // cp comes from the side to move's POV; convert to White's POV for a
  // single canonical reading the model can quote without flipping signs.
  const w = povWhite ? cp : -cp
  if (w > 90000) return `mate in ${Math.max(1, Math.ceil((100000 - w) / 100))} for White`
  if (w < -90000) return `mate in ${Math.max(1, Math.ceil((100000 + w) / 100))} for Black`
  const p = w / 100
  return `${p > 0 ? '+' : ''}${p.toFixed(1)} (White's perspective)`
}

/** Captures and checks the OTHER side would have if it were their move. */
function opponentThreats(fen: string): { side: 'White' | 'Black'; captures: string[]; checks: string[]; hangs: string[] } {
  const g = new Chess(fen)
  const mover = g.turn()
  const them = mover === 'w' ? 'b' : 'w'
  // Flip the side to move by rebuilding the FEN with the other turn field.
  const parts = fen.split(' ')
  parts[1] = them
  let flipped: Chess
  try {
    flipped = new Chess(parts.join(' '))
  } catch {
    return { side: sideName(them), captures: [], checks: [], hangs: [] }
  }
  const captures: string[] = []
  const checks: string[] = []
  for (const mv of flipped.moves({ verbose: true })) {
    if (mv.captured) {
      const victimName = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' }[mv.captured] ?? 'piece'
      captures.push(`${mv.san} (takes the ${sideName(mv.color)} ${victimName} on ${mv.to})`)
    }
    const clone = new Chess(flipped.fen())
    try {
      clone.move({ from: mv.from, to: mv.to, promotion: mv.promotion })
      if (clone.isCheck()) checks.push(mv.san)
    } catch {
      /* never happens for moves from .moves() */
    }
  }
  // Hanging pieces: attacked by the opponent and undefended by their own side.
  const hangs: string[] = []
  const NAMES: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }
  for (const row of g.board()) {
    for (const sq of row) {
      if (!sq || sq.type === 'k') continue
      const attackers = g.attackers(sq.square, sq.color === 'w' ? 'b' : 'w')
      if (!attackers.length) continue
      const defenders = g.attackers(sq.square, sq.color)
      if (!defenders.length) {
        hangs.push(`${sideName(sq.color)} ${NAMES[sq.type]} on ${sq.square} is attacked and undefended`)
      }
    }
  }
  return {
    side: sideName(them),
    captures: captures.slice(0, 8),
    checks: [...new Set(checks)].slice(0, 6),
    hangs: [...new Set(hangs)].slice(0, 5),
  }
}

function moveCensus(fen: string): {
  total: number
  checks: string[]
  captures: MoveInfo[]
  quiet: string[]
} | null {
  let g: Chess
  try {
    g = new Chess(fen)
  } catch {
    return null
  }
  const checks: string[] = []
  const captures: MoveInfo[] = []
  const quiet: string[] = []
  const legal = g.moves({ verbose: true })
  for (const mv of legal) {
    const clone = new Chess(fen)
    let san = mv.san
    try {
      clone.move({ from: mv.from, to: mv.to, promotion: mv.promotion })
    } catch {
      continue
    }
    if (clone.isCheck()) {
      checks.push(san.endsWith('+') || san.endsWith('#') ? san : `${san}+`)
      continue
    }
    if (mv.captured) {
      // Is the captured piece defended? After the capture, can the opponent
      // recapture on that square?
      const defenders = clone.attackers(mv.to as never, mv.color === 'w' ? 'b' : 'w')
      captures.push({
        san,
        givesCheck: false,
        captures: {
          piece: mv.captured === 'p' ? 'pawn' : mv.captured === 'n' ? 'knight' : mv.captured === 'b' ? 'bishop' : mv.captured === 'r' ? 'rook' : 'queen',
          square: mv.to,
          defended: defenders.length > 0,
        },
      })
      continue
    }
    quiet.push(san)
  }
  return { total: legal.length, checks, captures, quiet }
}

function sideName(c: 'w' | 'b'): 'White' | 'Black' {
  return c === 'w' ? 'White' : 'Black'
}

/**
 * Build the verified dossier for a position. Returns null when the FEN is
 * unusable (the chat route then falls back to the plain board description).
 */
export async function buildDossier(fen: string): Promise<string | null> {
  let g: Chess
  try {
    g = new Chess(fen)
  } catch {
    return null
  }
  const base = describeFen(fen)
  if (!base) return null
  const turn = g.turn()
  const census = moveCensus(fen)
  if (!census) return base

  const lines: string[] = []
  lines.push(base)

  // ---- Verified move census for the side to move ----
  const caps = census.captures
    .map((c) => {
      const cap = c.captures!
      return `${c.san} (takes the ${sideName(turn === 'w' ? 'b' : 'w')} ${cap.piece} on ${cap.square}${cap.defended ? ', defended: expect a recapture' : ', undefended: wins material outright'})`
    })
    .slice(0, 10)
  const quietSorted = [...census.quiet].sort()
  lines.push(
    [
      `VERIFIED MOVES for ${sideName(turn)} (legal moves: ${census.total}).`,
      `Checks: ${census.checks.length ? census.checks.slice(0, 10).join(', ') : 'none'}.`,
      `Captures: ${caps.length ? caps.join('; ') : 'none'}.`,
      `All quiet moves (no checks or captures): ${quietSorted.slice(0, 40).join(', ')}${quietSorted.length > 40 ? `, and ${quietSorted.length - 40} more` : ''}.`,
    ].join('\n'),
  )

  // ---- Opponent threats ----
  const threats = opponentThreats(fen)
  const threatBits: string[] = []
  if (threats.captures.length) threatBits.push(`captures: ${threats.captures.join(', ')}`)
  if (threats.checks.length) threatBits.push(`checks: ${threats.checks.join(', ')}`)
  if (threats.hangs.length) threatBits.push(`undefended pieces right now: ${threats.hangs.join('; ')}`)
  if (threatBits.length) {
    lines.push(`THREATS (verified): if it were ${threats.side}'s move right now they would have ${threatBits.join('; ')}.`)
  } else {
    lines.push(`THREATS (verified): if it were ${threats.side}'s move they would have no checks and no captures.`)
  }

  // ---- Engine verdict ----
  const top = await withTimeout(analyzeTop(fen, 3), ENGINE_TIMEOUT_MS)
  if (top && top.length) {
    const rendered = top
      .map((ln) => {
        const sanPv: string[] = []
        const walk = new Chess(fen)
        for (const u of ln.pv.slice(0, 6)) {
          const from = u.slice(0, 2)
          const to = u.slice(2, 4)
          const promo = u.slice(4, 5) || undefined
          try {
            const mv = walk.move({ from, to, promotion: promo })
            if (!mv) break
            sanPv.push(mv.san)
          } catch {
            break
          }
        }
        return `${scoreText(ln.score, turn === 'w')}: ${sanPv.join(' ')}`
      })
      .filter((s) => s.length > 4)
      .join(' | ')
    if (rendered) {
      lines.push(
        `ENGINE VERDICT (Stockfish, verified numbers — quote exactly, never flip): best lines for ${sideName(turn)}: ${rendered}.`,
      )
    }
  } else {
    lines.push('ENGINE VERDICT: unavailable this turn. Do not state evaluations; describe the position only.')
  }

  lines.push(
    'RULES OF ENGAGEMENT: every move you name MUST be legal in the position at the point you name it (use the verified lists and engine lines above). Every piece you mention MUST be in the piece list. Never invent checks, captures, forks or attacks that are not derivable from the lists. When the student asks for checks, captures and threats, walk the verified lists.',
  )
  return lines.join('\n\n')
}
