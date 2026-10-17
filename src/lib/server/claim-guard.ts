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
  for (const m of stripNoise(text).matchAll(PIECE_AT_RE)) {
    const claimed = m[1].toLowerCase()
    const sq = m[2].toLowerCase()
    if (negs.some((n) => n === sq)) continue // the reply itself denies it
    const at = g.get(sq as never)
    if (!at || at.type !== claimed[0]) {
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

/**
 * Verify every chess claim in a reply against the position. `fen` is the
 * position the conversation was in when the reply was written.
 */
export function verifyClaims(text: string, fen: string): ClaimVerdict {
  if (!fen) return { ok: true, violations: [] }
  let base: Chess
  try {
    base = new Chess(fen)
  } catch {
    return { ok: true, violations: [] }
  }
  const violations: string[] = []

  violations.push(...checkPieceClaims(text, base))
  violations.push(...checkSideClaims(text, base))
  violations.push(...checkMateClaims(text, base))

  // Move replay: walk tokens in order; on failure retry from the base
  // position (the model often restarts lines: "after e5, what if Nxe5?").
  // chess.js leaves the game state untouched on a failed move, so a bad token
  // can never cascade.
  const replayText = stripPiecePhrases(stripNoise(text))
  const cursor = new Chess(fen)
  const fresh = new Chess(fen)
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
      // Bare squares ("the e5 square is weak") are only violations when the
      // reply clearly meant a move ("White plays e5"). Named moves (Nxe5,
      // O-O, exd5) are always strict.
      if (!bare || hasMoveIntent(replayText.slice(lastIdx, m.index))) {
        violations.push(`the move "${san}" is not legal in the current position or in any line named before it`)
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
