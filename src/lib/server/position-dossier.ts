// The ground-truth dossier: every fact the coach may state about the current
// position, computed by chess.js and the engine BEFORE the model speaks. The
// model never has to guess what is on the board, what a move attacks, or what
// the evaluation is: the dossier states it, and the claim guard (claim-guard.ts)
// rejects replies that contradict it. This is the structural fix for the
// hallucination loop: not better prompting, fewer ways to be wrong.
import 'server-only'
import { Chess } from 'chess.js'
import { describeFen } from './chess-describe'
import { analyze, analyzeTop, type EngineLine } from './engine'
import { classifyMove, LABEL_META, type ClassifyInput, type MoveLabel } from '@/lib/chess/move-classification'

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
 * Structured ground truth the chat routes need beyond the rendered dossier:
 * the engine's verified top move (SAN) and its alternatives, so the claim
 * guard can enforce "the first best move you name IS the engine's move".
 */
export interface DossierEngineInfo {
  topSan: string | null
  altSans: string[]
  /** full SAN principal variation of the top line (max 6 plies) */
  topPvSan: string[]
}

export interface Dossier {
  text: string
  engine: DossierEngineInfo
  /** MultiPV lines used to build the verdict (also fed to the classifier). */
  topLines: EngineLine[] | null
}

/**
 * Build the verified dossier for a position. Returns null when the FEN is
 * unusable (the chat route then falls back to the plain board description).
 */
export async function buildDossierStructured(fen: string): Promise<Dossier | null> {
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
  if (!census) return { text: base, engine: { topSan: null, altSans: [], topPvSan: [] }, topLines: null }

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
  const engine: DossierEngineInfo = { topSan: null, altSans: [], topPvSan: [] }
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
        // Structured verdict: the first SAN of rank 1 is THE best move; the
        // first SANs of the lower ranks are the honest alternatives.
        if (ln.rank === 1 && !engine.topSan) {
          engine.topSan = sanPv[0]?.replace(/[+#]$/, '') ?? null
          engine.topPvSan = sanPv
        } else if (sanPv[0]) {
          engine.altSans.push(sanPv[0].replace(/[+#]$/, ''))
        }
        return `${scoreText(ln.score, turn === 'w')}: ${sanPv.join(' ')}`
      })
      .filter((s) => s.length > 4)
      .join(' | ')
    if (rendered) {
      const bestRule = engine.topSan
        ? ` If the student asks for the best move, the FIRST move you name as best MUST be ${engine.topSan}. Never name a different move as the best move in this position; the lower-ranked lines above may be offered only as clearly-labeled alternatives.`
        : ''
      lines.push(
        `ENGINE VERDICT (Stockfish, verified numbers — quote exactly, never flip): best lines for ${sideName(turn)}: ${rendered}.${bestRule}`,
      )
    }
  } else {
    lines.push('ENGINE VERDICT: unavailable this turn. Do not state evaluations; describe the position only.')
  }

  lines.push(
    'RULES OF ENGAGEMENT: every move you name MUST be legal in the position at the point you name it (use the verified lists and engine lines above). Every piece you mention MUST be in the piece list. Never invent checks, captures, forks or attacks that are not derivable from the lists. When the student asks for checks, captures and threats, walk the verified lists.',
  )
  return { text: lines.join('\n\n'), engine, topLines: top }
}

/** Back-compatible string form used by callers that only render the dossier. */
export async function buildDossier(fen: string): Promise<string | null> {
  const d = await buildDossierStructured(fen)
  return d?.text ?? null
}

// ---------------------------------------------------------------------------
// Last-move classification: the coach speaks the SAME 12-label language the
// app's review pipeline uses (move-classification.ts is the unique truth
// source). Before the model replies, the student's most recent move is run
// through the real classifier with real engine evals, so the verdict in the
// chat context can never drift from the badge the app would draw.
// ---------------------------------------------------------------------------

export interface LastMoveVerdict {
  san: string
  color: 'White' | 'Black'
  label: MoveLabel
  labelMetaText: string
  meaning: string
  bestSan: string | null
  isBest: boolean
}

const MATE_PAWN_CAP = 80

/** centipawns (side-to-move POV, mate mapped huge) -> white-POV pawns, mate flattened to ±80. */
function toWhitePovPawns(cp: number, moverIsWhite: boolean): number {
  const white = moverIsWhite ? cp : -cp
  const pawns = white / 100
  if (pawns >= MATE_PAWN_CAP - 0.5) return MATE_PAWN_CAP
  if (pawns <= -MATE_PAWN_CAP + 0.5) return -MATE_PAWN_CAP
  return pawns
}

function mateFieldsFor(pawns: number): { forWhite: boolean | null; plies: number | null } {
  if (pawns >= MATE_PAWN_CAP) return { forWhite: true, plies: null }
  if (pawns <= -MATE_PAWN_CAP) return { forWhite: false, plies: null }
  return { forWhite: null, plies: null }
}

/**
 * Classify the LAST move of `movesSan` against engine truth. `fenNow` (when
 * provided) must match the replayed final position, otherwise the client
 * state is stale and the function honestly returns null. `topNow` is the
 * already-computed MultiPV analysis of fenNow (reused — no second search).
 */
export async function classifyLastPlayedMove(
  fenNow: string | undefined,
  movesSan: string[],
  topNow: EngineLine[] | null,
): Promise<LastMoveVerdict | null> {
  if (!movesSan.length) return null
  let g: Chess
  try {
    g = new Chess()
  } catch {
    return null
  }
  const fenBefores: string[] = []
  for (const san of movesSan) {
    fenBefores.push(g.fen())
    try {
      if (!g.move(san)) return null
    } catch {
      return null
    }
  }
  // Sanity: the client's board must be the replayed position. A stale or
  // forged move list would classify the wrong move — skip rather than lie.
  if (fenNow) {
    const a = fenNow.split(' ').slice(0, 2).join(' ')
    const b = g.fen().split(' ').slice(0, 2).join(' ')
    if (a !== b) return null
  }
  const last = movesSan[movesSan.length - 1]
  const fenBefore = fenBefores[fenBefores.length - 1]
  const moverIsWhite = g.turn() === 'b' // side that just moved is the opposite of the current turn
  const before = await analyze(fenBefore, 2).catch(() => null)
  if (!before) return null
  const beforeLines = before.lines ?? null
  const bestBeforeUci = before.best
  let bestBeforeSan: string | null = null
  try {
    const probe = new Chess(fenBefore)
    bestBeforeSan = probe.move({ from: bestBeforeUci.slice(0, 2), to: bestBeforeUci.slice(2, 4), promotion: bestBeforeUci.slice(4, 5) || undefined })?.san.replace(/[+#]$/, '') ?? null
  } catch {
    bestBeforeSan = null
  }
  const afterCp = topNow?.[0]?.score
  if (afterCp == null) return null
  const beforeCp = before.bestScore
  // `before` is from the MOVER's POV (side to move in fenBefore); `after` is
  // from the OPPONENT's POV (the side to move in fenNow). Both must convert
  // to white-POV pawns with the correct reference side, or a blunder reads
  // as a brilliant move (caught live Nov 2: Qxf7 classified "excellent").
  const beforePawns = toWhitePovPawns(beforeCp, moverIsWhite)
  const afterPawns = toWhitePovPawns(afterCp, !moverIsWhite)
  const legalMoveCount = new Chess(fenBefore).moves().length
  const isBest = bestBeforeSan != null && last.replace(/[+#]$/, '') === bestBeforeSan
  // sacrifice math
  const moveObj = (() => {
    try {
      return new Chess(fenBefore).move(last)
    } catch {
      return null
    }
  })()
  if (!moveObj) return null
  // after the move, can the opponent capture the piece that just landed?
  const offerCanBeTaken = new Chess(g.fen()).attackers(moveObj.to as never, moverIsWhite ? 'b' : 'w').length > 0
  const bestReplyTakesOffer = (() => {
    const topUci = topNow?.[0]?.pv?.[0]
    if (!topUci) return false
    return topUci.slice(0, 2) === moveObj.to
  })()
  const mb = mateFieldsFor(beforePawns)
  const ma = mateFieldsFor(afterPawns)
  const input: ClassifyInput = {
    fenBefore,
    san: last,
    color: moverIsWhite ? 'w' : 'b',
    before: beforePawns,
    after: afterPawns,
    mateBeforeForWhite: mb.forWhite,
    mateBeforePlies: mb.plies,
    mateAfterForWhite: ma.forWhite,
    mateAfterPlies: ma.plies,
    bestSan: bestBeforeSan,
    secondBestSan: beforeLines?.[1] ? sanFromUci(fenBefore, beforeLines[1].best) : null,
    secondBestBefore: beforeLines?.[1] ? toWhitePovPawns(beforeLines[1].score, moverIsWhite) : null,
    legalMoveCount,
    isBest,
    movedPiece: moveObj.piece,
    capturedPiece: moveObj.captured ?? null,
    offerCanBeTaken,
    bestReplyTakesOffer,
    bookHit: false,
    ply: movesSan.length,
  }
  const label = classifyMove(input)
  const meta = LABEL_META[label]
  return {
    san: last,
    color: moverIsWhite ? 'White' : 'Black',
    label,
    labelMetaText: meta.text,
    meaning: meta.meaning,
    bestSan: bestBeforeSan,
    isBest,
  }
}

function sanFromUci(fen: string, uci: string): string | null {
  try {
    const g = new Chess(fen)
    return g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined })?.san.replace(/[+#]$/, '') ?? null
  } catch {
    return null
  }
}
