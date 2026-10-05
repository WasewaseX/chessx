import { NextRequest, NextResponse } from 'next/server'
import { Chess } from 'chess.js'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { runChat, getAiConfig, type ChatMessage } from '@/lib/ai'
import { coachById } from '@/lib/coaches'

export const maxDuration = 60

/** ASCII board + metadata: LLMs reason far better over this than raw FEN. */
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

function describeFen(fen: string): string | null {
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
    const [ , castling, enPassant, halfmove, fullmove ] = fen.split(' ')

    // ground-truth diff vs the standard start position (kills opening-theory hallucinations)
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

    return [
      'ASCII board (uppercase = White, lowercase = Black, rank 8 first, dots = empty):',
      board,
      '    a b c d e f g h',
      `Side to move: ${turn}. Castling: ${castling === '-' ? 'none' : castling}. En passant target: ${enPassant}. Move ${fullmove}, halfmove clock ${halfmove}.`,
      `Material (pawn=1, bishop/knight=3, rook=5, queen=9): White ${material.w} vs Black ${material.b}.`,
      diffs.length
        ? `Pieces NOT on their starting squares (verified facts, trust these over theory): ${diffs.join('; ')}.`
        : 'Every piece is still on its starting square.',
    ].join('\n')
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })

  const body = await req.json().catch(() => ({}))
  const messages: ChatMessage[] = Array.isArray(body.messages)
    ? body.messages
        .filter((m: { role?: string; content?: string }) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-16)
        .map((m: { role: 'user' | 'assistant'; content: string }) => ({ role: m.role, content: m.content.slice(0, 4000) }))
    : []
  if (messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 })
  }

  const ctx = body.context ?? {}
  const skill = String(ctx.skillLevel ?? 'beginner')
  const coach = coachById(typeof ctx.coach === 'string' ? ctx.coach : 'nina')

  const contextLines: string[] = []
  if (ctx.fen) {
    contextLines.push(`Current position FEN: ${ctx.fen}`)
    const described = describeFen(String(ctx.fen))
    if (described) contextLines.push(described)
  }
  if (ctx.lessonTitle) contextLines.push(`The student is working on the lesson "${ctx.lessonTitle}".`)
  if (ctx.stepHint) contextLines.push(`Current exercise: ${ctx.stepHint}`)
  if (ctx.pgn) contextLines.push(`Game so far (PGN):\n${String(ctx.pgn).slice(0, 3000)}`)
  if (ctx.moves) contextLines.push(`Moves played so far: ${ctx.moves}`)

  // A saved game the student wants to talk about. The report facts come straight
  // from this app's stored analysis, never from the client, so the coach can
  // only quote numbers the engine actually produced.
  if (typeof ctx.gameId === 'string' && ctx.gameId.length > 5 && ctx.gameId.length < 64) {
    const saved = await db.gameRecord.findFirst({
      where: { id: ctx.gameId, profileId: profile.id },
    })
    if (saved) {
      contextLines.push(
        `Saved game: the student played ${saved.color === 'w' ? 'White' : 'Black'} against ${saved.botName}, a ChessX practice bot. Result: ${saved.result} by ${saved.reason}, ${saved.moveCount} moves.`,
      )
      if (saved.analyzedAt && saved.whiteAcc != null && saved.blackAcc != null) {
        let countsLine = ''
        try {
          const counts = JSON.parse(saved.labelsJson ?? '{}') as Record<string, { w: number; b: number }>
          const side = (c: 'w' | 'b') =>
            (['brilliant', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'] as const)
              .filter((l) => (counts[l]?.[c] ?? 0) > 0)
              .map((l) => `${counts[l][c]} ${l}${counts[l][c] === 1 ? '' : 's'}`)
              .join(', ')
          const w = side('w')
          const b = side('b')
          countsLine = ` White moves: ${w || 'all clean'}. Black moves: ${b || 'all clean'}.`
        } catch {
          // malformed counts stay out; accuracy lines below are still real
        }
        contextLines.push(
          `Engine report stored by this app (quote these numbers as facts): Opening: ${saved.opening ?? 'not identified'}. Accuracy: White ${saved.whiteAcc}%, Black ${saved.blackAcc}%. The student's accuracy: ${saved.playerAcc ?? saved.whiteAcc ?? '?'}%.${countsLine}`,
        )
      } else {
        contextLines.push('This game has not been run through the engine report yet, so no accuracy numbers exist. Do not invent any; analyze the moves directly.')
      }
      if (saved.pgn) contextLines.push(`Full game PGN:\n${saved.pgn.slice(0, 3000)}`)
    }
  }

  const system = [
    `You are ${coach.name}, the coach inside ChessX, a chess training app. You talk to one student.`,
    coach.systemLine,
    `The student self-identifies as: ${skill}. Calibrate depth to that level.`,
    'Rules of conduct:',
    '- Be concise. A few short paragraphs at most. No lists unless asked.',
    '- Plain, direct chess language. No hype, no emojis, no filler like "great question".',
    '- Never open with a greeting or introduction. Answer the question straight away, every time.',
    '- Never use the em dash character. Use commas, periods or parentheses instead.',
    '- When a position is given, read the ASCII board carefully square by square before answering. Trust the board, not guesses about move order. Be concrete: name squares, pieces and moves in SAN.',
    '- Only name an opening or variation if you are certain it matches the moves actually played. If unsure, describe the moves and plans instead of guessing a name.',
    '- In a lesson exercise, guide with questions and ideas. Do NOT hand over the solution move unless the student explicitly asks for it after trying.',
    '- You may be wrong about deep calculation; hedge when unsure and suggest checking with the engine.',
    '- If the student asks something unrelated to chess, answer briefly and steer back.',
    contextLines.length ? `\nContext:\n${contextLines.join('\n')}` : '',
  ].join('\n')

  try {
    const cfg = await getAiConfig(profile.id)
    const content = await runChat(cfg, system, messages)
    return NextResponse.json({ content, provider: cfg.provider })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
