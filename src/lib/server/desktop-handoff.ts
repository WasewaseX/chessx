// Desktop Google sign-in handoff (RFC 8252 loopback, web side).
import 'server-only'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { hashToken } from '@/lib/auth'

/**
 * Desktop Google sign-in handoff (RFC 8252 loopback, web side).
 *
 * The desktop shell moves the Google OAuth leg into the player's system
 * browser and waits on a 127.0.0.1 listener. When the OAuth callback sees
 * the desktop cookie (set by /api/auth/google/start), it does not hand a
 * session cookie to the system browser — it mints one of these tokens,
 * redirects the browser to the shell's loopback URL with the raw token, and
 * the shell redeems it at /api/auth/desktop for a real session inside the
 * app window.
 *
 * Only the SHA-256 of the token is ever stored (same discipline as Session
 * and SocketTicket), so a token visible in a redirect URL or browser history
 * is worthless to anyone who cannot also read the database. Tokens are
 * single-use and expire in 5 minutes — one OAuth round trip.
 */

export const DESKTOP_HANDOFF_COOKIE = 'chessx_desktop_handoff'
export const DESKTOP_HANDOFF_TTL_MS = 5 * 60_000

export interface MintedDesktopToken {
  /** Raw token; travels once, in the loopback redirect URL. */
  token: string
  expiresAt: Date
}

export interface DesktopHandoffParams {
  port: number
  state: string
  next?: string
}

/** Redirect targets inside the app only: "/path", never "//host" or "/\host". */
export function isSiteRelativePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.startsWith('/\\')
  )
}

/** Create a single-use bridge token bound to a user id. */
export async function mintDesktopToken(userId: string): Promise<MintedDesktopToken> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + DESKTOP_HANDOFF_TTL_MS)
  await db.desktopHandoffToken.create({
    data: { tokenHash: hashToken(token), userId, expiresAt },
  })
  return { token, expiresAt }
}

/**
 * Atomically consume a handoff token: updateMany flips used=false → true, so
 * exactly one concurrent request can win; count !== 1 means the token was
 * already used, expired, or never existed — indistinguishable on purpose.
 */
export async function consumeDesktopToken(token: string): Promise<{ userId: string } | null> {
  const tokenHash = hashToken(token)
  const flipped = await db.desktopHandoffToken.updateMany({
    where: { tokenHash, used: false, expiresAt: { gt: new Date() } },
    data: { used: true },
  })
  if (flipped.count !== 1) return null
  const row = await db.desktopHandoffToken.findUnique({ where: { tokenHash } })
  return row ? { userId: row.userId } : null
}

// --- cookie payload helpers (used by the google start/callback routes) ----

const PORT_RE = /^\d{1,5}$/
const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/

/**
 * Validate ?desktop=1&desktop_port&desktop_state[&next] as sent by the
 * shell's /signin page. Returns null when the params are present but wrong
 * (the caller decides to error) and undefined when desktop mode was not
 * requested at all.
 */
export function parseDesktopParams(searchParams: URLSearchParams): DesktopHandoffParams | null | undefined {
  if (searchParams.get('desktop') !== '1') return undefined
  const portRaw = searchParams.get('desktop_port')
  const state = searchParams.get('desktop_state')
  if (!portRaw || !PORT_RE.test(portRaw)) return null
  const port = Number(portRaw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  if (!state || !STATE_RE.test(state)) return null
  const next = searchParams.get('next')
  if (next && !isSiteRelativePath(next)) return null
  return next ? { port, state, next } : { port, state }
}

export function encodeDesktopHandoffCookie(params: DesktopHandoffParams): string {
  return Buffer.from(JSON.stringify(params), 'utf8').toString('base64url')
}

export function decodeDesktopHandoffCookie(value: string | undefined): DesktopHandoffParams | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    const { port, state, next } = parsed as Record<string, unknown>
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null
    if (typeof state !== 'string' || !STATE_RE.test(state)) return null
    if (next !== undefined && !isSiteRelativePath(next)) return null
    return next ? { port, state, next } : { port, state }
  } catch {
    return null
  }
}
