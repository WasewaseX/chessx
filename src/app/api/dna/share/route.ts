// Shareable Chess DNA report. POST mints (or returns) the caller's public
// share token; GET answers with a privacy-safe snapshot for that token —
// display name, archetype, domain scores/percentiles/samples and the honest
// sample-size notes. Never the email, user id, ratings or any other account
// data. The token is random 192 bits; sharing can be turned off by clearing
// it (DELETE), which immediately invalidates every previously shared link.
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { getSessionUser, originOk, rateLimit } from '@/lib/auth'
import { buildDnaReport } from '@/lib/server/chess-dna'

export const dynamic = 'force-dynamic'

/** The public shape — deliberately narrow, reviewed like an API contract. */
function publicReport(profile: { name: string }, report: Awaited<ReturnType<typeof buildDnaReport>>) {
  return {
    name: profile.name,
    ready: report.ready,
    games: report.games,
    archetype: report.archetype ? { name: report.archetype.name, tagline: report.archetype.tagline } : null,
    strongest: report.strongest,
    weakest: report.weakest,
    population: report.population,
    computedAt: report.computedAt,
    domains: report.domains.map((d) => ({
      key: d.key,
      label: d.label,
      score: d.score,
      percentile: d.percentile,
      sample: d.sample,
      note: d.note,
    })),
  }
}

export async function POST(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: 'Security check failed' }, { status: 403 })
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (!rateLimit(`dna-share:${user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  let token = profile.dnaShareToken
  if (!token) {
    token = randomBytes(24).toString('base64url')
    await db.profile.update({ where: { id: profile.id }, data: { dnaShareToken: token } })
  }

  const report = await buildDnaReport(profile.id)
  return NextResponse.json(
    { token, report: publicReport(profile, report) },
    { headers: { 'cache-control': 'no-store' } },
  )
}

export async function DELETE(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: 'Security check failed' }, { status: 403 })
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  await db.profile.update({ where: { id: profile.id }, data: { dnaShareToken: null } })
  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
}

export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (token.length < 16 || token.length > 64 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return NextResponse.json({ error: 'Invalid share link' }, { status: 400 })
  }
  if (!rateLimit(`dna-share-read:${clientKey(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const profile = await db.profile.findUnique({ where: { dnaShareToken: token } })
  if (!profile) return NextResponse.json({ error: 'This share link is no longer active' }, { status: 404 })

  const report = await buildDnaReport(profile.id)
  return NextResponse.json(
    { report: publicReport(profile, report) },
    { headers: { 'cache-control': 'no-store' } },
  )
}

function clientKey(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'local'
  )
}
