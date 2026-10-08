import { NextRequest, NextResponse } from 'next/server'
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
import { routeMessage, hasGenerationIntent, type CommandOutcome, type CoachAction } from '@/lib/server/coach-commands'
import { describeFen } from '@/lib/server/chess-describe'
import { dayKeyLocal } from '@/lib/day'

export const maxDuration = 120

const VALID_VIEWS = new Set(['home', 'play', 'lessons', 'puzzles', 'review', 'coach', 'analysis', 'profile', 'settings'])
const VALID_COACHES = new Set(['nina', 'victor', 'elena', 'sasha'])

/** Model-emitted app actions, whitelisted and shape-checked. */
function parseActionBlock(raw: string): CoachAction | null {
  const matches = [...raw.matchAll(/```(?:chessx-action|action)\s*\n?([\s\S]*?)```/gi)]
  if (!matches.length) return null
  const last = matches[matches.length - 1]
  const braceStart = last[1].indexOf('{')
  const braceEnd = last[1].lastIndexOf('}')
  if (braceStart === -1 || braceEnd <= braceStart) return null
  try {
    const obj = JSON.parse(last[1].slice(braceStart, braceEnd + 1)) as Record<string, unknown>
    const type = String(obj.action ?? obj.type ?? '')
    if (type === 'flip_board') return { type: 'flip_board' }
    if (type === 'reset_board') return { type: 'reset_board' }
    if (type === 'toggle_dark') return { type: 'toggle_dark' }
    if (type === 'toggle_sound') return { type: 'toggle_sound' }
    if (type === 'goto' && VALID_VIEWS.has(String(obj.view ?? ''))) {
      return { type: 'goto', view: String(obj.view) }
    }
    if (type === 'switch_coach' && VALID_COACHES.has(String(obj.coachId ?? ''))) {
      return { type: 'switch_coach', coachId: String(obj.coachId) }
    }
  } catch {
    /* a malformed block is simply ignored */
  }
  return null
}

function stripActionBlock(raw: string): string {
  return raw
    .replace(/```(?:chessx-action|action)\s*\n?[\s\S]*?```/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''

  const ctx = body.context ?? {}
  const skill = String(ctx.skillLevel ?? 'beginner')
  const coach = coachById(typeof ctx.coach === 'string' ? ctx.coach : 'nina')
  const cfg = await getAiConfig(profile.id)

  // Generation runner shared by commands, direct requests and model blocks:
  // one place for rate limits and skill execution.
  const runGeneration = async (skillId: SkillId, theme?: unknown): Promise<ReturnType<typeof runSkill>> => {
    const limited = checkRateLimit(profile.id, dayKeyLocal())
    if (limited) throw new SkillError(limited)
    return runSkill({
      skill: skillId,
      cfg,
      profileId: profile.id,
      skillLevel: profile.skillLevel,
      tier: ctx.tier,
      level: ctx.level,
      theme,
      fen: ctx.fen,
    })
  }

  const levelCtx = resolveLevelContext(ctx.tier, ctx.level, skill)

  // ---------------------------------------------------------------
  // Deterministic routing: /commands, greetings, app actions and
  // unambiguous generation requests never reach the language model.
  // This is the reliability guarantee: "hi" can never come back as a
  // puzzle and "flip white and black" always flips the board.
  // ---------------------------------------------------------------
  try {
    const routed = await routeMessage({
      message: lastUser,
      cfg,
      profile: {
        id: profile.id,
        name: profile.name,
        skillLevel: profile.skillLevel,
        coach: profile.coach,
        darkMode: profile.darkMode,
        soundEnabled: profile.soundEnabled,
      },
      ctx: { fen: ctx.fen, tier: ctx.tier, level: ctx.level, theme: ctx.theme },
      coach,
      runGeneration,
    })
    if (routed) {
      const out = routed as CommandOutcome
      return NextResponse.json({
        content: out.content,
        provider: cfg.provider,
        ...(out.artifacts?.length ? { artifacts: out.artifacts } : {}),
        ...(out.artifacts?.length === 1 ? { artifact: out.artifacts[0] } : {}),
        ...(out.action ? { action: out.action } : {}),
      })
    }
  } catch (e) {
    if (e instanceof SkillError) {
      return NextResponse.json({ content: `${e.message} Try again in a moment, or use the skill buttons under the chat.`, provider: cfg.provider })
    }
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  // ---------------------------------------------------------------
  // Conversation context
  // ---------------------------------------------------------------
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
    `You are ${coach.name}, the coach inside ChessX, a chess training app, and you are talking with one student${profile.name ? ` called ${profile.name}` : ''}. You are a person at a chessboard, not a menu and not a script.`,
    coach.systemLine,
    `The student self-identifies as: ${skill}. Calibrate depth to that level.`,
    'How you talk:',
    '- Short and alive. A few sentences at most. Sound like a coach sitting across the board, not like a manual.',
    '- If the student greets you, greet them back warmly and offer one concrete next step (a puzzle, a look at the board, a lesson). Two sentences, then stop.',
    '- If the student makes small talk or asks something unrelated to chess (weather, mood, life), answer honestly and briefly in one sentence, with a little warmth or dry humor, then offer the next chess thing. Never refuse, never lecture, never pretend to fetch live data you do not have.',
    '- Match their energy. Excited gets quick and punchy. Tired gets gentle. Confused gets simple words and one idea at a time.',
    '- Ask a short follow-up question when it moves the conversation forward, but not on every message.',
    '- Plain, direct chess language. No hype, no emojis, no filler like "great question".',
    '- Never use the em dash character. Use commas, periods or parentheses instead.',
    '- When a position is given, read the ASCII board carefully square by square before answering. Trust the board, not guesses about move order. Be concrete: name squares, pieces and moves in SAN.',
    '- Only name an opening or variation if you are certain it matches the moves actually played. If unsure, describe the moves and plans instead of guessing a name.',
    '- In a lesson exercise, guide with questions and ideas. Do NOT hand over the solution move unless the student explicitly asks for it after trying.',
    '- You may be wrong about deep calculation; hedge when unsure and suggest checking with the engine.',
    '- The student can type / to see your skills (commands like /puzzle, /mate, /analyze, /recap). Mention one fitting command when it is the fastest path to what they want. There is also /help.',
    ...skillProtocolLines(),
    'Controlling the app (your hands):',
    'When the student asks you to change the app itself (flip or turn the board, reset the board, open a section, switch the coach), end your reply with ONE block:',
    '```chessx-action',
    '{"action":"flip_board"}',
    '```',
    'Valid actions: flip_board, reset_board, toggle_dark, toggle_sound, goto (add "view": home|play|lessons|puzzles|review|coach|analysis|profile|settings), switch_coach (add "coachId": nina|victor|elena|sasha).',
    'The app executes the action after your reply. Only include the block when the student clearly wants the app itself to change.',
    contextLines.length ? `\nContext:\n${contextLines.join('\n')}` : '',
  ].join('\n')

  try {
    const raw = await runChat(cfg, system, messages)

    let content = raw
    let artifact: unknown = null
    let action: CoachAction | null = null
    let extraNote = ''

    // Model-issued actions: whitelist-checked, block stripped from the prose.
    const parsedAction = parseActionBlock(raw)
    if (parsedAction) {
      action = parsedAction
      content = stripActionBlock(content)
    }

    // A skill block means the coach promised the student material. The app
    // itself generates, verifies and stores it; the model never writes the
    // content. The block is only honored when the student actually asked for
    // material (deterministic gate), so a model that fires its skill
    // protocol on "hi" or "how is the weather" cannot ship a puzzle.
    const extracted = extractSkillBlock(content)
    if (extracted) {
      content = extracted.content
      const skillId = String(extracted.params.skill ?? '')
      if (hasGenerationIntent(lastUser)) {
        if (SKILL_IDS.includes(skillId as SkillId)) {
          try {
            artifact = await runGeneration(skillId as SkillId, extracted.params.theme)
          } catch (e) {
            const reason = e instanceof SkillError ? e.message : 'the generation did not pass verification'
            extraNote = `\n\n(I tried to generate that material but it failed: ${reason} The skill buttons under the chat retry the same request.)`
          }
        } else {
          extraNote = '\n\n(I meant to generate material but named an unknown skill. Use the skill buttons under the chat instead.)'
        }
      } else if (!content.trim()) {
        content = 'I can build that for you: a puzzle, a mate hunt, a drill from the board or a quiz. Say the word and it appears, verified.'
      }
    }

    return NextResponse.json({
      content: (content + extraNote).trim(),
      provider: cfg.provider,
      ...(artifact ? { artifact } : {}),
      ...(action ? { action } : {}),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
