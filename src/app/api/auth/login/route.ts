import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  clientIp,
  createSession,
  isSupportedEmail,
  ORIGIN_BLOCKED_MSG,
  originOk,
  rateLimit,
  sessionCookieOptions,
  SESSION_COOKIE,
  UNSUPPORTED_ACCOUNT_MSG,
  verifyPassword,
} from '@/lib/auth'

const bodySchema = z.object({
  identity: z.string().trim().min(3).max(254), // email or username
  password: z.string().min(1).max(128),
})

export async function POST(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: ORIGIN_BLOCKED_MSG }, { status: 403 })
  const ip = clientIp(req)
  if (!rateLimit(`login:${ip}`, 10, 10 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Wait a few minutes.' }, { status: 429 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid details' }, { status: 400 })
  const identity = parsed.data.identity.toLowerCase()
  const password = parsed.data.password

  const user = await db.user.findFirst({
    where: { OR: [{ email: identity }, { usernameLower: identity }] },
  })
  // always run a compare so timing does not reveal whether the account exists
  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, '$2a$12$C6UzMDM.H6dfI/f/IKcEeO1UgWU2F2PfnNhJ4XOOby1tT6mZc1E7O')

  if (!user || !ok) {
    return NextResponse.json({ error: 'Incorrect email, username or password' }, { status: 401 })
  }

  // Accounts on unsupported providers cannot sign in, no matter what.
  // Admin accounts are exempt; the response never explains why.
  if (user.role !== 'admin' && !isSupportedEmail(user.email)) {
    return NextResponse.json({ error: UNSUPPORTED_ACCOUNT_MSG }, { status: 403 })
  }

  const { token, expiresAt } = await createSession(user.id)
  // The token also rides in the body: browsers that block third-party cookies
  // inside the preview iframe never store the cookie, so the client mirrors
  // the token into localStorage and sends it as an Authorization header.
  const res = NextResponse.json(
    { user: { id: user.id, email: user.email, username: user.username }, token, expiresAt: expiresAt.toISOString() },
    { headers: { 'cache-control': 'no-store' } },
  )
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt))
  return res
}
