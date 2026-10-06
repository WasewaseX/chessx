// Server-side auth: bcrypt credentials, hashed session tokens, rate limits,
// same-origin enforcement. The cookie carries a random 256-bit token; the DB
// stores only its SHA-256, so neither the DB nor the cookie alone is enough.
import 'server-only'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { cookies, headers } from 'next/headers'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

export const SESSION_COOKIE = 'chessx_session'
const SESSION_DAYS = 30
const BCRYPT_ROUNDS = 12

export interface AuthUser {
  id: string
  email: string
  username: string
  role: string
}

/**
 * Email policy: only established consumer mail providers backed by real
 * identity are accepted. The message intentionally does not explain why;
 * unsupported domains all get the same neutral response.
 */
const SUPPORTED_EMAIL_DOMAINS = new Set(['gmail.com'])
export const UNSUPPORTED_ACCOUNT_MSG = 'This account is not supported'
export const ORIGIN_BLOCKED_MSG = 'Security check failed. Refresh the page and try again.'

export function isSupportedEmail(email: string): boolean {
  const at = email.lastIndexOf('@')
  if (at < 1) return false
  return SUPPORTED_EMAIL_DOMAINS.has(email.slice(at + 1).toLowerCase())
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000)
  await db.session.create({ data: { id: hashToken(token), userId, expiresAt } })
  return { token, expiresAt }
}

export async function destroySession(token: string): Promise<void> {
  await db.session.deleteMany({ where: { id: hashToken(token) } })
}

/**
 * The preview panel embeds the app in a cross-site iframe, and some browsers
 * block third-party cookies there entirely, which makes SameSite=None useless.
 * Sessions therefore travel two ways: the httpOnly cookie when the browser
 * allows it, or an Authorization: Bearer header backed by localStorage when it
 * does not. Both carry the same raw token; the DB only stores its SHA-256.
 */
export async function requestSessionToken(): Promise<string | null> {
  const h = await headers()
  const auth = h.get('authorization')
  if (auth?.startsWith('Bearer ')) {
    const t = auth.slice(7).trim()
    if (t.length >= 20) return t
  }
  const store = await cookies()
  const t = store.get(SESSION_COOKIE)?.value
  return t && t.length >= 20 ? t : null
}

/** Resolve the signed-in user from the request, or null. */
export async function getSessionUser(): Promise<AuthUser | null> {
  const token = await requestSessionToken()
  if (!token) return null
  const session = await db.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: true },
  })
  if (!session) return null
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {})
    return null
  }
  return {
    id: session.user.id,
    email: session.user.email,
    username: session.user.username,
    role: session.user.role,
  }
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    // The app regularly runs inside the preview panel's cross-site iframe,
    // where SameSite=Lax cookies are stored but never sent back. SameSite=None
    // keeps the session alive there; Secure is required for None. Partitioned
    // opts the cookie into CHIPS so browsers that block third-party cookies
    // still store and send it inside the iframe. CSRF stays covered by the
    // originOk check on every state-changing route, and blocked-cookie clients
    // fall back to the Authorization header from src/lib/session.ts.
    secure: true,
    sameSite: 'none' as const,
    partitioned: true,
    path: '/',
    expires: expiresAt,
  }
}

// In-memory sliding-window rate limiter (per process, per ip+route).
const buckets = new Map<string, number[]>()

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs)
  if (hits.length >= limit) {
    buckets.set(key, hits)
    return false
  }
  hits.push(now)
  buckets.set(key, hits)
  if (buckets.size > 5000) {
    // keep the map from growing forever in the sandbox
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t > windowMs)) buckets.delete(k)
    }
  }
  return true
}

/**
 * Reject cross-site writes, tolerating the sandbox's proxy stack which may
 * rewrite Host on its way in.
 *
 * Primary signal is Sec-Fetch-Site: the browser sets it on every request it
 * makes and JavaScript cannot forge it, so "same-origin" vouches for us even
 * when the proxy chain mangles Host/Origin beyond recognition. When that
 * header is missing (old browser, curl) we fall back to comparing Origin
 * against Host and x-forwarded-host, with hostname-only tolerance for
 * rewritten ports.
 */
export function originOk(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site')
  if (site === 'same-origin' || site === 'same-site' || site === 'none') return true

  const origin = req.headers.get('origin')
  if (!origin) return true // server-to-server or curl, no cookie will match anyway
  try {
    const originHost = new URL(origin).host
    const candidates = [req.headers.get('host'), req.headers.get('x-forwarded-host')].flatMap(
      (h) => (h ? h.split(',').map((s) => s.trim()) : []),
    )
    for (const h of candidates) {
      if (!h) continue
      if (h === originHost) return true
      // hostname-only match tolerates a rewritten port
      if (h.split(':')[0] === originHost.split(':')[0]) return true
    }
    console.warn('[auth] request blocked by origin check', {
      origin,
      host: req.headers.get('host'),
      forwardedHost: req.headers.get('x-forwarded-host'),
      secFetchSite: site,
    })
    return false
  } catch {
    return false
  }
}

export function clientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'local'
  )
}

/** Every profile-backed route starts here. Returns user or null (401). */
export async function requireUser(): Promise<AuthUser | null> {
  return getSessionUser()
}
