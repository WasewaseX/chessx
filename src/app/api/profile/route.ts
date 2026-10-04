import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const DEFAULTS = {
  id: 'me',
  name: 'Player',
  skillLevel: 'beginner',
}

export async function GET() {
  let profile = await db.profile.findUnique({ where: { id: 'me' } })
  if (!profile) {
    profile = await db.profile.create({ data: DEFAULTS })
  }
  return NextResponse.json({ profile: publicProfile(profile) })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}
  const strFields = ['name', 'skillLevel', 'coach', 'theme', 'darkMode', 'aiProvider', 'aiBaseUrl', 'aiModel', 'aiApiKey']
  const boolFields = ['soundEnabled', 'showCoords', 'showLegal', 'autoPromote', 'onboarded']
  for (const f of strFields) {
    if (f in body) {
      if (f === 'aiApiKey' && (body[f] === null || body[f] === '')) data.aiApiKey = null
      else if (f === 'aiBaseUrl' && body[f] === '') data.aiBaseUrl = null
      else if (f === 'aiModel' && body[f] === '') data.aiModel = null
      else data[f] = String(body[f]).slice(0, 300)
    }
  }
  for (const f of boolFields) if (f in body) data[f] = Boolean(body[f])
  if ('goalMinutes' in body) {
    const g = Number(body.goalMinutes)
    if (Number.isFinite(g)) data.goalMinutes = Math.max(5, Math.min(120, Math.round(g)))
  }
  const profile = await db.profile.upsert({
    where: { id: 'me' },
    update: data,
    create: { ...DEFAULTS, ...data },
  })
  return NextResponse.json({ profile: publicProfile(profile) })
}

function publicProfile(p: Record<string, unknown>) {
  // never send the raw API key to the client, only whether one exists
  const { aiApiKey, ...rest } = p as { aiApiKey?: string | null }
  return { ...rest, hasApiKey: Boolean(aiApiKey) }
}
