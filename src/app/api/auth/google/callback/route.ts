import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { createSession, isSupportedEmail, sessionCookieOptions, SESSION_COOKIE } from '@/lib/auth'
import { seedForSkill } from '@/lib/rating'
import {
  exchangeCodeForProfile,
  externalUrl,
  googleConfigured,
  OAUTH_STATE_COOKIE,
  stateMatches,
} from '@/lib/google-oauth'
import {
  DESKTOP_HANDOFF_COOKIE,
  decodeDesktopHandoffCookie,
  mintDesktopToken,
} from '@/lib/server/desktop-handoff'

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
          // Same skill-seeded start as the signup route: no hardcoded Elo.
          create: { pool: 'overall', rating: seedForSkill('beginner'), rd: 350 },
        },
      },
    })
  } else if (!user.googleId) {
    await db.user.update({ where: { id: user.id }, data: { googleId: profile.sub } })
  }

  // Desktop handoff: the round trip that just finished started from the
  // desktop shell's system browser, so a session cookie set here would land
  // in the WRONG browser. The handoff cookie (set by /api/auth/google/start
  // and carried through Google) is the only source of the loopback port and
  // state — query params on this request are ignored for that. Mint a
  // single-use token, bounce the system browser to the shell's 127.0.0.1
  // listener, and let the shell redeem it at /api/auth/desktop, which
  // creates the real session inside the app window. Without the cookie this
  // branch is dead code and the browser flow below runs untouched.
  const desktop = decodeDesktopHandoffCookie(store.get(DESKTOP_HANDOFF_COOKIE)?.value)
  if (desktop) {
    const minted = await mintDesktopToken(user.id)
    const loopback = new URL(`http://127.0.0.1:${desktop.port}/callback`)
    loopback.searchParams.set('state', desktop.state)
    loopback.searchParams.set('token_hash', minted.token)
    if (desktop.next) loopback.searchParams.set('next', desktop.next)
    const res = NextResponse.redirect(loopback.toString(), 302)
    res.cookies.set(OAUTH_STATE_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
    res.cookies.set(DESKTOP_HANDOFF_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
    return res
  }

  const { token, expiresAt } = await createSession(user.id)
  const target = new URL(externalUrl(req, '/'))
  // never land on a stale authError from a previous attempt
  target.search = ''
  // The token rides in the URL fragment as well: browsers that block
  // third-party cookies never store the session cookie, so the client
  // consumes #session=... and mirrors it into localStorage instead.
  target.hash = `session=${token}`
  const res = NextResponse.redirect(target.toString())
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt))
  res.cookies.set(OAUTH_STATE_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
