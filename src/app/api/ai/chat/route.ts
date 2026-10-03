import { NextRequest, NextResponse } from 'next/server'
import { runChat, getAiConfig, type ChatMessage } from '@/lib/ai'

export const maxDuration = 60

export async function POST(req: NextRequest) {
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

  const contextLines: string[] = []
  if (ctx.fen) contextLines.push(`Current position FEN: ${ctx.fen}`)
  if (ctx.lessonTitle) contextLines.push(`The student is working on the lesson "${ctx.lessonTitle}".`)
  if (ctx.stepHint) contextLines.push(`Current exercise: ${ctx.stepHint}`)
  if (ctx.pgn) contextLines.push(`Game so far (PGN):\n${String(ctx.pgn).slice(0, 3000)}`)
  if (ctx.moves) contextLines.push(`Moves played: ${ctx.moves}`)

  const system = [
    'You are the coach inside Ply, a chess training app. You talk to one student.',
    `The student self-identifies as: ${skill}. Calibrate depth to that level.`,
    'Rules of conduct:',
    '- Be concise. A few short paragraphs at most. No lists unless asked.',
    '- Plain, direct chess language. No hype, no emojis, no filler like "great question".',
    '- When a position is given (FEN), you may reason about it. Be concrete: name squares, pieces and moves in SAN.',
    '- In a lesson exercise, guide with questions and ideas. Do NOT hand over the solution move unless the student explicitly asks for it after trying.',
    '- You may be wrong about deep calculation; hedge when unsure and suggest checking with the engine.',
    '- If the student asks something unrelated to chess, answer briefly and steer back.',
    contextLines.length ? `\nContext:\n${contextLines.join('\n')}` : '',
  ].join('\n')

  try {
    const cfg = await getAiConfig()
    const content = await runChat(cfg, system, messages)
    return NextResponse.json({ content, provider: cfg.provider })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
