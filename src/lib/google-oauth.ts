// Server-side Google OAuth 2.0 (authorization code flow). Credentials come
// from the environment; without them the flow reports itself as not
// configured and the UI falls back to email sign-in gracefully.
import 'server-only'
import { randomBytes, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

export const OAUTH_STATE_COOKIE = 'chessx_oauth_state'
const STATE_TTL_MS = 10 * 60_000

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

export function newState(): { value: string; maxAge: number } {
  return { value: randomBytes(32).toString('base64url'), maxAge: STATE_TTL_MS / 1000 }
}

export function stateMatches(sent: string | null, expected: string | undefined): boolean {
  if (!sent || !expected) return false
  const a = Buffer.from(sent)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * The URL Google must redirect back to has to be the one the player's
 * browser actually sees, so prefer the client-visible host over the
 * internal one. GOOGLE_REDIRECT_URI overrides everything for deployments
 * that need a fixed registered URI.
 */
export function externalUrl(req: NextRequest, path: string): string {
  if (process.env.GOOGLE_REDIRECT_URI && path === '/api/auth/google/callback') {
    return process.env.GOOGLE_REDIRECT_URI
  }
  const origin = req.headers.get('origin')
  if (origin) {
    try {
      return new URL(path, origin).toString()
    } catch {
      // fall through to forwarded headers
    }
  }
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'http'
  const host =
    req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    req.headers.get('host') ||
    'localhost:3000'
  return `${proto}://${host}${path}`
}

export function googleAuthUrl(req: NextRequest, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: externalUrl(req, '/api/auth/google/callback'),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // hint the account chooser toward consumer Gmail accounts; the callback
    // still verifies the email domain itself
    hd: 'gmail.com',
    prompt: 'select_account',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export interface GoogleProfile {
  sub: string
  email: string
  verified: boolean
}

/** Exchange the authorization code, then read the profile over TLS. */
export async function exchangeCodeForProfile(
  req: NextRequest,
  code: string,
): Promise<GoogleProfile | null> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: externalUrl(req, '/api/auth/google/callback'),
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
  })
  if (!tokenRes.ok) return null
  const tokens = (await tokenRes.json().catch(() => null)) as { access_token?: string } | null
  if (!tokens?.access_token) return null

  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    cache: 'no-store',
  })
  if (!infoRes.ok) return null
  const info = (await infoRes.json().catch(() => null)) as
    | { sub?: string; email?: string; email_verified?: boolean }
    | null
  if (!info?.sub || !info.email) return null
  return { sub: info.sub, email: info.email.toLowerCase(), verified: info.email_verified !== false }
}
