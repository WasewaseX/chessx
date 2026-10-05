import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { createSession, isSupportedEmail, sessionCookieOptions, SESSION_COOKIE } from '@/lib/auth'
import {
  exchangeCodeForProfile,
  externalUrl,
  googleConfigured,
  OAUTH_STATE_COOKIE,
  stateMatches,
} from '@/lib/google-oauth'

export const dynamic = 'force-dynamic'

function fail(req: NextRequest, kind: 'google' | 'unsupported'): NextResponse {
  const url = new URL(externalUrl(req, '/'))
  url.searchParams.set('authError', kind)
  const res = NextResponse.redirect(url.toString())
  res.cookies.set(OAUTH_STATE_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}

function deriveUsername(local: string): string {
  const base = local.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 14)
  return base.length >= 3 ? base : `chessx_${base.replace(/_/g, '') || ''}`
}

async function uniqueUsername(seed: string): Promise<string> {
  let candidate = seed
  for (let attempt = 0; attempt < 20; attempt++) {
    const clash = await db.user.findFirst({ where: { usernameLower: candidate.toLowerCase() } })
    if (!clash) return candidate
    candidate = `${seed.slice(0, 12)}${Math.floor(Math.random() * 9000) + 1000}`
  }
  return `chessx_${randomBytes(4).toString('hex')}`
}

export async function GET(req: NextRequest) {
  if (!googleConfigured()) return fail(req, 'google')

  const params = req.nextUrl.searchParams
  const code = params.get('code')
  const state = params.get('state')
  const store = await cookies()
  const savedState = store.get(OAUTH_STATE_COOKIE)?.value

  if (!code || !stateMatches(state, savedState)) return fail(req, 'google')

  const profile = await exchangeCodeForProfile(req, code).catch(() => null)
  if (!profile) return fail(req, 'google')

  const domain = profile.email.slice(profile.email.lastIndexOf('@') + 1)

  // Existing accounts link by Google subject or by matching email. A brand
  // new account on an unsupported provider is refused without explanation.
  let user =
    (await db.user.findUnique({ where: { googleId: profile.sub } })) ??
    (await db.user.findUnique({ where: { email: profile.email } }))

  if (!user && domain !== 'gmail.com') return fail(req, 'unsupported')
  if (user && user.role !== 'admin' && !isSupportedEmail(user.email)) {
    return fail(req, 'unsupported')
  }

  if (!user) {
    const username = await uniqueUsername(deriveUsername(profile.email.split('@')[0]))
    user = await db.user.create({
      data: {
        email: profile.email,
        username,
        usernameLower: username.toLowerCase(),
        // random value bcrypt can never match; Google accounts sign in via OAuth
        passwordHash: `oauth:${randomBytes(24).toString('base64url')}`,
        googleId: profile.sub,
        profile: { create: { name: username } },
        ratings: {
          create: [
            { pool: 'bullet', rating: 1000, rd: 350 },
            { pool: 'blitz', rating: 1000, rd: 350 },
            { pool: 'rapid', rating: 1000, rd: 350 },
          ],
        },
      },
    })
  } else if (!user.googleId) {
    await db.user.update({ where: { id: user.id }, data: { googleId: profile.sub } })
  }

  const { token, expiresAt } = await createSession(user.id)
  const target = new URL(externalUrl(req, '/'))
  // never land on a stale authError from a previous attempt
  target.search = ''
  const res = NextResponse.redirect(target.toString())
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt))
  res.cookies.set(OAUTH_STATE_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
