import { NextRequest, NextResponse } from 'next/server'
import { Chess } from 'chess.js'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { runChat, getAiConfig, type ChatMessage } from '@/lib/ai'
import { coachById } from '@/lib/coaches'
import {
  extractSkillBlock,
  resolveLevelContext,
  runSkill,
  checkRateLimit,
  skillProtocolLines,
  SKILL_IDS,
  SkillError,
  type SkillId,
} from '@/lib/server/coach-skills'
import { describeFen } from '@/lib/server/chess-describe'
import { dayKeyLocal } from '@/lib/day'

export const maxDuration = 120

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
  // Course anchor for skill requests: the client sends the level the student
  // is on, and generated material is calibrated against it.
  const levelCtx = resolveLevelContext(ctx.tier, ctx.level, skill)
  if (ctx.tier != null || ctx.level != null) {
    contextLines.push(`Course progress: ${levelCtx.tierTitle}, Level ${levelCtx.levelN} ("${levelCtx.levelTitle}").`)
  }

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
    ...skillProtocolLines(),
    contextLines.length ? `\nContext:\n${contextLines.join('\n')}` : '',
  ].join('\n')

  try {
    const cfg = await getAiConfig(profile.id)
    const raw = await runChat(cfg, system, messages)

    // A skill block means the coach just promised the student material.
    // The app itself generates, verifies and stores it; the model never
    // writes the content and never learns the artifact back.
    let content = raw
    let artifact: unknown = null
    let extraNote = ''
    const extracted = extractSkillBlock(raw)
    if (extracted) {
      content = extracted.content
      const skillId = String(extracted.params.skill ?? '')
      if (SKILL_IDS.includes(skillId as SkillId)) {
        const limited = checkRateLimit(profile.id, dayKeyLocal())
        if (limited) {
          extraNote = `\n\n(${limited})`
        } else {
          try {
            artifact = await runSkill({
              skill: skillId as SkillId,
              cfg,
              profileId: profile.id,
              skillLevel: profile.skillLevel,
              // tier/level/fen come from the app's own context, never from
              // the model, so a hallucinated FEN can never enter the loop.
              tier: ctx.tier,
              level: ctx.level,
              theme: extracted.params.theme,
              fen: ctx.fen,
            })
          } catch (e) {
            const reason = e instanceof SkillError ? e.message : 'the generation did not pass verification'
            extraNote = `\n\n(I tried to generate that material but it failed: ${reason} The skill buttons under the chat retry the same request.)`
          }
        }
      } else {
        extraNote = '\n\n(I meant to generate material but named an unknown skill. Use the skill buttons under the chat instead.)'
      }
    }

    return NextResponse.json({ content: (content + extraNote).trim(), provider: cfg.provider, artifact })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
