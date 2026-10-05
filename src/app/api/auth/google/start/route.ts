import { NextRequest, NextResponse } from 'next/server'
import {
  googleAuthUrl,
  googleConfigured,
  newState,
  OAUTH_STATE_COOKIE,
} from '@/lib/google-oauth'

export const dynamic = 'force-dynamic'

/**
 * Returns the Google consent screen URL plus sets the CSRF state cookie.
 * The browser does the redirect itself so an unconfigured deployment can
 * answer with clean JSON instead of bouncing the player somewhere broken.
 */
export async function GET(req: NextRequest) {
  if (!googleConfigured()) {
    return NextResponse.json({ error: 'google-not-configured' }, { status: 501 })
  }
  const state = newState()
  const res = NextResponse.json({ url: googleAuthUrl(req, state.value) })
  res.cookies.set(OAUTH_STATE_COOKIE, state.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: state.maxAge,
  })
  return res
}
