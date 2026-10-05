// Server-side auth: bcrypt credentials, hashed session tokens, rate limits,
// same-origin enforcement. The cookie carries a random 256-bit token; the DB
// stores only its SHA-256, so neither the DB nor the cookie alone is enough.
import 'server-only'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

export const SESSION_COOKIE = 'chessx_session'
const SESSION_DAYS = 30
const BCRYPT_ROUNDS = 12

export interface AuthUser {
  id: string
  email: string
  username: string
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

/** Resolve the signed-in user from the request cookies, or null. */
export async function getSessionUser(): Promise<AuthUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token || token.length < 20) return null
  const session = await db.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: true },
  })
  if (!session) return null
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {})
    return null
  }
  return { id: session.user.id, email: session.user.email, username: session.user.username }
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
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
 * Reject cross-site writes: browsers always attach Origin on POST.
 * The gateway may rewrite the Host header (it strips the port), so compare
 * hostnames and also accept a matching x-forwarded-host.
 */
export function originOk(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true // server-to-server or curl, no cookie will match anyway
  try {
    const originHost = new URL(origin).host
    const candidates = [req.headers.get('host'), req.headers.get('x-forwarded-host')]
    for (const h of candidates) {
      if (!h) continue
      if (h === originHost) return true
      // hostname-only match tolerates a rewritten port
      if (h.split(':')[0] === originHost.split(':')[0]) return true
    }
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
