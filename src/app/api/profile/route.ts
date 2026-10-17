import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { seedForSkill } from '@/lib/rating'
import { publicProfile } from '@/lib/api'
import { assertSafeAiEndpoint, encryptSecret, EndpointError } from '@/lib/server/security'

export const dynamic = 'force-dynamic'

// One Elo row per account (pool 'overall'). Created the moment the player
// picks a level during onboarding so the account carries its starting rating
// from day one, exactly like chess.com shows a rating after signup.
export async function ensureRatingRow(userId: string, skillLevel: string) {
  const existing = await db.userRating.findUnique({
    where: { userId_pool: { userId, pool: 'overall' } },
  })
  if (existing) return existing
  return db.userRating.create({
    data: { userId, pool: 'overall', rating: seedForSkill(skillLevel) },
  })
}

// ---------------------------------------------------------------------------
// Strict PATCH schema: real booleans, real enums, no silent coercion.
// A string "false" used to become true via Boolean(); Zod rejects it now.
// Unknown keys are stripped instead of blindly written to the database.
// ---------------------------------------------------------------------------

const SKILL_LEVELS = ['new', 'beginner', 'intermediate', 'advanced', 'expert'] as const
const COACHES = ['', 'nina', 'victor', 'elena', 'sasha'] as const
const THEMES = ['green', 'brown', 'slate', 'walnut'] as const
const DARK_MODES = ['light', 'dark', 'system'] as const
const AI_PROVIDERS = ['builtin', 'openai', 'anthropic', 'gemini', 'openrouter', 'groq', 'deepseek', 'custom'] as const

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    skillLevel: z.enum(SKILL_LEVELS).optional(),
    coach: z.enum(COACHES).optional(),
    theme: z.enum(THEMES).optional(),
    darkMode: z.enum(DARK_MODES).optional(),
    aiProvider: z.enum(AI_PROVIDERS).optional(),
    // URL shape + SSRF guard run below, once the provider is known.
    aiBaseUrl: z.string().max(300).nullable().optional(),
    aiModel: z.string().trim().max(120).nullable().optional(),
    aiApiKey: z.string().max(300).nullable().optional(),
    goalMinutes: z.number().int().min(5).max(120).optional(),
    soundEnabled: z.boolean().optional(),
    showCoords: z.boolean().optional(),
    showLegal: z.boolean().optional(),
    autoPromote: z.boolean().optional(),
    onboarded: z.boolean().optional(),
  })
  .strict()

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) {
    profile = await db.profile.create({
      data: { userId: user.id, name: user.username },
    })
  }
  const ratings = await db.userRating.findMany({ where: { userId: user.id } })
  // self-heal: a rating outside 100..3500 is corrupt data from an older build,
  // never a real result. Repair to the skill seed instead of showing an
  // impossible number.
  for (const r of ratings) {
    if (r.rating > 3500 || r.rating < 100) {
      const fixed = await db.userRating.update({
        where: { id: r.id },
        data: { rating: seedForSkill(profile.skillLevel), rd: 350 },
      })
      Object.assign(r, fixed)
    }
  }
  return NextResponse.json({
    profile: publicProfile(profile),
    ratings: ratings.map(publicRating),
  })
}

export async function PATCH(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid settings'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  const body = parsed.data
  const data: Record<string, unknown> = {}

  if (body.name !== undefined) data.name = body.name
  if (body.skillLevel !== undefined) data.skillLevel = body.skillLevel
  if (body.coach !== undefined) data.coach = body.coach
  if (body.theme !== undefined) data.theme = body.theme
  if (body.darkMode !== undefined) data.darkMode = body.darkMode
  if (body.aiProvider !== undefined) data.aiProvider = body.aiProvider
  if (body.goalMinutes !== undefined) data.goalMinutes = body.goalMinutes
  for (const f of ['soundEnabled', 'showCoords', 'showLegal', 'autoPromote', 'onboarded'] as const) {
    if (body[f] !== undefined) data[f] = body[f]
  }

  // AI key: encrypted at rest, never logged, never returned to clients.
  if (body.aiApiKey !== undefined) {
    data.aiApiKey = body.aiApiKey === null || body.aiApiKey === '' ? null : encryptSecret(body.aiApiKey)
  }
  if (body.aiModel !== undefined) {
    data.aiModel = body.aiModel === null || body.aiModel === '' ? null : body.aiModel
  }
  if (body.aiBaseUrl !== undefined) {
    if (body.aiBaseUrl === null || body.aiBaseUrl === '') {
      data.aiBaseUrl = null
    } else {
      // SSRF guard runs at SAVE time so bad URLs are rejected with a clear
      // message; runChat re-validates at call time as a second fence.
      try {
        assertSafeAiEndpoint(body.aiBaseUrl)
        data.aiBaseUrl = body.aiBaseUrl
      } catch (e) {
        const msg = e instanceof EndpointError ? e.message : 'That base URL is not allowed.'
        return NextResponse.json({ error: msg }, { status: 400 })
      }
    }
  }

  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) {
    profile = await db.profile.create({ data: { userId: user.id, name: user.username, ...data } })
  } else {
    profile = await db.profile.update({ where: { id: profile.id }, data })
  }

  // The level pick during onboarding seeds the account Elo (400 / 800 / 1200
  // / 1600 / 2000, the chess.com ladder). A row created at signup holds a
  // provisional 1000; the chosen skill seed replaces it exactly once, while
  // the account has not played any rated game yet (games === 0). After the
  // first rated game the rating belongs to Glicko and is never reseeded.
  const skill = (data.skillLevel as string | undefined) ?? profile.skillLevel
  const row = await ensureRatingRow(user.id, skill)
  if ('skillLevel' in data && row.games === 0 && row.rd >= 350) {
    const seed = seedForSkill(skill)
    if (Math.round(row.rating) !== Math.round(seed)) {
      await db.userRating.update({ where: { id: row.id }, data: { rating: seed, rd: 350 } })
    }
  }

  const ratings = await db.userRating.findMany({ where: { userId: user.id } })
  return NextResponse.json({
    profile: publicProfile(profile),
    ratings: ratings.map(publicRating),
  })
}

function publicRating(r: { pool: string; rating: number; rd: number; games: number; wins: number; losses: number; draws: number }) {
  return {
    pool: r.pool,
    rating: Math.round(r.rating),
    rd: Math.round(r.rd),
    games: r.games,
    wins: r.wins,
    losses: r.losses,
    draws: r.draws,
  }
}
