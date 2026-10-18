import { NextRequest, NextResponse } from 'next/server'
import {
  googleAuthUrl,
  googleConfigured,
  newState,
  OAUTH_STATE_COOKIE,
} from '@/lib/google-oauth'
import {
  DESKTOP_HANDOFF_COOKIE,
  DESKTOP_HANDOFF_TTL_MS,
  encodeDesktopHandoffCookie,
  parseDesktopParams,
} from '@/lib/server/desktop-handoff'

export const dynamic = 'force-dynamic'

/**
 * Returns the Google consent screen URL plus sets the CSRF state cookie.
 * The browser does the redirect itself so an unconfigured deployment can
 * answer with clean JSON instead of bouncing the player somewhere broken.
 *
 * Desktop handoff: the desktop shell's system browser reaches this route
 * with ?desktop=1&desktop_port=<port>&desktop_state=<state> (optionally
 * &next=<site-relative path>) appended by the /signin page. Those values
 * must survive the entire Google round trip, so they ride a short-lived
 * httpOnly cookie (same mechanics as the state cookie — None + Secure is
 * what survives the cross-site hop to accounts.google.com and back). The
 * callback consumes the cookie and, instead of setting a session cookie in
 * the system browser, mints a single-use token and bounces to the shell's
 * loopback listener. Without the desktop params this route behaves exactly
 * as it always has.
 */
export async function GET(req: NextRequest) {
  if (!googleConfigured()) {
    return NextResponse.json({ error: 'google-not-configured' }, { status: 501 })
  }

  // desktop=1 with broken values is refused loudly so the shell sees the
  // failure immediately instead of waiting out its 5-minute timeout.
  const desktopParams = parseDesktopParams(req.nextUrl.searchParams)
  if (desktopParams === null) {
    return NextResponse.json(
      { error: 'invalid-desktop-params' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    )
  }

  const state = newState()
  const res = NextResponse.json({ url: googleAuthUrl(req, state.value) })
  res.cookies.set(OAUTH_STATE_COOKIE, state.value, {
    httpOnly: true,
    // None + Secure so the cookie survives the iframe -> Google -> iframe round
    // trip; CSRF is covered by the state value itself.
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: state.maxAge,
  })

  if (desktopParams) {
    res.cookies.set(DESKTOP_HANDOFF_COOKIE, encodeDesktopHandoffCookie(desktopParams), {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: Math.ceil(DESKTOP_HANDOFF_TTL_MS / 1000),
    })
  }

  return res
}
