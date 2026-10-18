import { NextRequest, NextResponse } from 'next/server'
import {
  clientIp,
  createSession,
  rateLimit,
  sessionCookieOptions,
  SESSION_COOKIE,
} from '@/lib/auth'
import { externalUrl } from '@/lib/google-oauth'
import { consumeDesktopToken, isSiteRelativePath } from '@/lib/server/desktop-handoff'

export const dynamic = 'force-dynamic'

// Redemption shape: the desktop shell sends the raw handoff token it caught
// on its loopback listener. The query key is named `token_hash` for symmetry
// with what the server stores — the value itself is the raw 256-bit token;
// only its SHA-256 lives in the database.
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/

const NO_STORE = { 'cache-control': 'no-store' } as const

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE })
}

/**
 * GET /api/auth/desktop?token_hash=<handoff token>&next=<site-relative path>
 *
 * Desktop-shell session redemption. Consumes the single-use token minted by
 * the Google callback, creates a normal session (same 30-day lifetime as the
 * login route), sets the SAME session cookie the login route sets, and
 * redirects into the app — all inside the shell's window, so the cookie
 * lands in the shell's persistent session and the player stays signed in
 * across restarts.
 */
export async function GET(req: NextRequest) {
  if (!rateLimit(`desktop-handoff:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json(
      { error: 'Too many requests. Wait a minute and start sign-in again.' },
      { status: 429, headers: NO_STORE },
    )
  }

  const token = req.nextUrl.searchParams.get('token_hash') ?? ''
  if (!TOKEN_RE.test(token)) {
    return badRequest('Invalid sign-in link. Start Google sign-in again from the app.')
  }

  const next = req.nextUrl.searchParams.get('next')
  if (next && !isSiteRelativePath(next)) {
    return badRequest('Invalid sign-in link. Start Google sign-in again from the app.')
  }

  const handoff = await consumeDesktopToken(token)
  if (!handoff) {
    // Used, expired or unknown all look identical here — the token is a
    // single 5-minute credential and this is its only consumer.
    return badRequest('This sign-in link can only be used once and has expired. Start Google sign-in again from the app.')
  }

  // Fresh session, standard duration, standard cookie mechanics — copied
  // from the working login route.
  const { token: sessionToken, expiresAt } = await createSession(handoff.userId)
  const target = new URL(externalUrl(req, next ?? '/'))
  const res = NextResponse.redirect(target.toString(), 302)
  res.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions(expiresAt))
  return res
}
