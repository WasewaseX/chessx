// The claim guard: structural honesty for the coach. After the model writes a
// reply, every chess claim in it is replayed against chess.js ground truth:
//
//   1. Move tokens (Nf3, exd5, O-O, e8=Q, e5...) must be legal in the current
//      position or in the continuation built from the moves named before them.
//   2. Piece-location claims ("knight on c3") must match the piece map.
//   3. Side-to-move statements must match the FEN's turn field.
//   4. "checkmate" claims must match the board state.
//
// A reply with violations is regenerated ONCE with the exact violations fed
// back; if it still violates, an honest correction is appended. The student
// never has to be the one who catches the coach.
import 'server-only'
import { Chess } from 'chess.js'

export interface ClaimVerdict {
  ok: boolean
  violations: string[]
}

const NAMES: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }

// SAN move token: castling, piece moves, pawn captures, plain pawn pushes,
// promotions, optional check/mate suffix. Trailing !/? accepted.
const MOVE_RE =
  /\b(O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h](?:2|3|4|5|6|7)(?:=[QRBN])?)[+#]?[!?]{0,2}(?![a-zA-Z0-9])/g

// "knight on c3" / "bishop on f5" style claims, negations excluded later.
const PIECE_AT_RE = /\b(king|queen|rook|bishop|knight|pawn)s?\s+(?:is\s+|are\s+|sits?\s+)?on\s+([a-h][1-8])\b/gi
// "there is no knight on c3" / "no rook on a1" — negated claims are never violations.
const NEG_PIECE_AT_RE = /\b(?:no|not any|isn't no|is not)\s+(king|queen|rook|bishop|knight|pawn)s?\b[^\n.]{0,24}?\b(?:on\s+)?([a-h][1-8])\b/gi

function stripNoise(text: string): string {
  // Remove fenced code blocks (action blocks, PGN dumps) and inline code so
  // coordinates there never trip the verifier.
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ')
}

/** True when the token is a bare pawn-push style square (e5, c3) that could
 * equally be a square mention. Only verified as a move when it can be played
 * by SOME piece, and only flagged when no piece can play it. */
function isBareSquare(tok: string): boolean {
  return /^[a-h][1-8]$/.test(tok.replace(/[!?]+$/, ''))
}

function checkPieceClaims(text: string, g: Chess): string[] {
  const violations: string[] = []
  const negs = [...stripNoise(text).matchAll(NEG_PIECE_AT_RE)].map((m) => m[2].toLowerCase())
  const CODE: Record<string, string> = { king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p' }
  for (const m of stripNoise(text).matchAll(PIECE_AT_RE)) {
    const claimed = m[1].toLowerCase()
    const sq = m[2].toLowerCase()
    if (negs.some((n) => n === sq)) continue // the reply itself denies it
    const at = g.get(sq as never)
    if (!at || at.type !== CODE[claimed]) {
      const actual = at ? `${at.color === 'w' ? 'White' : 'Black'} ${NAMES[at.type]}` : 'empty'
      violations.push(`the reply says there is a ${claimed} on ${sq}, but the board has ${actual === 'empty' ? 'nothing there' : `a ${actual} there`}`)
    }
  }
  return violations
}

/** Remove "knight on c3" phrases before move replay so square mentions inside
 * them are never mistaken for move tokens. */
function stripPiecePhrases(text: string): string {
  return text.replace(PIECE_AT_RE, ' ')
}

const MOVE_INTENT = /\b(plays?|played|playing|moves?|reply|answers?|responds?|goes|push(?:es)?|tries|tried|offers?|follow(?:ed)?\s+by|then|instead)\b[^.?!]{0,18}$/i

function hasMoveIntent(textBefore: string): boolean {
  return MOVE_INTENT.test(textBefore.slice(-40))
}

function checkSideClaims(text: string, g: Chess): string[] {
  const violations: string[] = []
  const turn = g.turn() === 'w' ? 'White' : 'Black'
  for (const m of stripNoise(text).matchAll(/\b(white|black)\s+to\s+move\b/gi)) {
    if (m[1].toLowerCase() !== turn.toLowerCase()) {
      violations.push(`the reply says "${m[0]}" but it is actually ${turn} to move`)
    }
  }
  return violations
}

function checkMateClaims(text: string, g: Chess): string[] {
  const violations: string[] = []
  const noise = stripNoise(text)
  const claimsMate = /\b(?:is\s+(?:a\s+)?checkmate|checkmated|mate\s+in\s+one)\b/i.test(noise) && !/\bmate\s+in\s+(?:[2-9]|\d\d)\b/i.test(noise)
  if (claimsMate && !g.isCheckmate()) {
    // Talking about a hypothetical future mate is fine; claiming the CURRENT
    // position is mate is verifiable.
    const currentClaim = /\b(?:the\s+)?(?:current\s+)?position\s+is\s+(?:a\s+)?checkmate\b/i.test(noise) || /\byou\s+are\s+checkmated\b/i.test(noise)
    if (currentClaim) violations.push('the reply claims the current position is checkmate, but it is not')
  }
  return violations
}

/** Verify existence claims about the position itself: "all pieces are still
 * on their starting squares", "you have no captures", "no checks". These are
 * the hallucinations a move-replay cannot catch: no move is named, the
 * sentence is just factually wrong about the board. */
function checkPositionClaims(text: string, g: Chess): string[] {
  const violations: string[] = []
  const t = stripNoise(text)

  // "All pieces on their starting squares" — verifiable against the start
  // position piece map.
  const claimsAllStart =
    /\b(?:all|every|each)\b[^.!?]{0,40}\b(?:pieces?|pawns?)\b[^.!?]{0,30}\b(?:on|at|in)\s+(?:their|its)\s+(?:starting|original|home|beginning)/i.test(t) ||
    /\b(?:still|back)\s+on\s+their\s+starting\s+squares/i.test(t)
  if (claimsAllStart) {
    const moved = countMovedPieces(g)
    if (moved > 0) {
      violations.push(`the reply says the pieces are still on their starting squares, but ${moved} of them have moved`)
    }
  }

  // "You have no captures / none of your pieces can capture" — verifiable
  // against the legal-move list.
  const claimsNoCaptures =
    /\byou (?:have|got) no captures\b/i.test(t) ||
    /\bnone of (?:your|the) pieces can (?:capture|take)\b/i.test(t) ||
    /\bno captures (?:are )?available\b/i.test(t) ||
    /\bnothing (?:to|can be) captur/i.test(t) ||
    /\bno captures this move\b/i.test(t)
  if (claimsNoCaptures) {
    const caps = legalCaptures(g)
    if (caps.length > 0) {
      violations.push(`the reply says there are no captures, but these captures exist: ${caps.slice(0, 3).join(', ')}`)
    }
  }

  // "You have no checks" — same verification, checks only.
  const claimsNoChecks =
    /\byou (?:have|got) no checks\b/i.test(t) ||
    /\bno checks? (?:are )?available\b/i.test(t) ||
    /\bno checking moves\b/i.test(t)
  if (claimsNoChecks) {
    const chks = legalChecks(g)
    if (chks.length > 0) {
      violations.push(`the reply says there are no checks, but these checks exist: ${chks.slice(0, 3).join(', ')}`)
    }
  }
  return violations
}

function countMovedPieces(g: Chess): number {
  let moved = 0
  const start = new Chess()
  const startMap = new Map<string, string>()
  for (const row of start.board()) {
    for (const sq of row) {
      if (sq) startMap.set(sq.square, `${sq.color}${sq.type}`)
    }
  }
  for (const row of g.board()) {
    for (const sq of row) {
      if (!sq) continue
      const key = `${sq.color}${sq.type}`
      if (startMap.get(sq.square) !== key) moved += 1
    }
  }
  return moved
}

function legalCaptures(g: Chess): string[] {
  const out: string[] = []
  for (const m of g.moves({ verbose: true })) {
    if (m.captured) out.push(m.san)
  }
  return out
}

function legalChecks(g: Chess): string[] {
  const out: string[] = []
  const fen = g.fen()
  for (const m of g.moves({ verbose: true })) {
    const probe = new Chess(fen)
    try {
      probe.move({ from: m.from, to: m.to, promotion: m.promotion })
    } catch {
      continue
    }
    if (probe.isCheck()) out.push(m.san)
  }
  return out
}

/**
 * Verify every chess claim in a reply against the position. `fen` is the
 * position the conversation was in when the reply was written.
 *
 * `historyFens` (optional) lists positions that occurred earlier in the same
 * game. A move token that is illegal from the current position but legal in
 * one of those is a HISTORICAL move being discussed out of order - not a
 * hallucination - so it passes.
 *
 * `phraseFens` (optional) lists additional positions the PHRASE-level claims
 * (piece on a square, side to move, mate) may be validated against. In a
 * finished game the reply narrates the capture that produced the final
 * position ("the queen took the pawn on f7") - true in the pre-move position
 * and no longer true on the final board. Each phrase check passes when it is
 * clean against the current board OR any phrase window position.
 */
export function verifyClaims(text: string, fen: string, historyFens?: string[], phraseFens?: string[]): ClaimVerdict {
  if (!fen) return { ok: true, violations: [] }
  let base: Chess
  try {
    base = new Chess(fen)
  } catch {
    return { ok: true, violations: [] }
  }
  const history: Chess[] = []
  for (const hf of historyFens ?? []) {
    try {
      history.push(new Chess(hf))
    } catch {
      /* a malformed history entry is simply skipped */
    }
  }
  const phraseBases: Chess[] = [base]
  for (const pf of phraseFens ?? []) {
    if (pf === fen) continue
    try {
      phraseBases.push(new Chess(pf))
    } catch {
      /* skip */
    }
  }
  const violations: string[] = []

  // Phrase checks pass when they are clean against the current board or any
  // phrase-window position (a finished game's narration talks about both).
  const phraseCheck = (check: (text: string, g: Chess) => string[]): string[] => {
    const merged: string[] = []
    for (const g of phraseBases) {
      const found = check(text, g)
      if (found.length === 0) return []
      if (merged.length === 0) merged.push(...found)
    }
    return merged
  }
  violations.push(...phraseCheck(checkPieceClaims))
  violations.push(...phraseCheck(checkSideClaims))
  violations.push(...phraseCheck(checkMateClaims))
  violations.push(...phraseCheck(checkPositionClaims))

  // Move replay: walk tokens in order; on failure retry from the base
  // position (the model often restarts lines: "after e5, what if Nxe5?").
  // chess.js leaves the game state untouched on a failed move, so a bad token
  // can never cascade.
  const replayText = stripPiecePhrases(stripNoise(text))
  const cursor = new Chess(fen)
  const fresh = new Chess(fen)
  const historyFresh = history.map((g) => new Chess(g.fen()))
  let lastIdx = 0
  for (const m of replayText.matchAll(MOVE_RE)) {
    const san = m[1].replace(/[!?]+$/, '')
    const bare = isBareSquare(san)
    const attempts: [Chess, boolean][] = [
      [cursor, false],
      [fresh, true],
    ]
    const playedSomewhere = attempts
      .map(([g, isFresh]) => {
        try {
          const mv = g.move(san, { strict: false })
          return mv ? { g, isFresh } : null
        } catch {
          return null
        }
      })
      .find(Boolean)
    if (!playedSomewhere) {
      // Historical moves: legal in any earlier position of this game counts
      // as real (the reply is discussing the past, not inventing the future).
      const historical = historyFresh.some((g) => {
        try {
          return Boolean(g.move(san, { strict: false }))
        } catch {
          return false
        }
      })
      if (!historical) {
        // Bare squares ("the e5 square is weak") are only violations when the
        // reply clearly meant a move ("White plays e5"). Named moves (Nxe5,
        // O-O, exd5) are always strict.
        if (!bare || hasMoveIntent(replayText.slice(lastIdx, m.index))) {
          violations.push(`the move "${san}" is not legal in the current position or in any line named before it`)
        }
      }
    }
    lastIdx = m.index ?? lastIdx
  }
  void cursor
  void fresh
  return { ok: violations.length === 0, violations }
}

/** Build the repair instruction fed back to the model for a second pass. */
export function repairInstruction(violations: string[]): string {
  return [
    'FACT-CHECK FAILURE: parts of your last reply contradict the verified board. The app verified every claim and found:',
    ...violations.slice(0, 6).map((v) => `- ${v}`),
    'Rewrite your reply using ONLY the verified move lists, piece list and engine lines from the context. If you are not certain a move is legal, do not name it: describe the idea instead. Keep the same coaching intent.',
  ].join('\n')
}
