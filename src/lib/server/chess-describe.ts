// ASCII board rendering for LLM prompts. Models reason far better over this
// than raw FEN, and the ground-truth diff against the start position kills
// hallucinated pieces.
import 'server-only'
import { Chess } from 'chess.js'

const PIECE_NAMES: Record<string, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
}

function pieceMap(g: Chess): Map<string, string> {
  const m = new Map<string, string>()
  for (const row of g.board()) {
    for (const sq of row) {
      if (sq) m.set(sq.square, (sq.color === 'w' ? sq.type.toUpperCase() : sq.type))
    }
  }
  return m
}

export function describeFen(fen: string): string | null {
  try {
    const g = new Chess(fen)
    const rows = fen.split(' ')[0].split('/')
    const board = rows
      .map((row, i) => {
        let line = ''
        for (const ch of row) {
          if (/\d/.test(ch)) line += '. '.repeat(parseInt(ch, 10))
          else line += `${ch} `
        }
        return `${8 - i}  ${line.trimEnd()}`
      })
      .join('\n')
    const turn = g.turn() === 'w' ? 'White' : 'Black'
    const [, castling, enPassant, halfmove, fullmove] = fen.split(' ')

    const now = pieceMap(g)
    const start = pieceMap(new Chess())
    const diffs: string[] = []
    for (const [sq, piece] of now) {
      if (start.get(sq) !== piece) {
        const color = piece === piece.toUpperCase() ? 'White' : 'Black'
        const name = PIECE_NAMES[piece.toLowerCase()]
        const fromSquare = [...start.entries()].find(([, p]) => p === piece)?.[0]
        diffs.push(
          fromSquare
            ? `${color} ${name} on ${sq} (its starting square was ${fromSquare})`
            : `${color} ${name} on ${sq}`,
        )
      }
    }
    for (const [sq, piece] of start) {
      if (!now.has(sq)) {
        const color = piece === piece.toUpperCase() ? 'White' : 'Black'
        diffs.push(`${color} ${PIECE_NAMES[piece.toLowerCase()]} no longer on ${sq}`)
      }
    }

    const material: Record<'w' | 'b', number> = { w: 0, b: 0 }
    for (const piece of now.values()) {
      const t = piece.toLowerCase()
      if (t === 'k') continue
      const val = { p: 1, n: 3, b: 3, r: 5, q: 9 }[t] ?? 0
      material[piece === piece.toUpperCase() ? 'w' : 'b'] += val
    }

    const pieces = [...now.entries()]
      .map(([sq, piece]) => `${piece === piece.toUpperCase() ? 'White' : 'Black'} ${PIECE_NAMES[piece.toLowerCase()]} on ${sq}`)
      .sort()
      .join(', ')

    return [
      'ASCII board (uppercase = White, lowercase = Black, rank 8 first, dots = empty):',
      board,
      '    a b c d e f g h',
      `Side to move: ${turn}. Castling: ${castling === '-' ? 'none' : castling}. En passant target: ${enPassant}. Move ${fullmove}, halfmove clock ${halfmove}.`,
      `Material (pawn=1, bishop/knight=3, rook=5, queen=9): White ${material.w} vs Black ${material.b}.`,
      `Complete piece list (verified facts, trust these over anything you remember): ${pieces}.`,
      diffs.length
        ? `Pieces NOT on their starting squares: ${diffs.join('; ')}.`
        : 'Every piece is still on its starting square.',
    ].join('\n')
  } catch {
    return null
  }
}
