// Coach chat for Play-with-Coach: the student asks anything about the game in
// progress ("why wasn't Bg4 good?", "what should I have played instead?") and
// the coach answers honestly, grounded in the position dossier and the
// engine-verified classification trail this app produced.
//
// Honesty contract (same as the main coach): the board is the truth anchor.
// Every reply is replayed through verifyClaims; invented moves, phantom
// pieces and fake mates get one repair pass, then a visible correction.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, rateLimit, clientIp } from '@/lib/auth'
import { runChat, getAiConfig, type ChatMessage } from '@/lib/ai'
import { coachById } from '@/lib/coaches'
import { buildDossier } from '@/lib/server/position-dossier'
import { describeFen } from '@/lib/server/chess-describe'
import { verifyClaims, repairInstruction } from '@/lib/server/claim-guard'

export const maxDuration = 120

interface TrailPly {
  san: string
  color: 'w' | 'b'
  label: string
  before: number | null
  after: number | null
  bestSan: string | null
  reason?: string
  cpl?: number | null
}

function sanitizeTrail(raw: unknown): TrailPly[] {
  if (!Array.isArray(raw)) return []
  const out: TrailPly[] = []
  for (const item of raw.slice(-40)) {
    const p = item as Partial<TrailPly>
    if (typeof p.san !== 'string' || !p.san) continue
    out.push({
      san: p.san.slice(0, 8),
      color: p.color === 'b' ? 'b' : 'w',
      label: typeof p.label === 'string' ? p.label.slice(0, 20) : 'unknown',
      before: typeof p.before === 'number' ? Math.max(-100, Math.min(100, p.before)) : null,
      after: typeof p.after === 'number' ? Math.max(-100, Math.min(100, p.after)) : null,
      bestSan: typeof p.bestSan === 'string' ? p.bestSan.slice(0, 8) : null,
      reason: typeof p.reason === 'string' ? p.reason.slice(0, 300) : undefined,
      cpl: typeof p.cpl === 'number' ? Math.max(0, Math.min(2000, p.cpl)) : null,
    })
  }
  return out
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const unlocked = user.role === 'admin'
  if (!unlocked && (!rateLimit(`cg-chat:${user.id}`, 20, 60_000) || !rateLimit(`cg-chat-ip:${clientIp(req)}`, 40, 60_000))) {
    return NextResponse.json({ error: 'Slow down a moment, the coach needs to breathe. Try again shortly.' }, { status: 429 })
  }

  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 2000) : ''
  if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 })

  const fen = typeof body.fen === 'string' && body.fen.length < 200 ? body.fen : undefined
  const coachId = typeof body.coachId === 'string' ? body.coachId : 'nina'
  const eloRaw = typeof body.elo === 'number' ? body.elo : 1200
  const elo = Math.max(400, Math.min(2400, Math.round(eloRaw)))
  const history = Array.isArray(body.history)
    ? body.history
        .filter((m): m is { role: 'user' | 'assistant'; content: string } =>
          !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }) as ChatMessage)
    : []
  const trail = sanitizeTrail(body.trail)
  const focusSan = typeof body.focusSan === 'string' ? body.focusSan.slice(0, 8) : undefined

  const coach = coachById(coachId)
  const cfg = await getAiConfig(profile.id)

  // ---------------------------------------------------------------
  // Grounding: the position dossier (board, pieces, legal census, engine
  // lines) is the honesty layer; the trail carries the engine-verified
  // labels for the moves already played.
  // ---------------------------------------------------------------
  const contextLines: string[] = []
  contextLines.push(
    `This is a COACHING GAME in progress. You picked the strength: about ${elo} Elo. The student is learning live, so teach from the position on the board.`,
  )

  // Replay the client trail server-side: the source of honest historical
  // positions (a forged trail simply fails the sanity check and the current
  // FEN stays the only anchor).
  const { Chess } = await import('chess.js')
  const replay = new Chess()
  let replayOk = true
  const fenBefores: string[] = []
  for (const p of trail) {
    fenBefores.push(replay.fen())
    try {
      if (!replay.move(p.san)) {
        replayOk = false
        break
      }
    } catch {
      replayOk = false
      break
    }
  }
  const terminal = replayOk && trail.length > 0 && (replay.isCheckmate() || replay.isStalemate() || replay.isInsufficientMaterial() || replay.isThreefoldRepetition() || replay.isDraw())
  if (terminal) {
    contextLines.push(
      `The game is OVER (${replay.isCheckmate() ? 'checkmate' : 'an end condition'}). Moves already played are history: discuss them in the past tense and do not suggest a move for the side to move unless the student asks about a new position.`,
    )
  }
  if (fen) {
    contextLines.push(`Current position FEN: ${fen}`)
    const dossier = await buildDossier(fen).catch(() => null)
    if (dossier) contextLines.push(dossier)
    else {
      const described = describeFen(fen)
      if (described) contextLines.push(described)
    }
  }
  if (trail.length) {
    const line = trail
      .map((p) => `${p.san}(${p.label}${p.before != null && p.after != null ? ` ${p.before.toFixed(1)}->${p.after.toFixed(1)}` : ''})`)
      .join(' ')
    contextLines.push(`Moves played so far with this app's engine classification (parentheses: label and white-POV pawn eval before->after; these numbers are engine-verified facts you may quote): ${line}`)
    const studentSide = trail[trail.length - 1]?.color === 'w' ? 'b' : 'w'
    const worst = [...trail]
      .filter((p) => p.color === studentSide && ['inaccuracy', 'mistake', 'blunder', 'missedwin'].includes(p.label))
      .pop()
    if (worst) {
      contextLines.push(
        `The student's biggest slip so far: ${worst.san} (${worst.label})${worst.bestSan ? `, the engine move was ${worst.bestSan}` : ''}${worst.reason ? `. Verified reason: ${worst.reason}` : ''}.`,
      )
    }
  }
  if (focusSan) {
    const focus = [...trail].reverse().find((p) => p.san === focusSan)
    if (focus) {
      contextLines.push(
        `The student is asking specifically about ${focus.san} (${focus.label}). Engine facts: eval before ${focus.before ?? '?'} -> after ${focus.after ?? '?'} (white POV, pawns)${focus.bestSan ? `, engine's move: ${focus.bestSan}` : ''}${focus.reason ? `. Reason: ${focus.reason}` : ''}.`,
      )
    }
  }

  const system = [
    `You are ${coach.name}, the coach inside ChessX, sitting NEXT TO the student during a coaching game at the board.`,
    coach.systemLine,
    'You teach honestly: you only state engine facts that appear in the context above, and when something is your judgement you say so plainly.',
    'How you talk:',
    '- Short, warm and concrete. A few sentences at most. Name squares, pieces and moves in SAN.',
    '- When the student asks why a move was good or bad: first the verdict (label), then the WHY in one or two ideas, then, if a better move exists, show it and explain what it keeps or threatens.',
    '- When the student asks "what should I play here": give one main candidate and one alternative, each with the idea behind it. Do not dump ten lines.',
    '- If you are not sure about deep calculation, say so and suggest checking the engine line. Never invent an evaluation number.',
    '- Never use the em dash character. Use commas, periods or parentheses instead.',
    '- No emojis. No filler like "great question". You are a person, not a manual.',
    contextLines.length ? `\nContext:\n${contextLines.join('\n')}` : '',
  ].join('\n')

  const messages: ChatMessage[] = [...history, { role: 'user', content: question }]

  try {
    let content = await runChat(cfg, system, messages)

    // Claim guard. Live game: verify against the current FEN (invented moves
    // must not survive). Every position the game actually passed through
    // rides along as history, so discussing a real past move out of order is
    // not flagged as a hallucination - only moves legal NOWHERE in the game
    // fail the check.
    const historyFens = replayOk ? [...fenBefores, replay.fen()] : []
    const guardFen = fen ?? (historyFens.length ? historyFens[historyFens.length - 1] : undefined)
    // Finished-game narration talks about the capture that produced the final
    // position, so the pre-final board joins the phrase window.
    const phraseFens = replayOk && fenBefores.length ? [fenBefores[fenBefores.length - 1]] : undefined
    if (guardFen) {
      const first = verifyClaims(content, guardFen, historyFens, phraseFens)
      if (!first.ok) {
        const repairSystem = `${system}\n\n${repairInstruction(first.violations)}`
        const repaired = await runChat(cfg, repairSystem, [
          ...messages,
          { role: 'assistant', content },
          { role: 'user', content: 'Your last reply failed the board fact-check. Rewrite it now with only verified moves and pieces.' },
        ]).catch(() => null)
        if (repaired) {
          content = repaired
          const second = verifyClaims(content, guardFen, historyFens, phraseFens)
          if (!second.ok) {
            content += `\n\n(Board fact-check: ${second.violations.slice(0, 3).join('; ')}. Verify against the board.)`
          }
        } else {
          content += `\n\n(Board fact-check: ${first.violations.slice(0, 3).join('; ')}. Verify against the board.)`
        }
      }
    }

    return NextResponse.json({ content, provider: cfg.provider })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
