import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  clientIp,
  createSession,
  hashPassword,
  isSupportedEmail,
  ORIGIN_BLOCKED_MSG,
  originOk,
  rateLimit,
  sessionCookieOptions,
  SESSION_COOKIE,
  UNSUPPORTED_ACCOUNT_MSG,
} from '@/lib/auth'
import { seedForSkill } from '@/lib/rating'

// Username rules, stated once and mirrored by the live hint in auth-view.tsx:
// 3-20 chars, starts/ends with a letter or number, and inside may use dots,
// hyphens and underscores. The message names what IS allowed (players do not
// parse regexes) and each failure gets its own line so the fix is obvious.
export const USERNAME_MSG =
  'Usernames can use letters, numbers, dots, hyphens and underscores — no spaces or other symbols'

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  username: z
    .string()
    .trim()
    .min(3, 'Username needs at least 3 characters')
    .max(20, 'Keep the username to 20 characters or fewer')
    .regex(/^[a-zA-Z0-9._-]+$/, USERNAME_MSG)
    .regex(/^[a-zA-Z0-9]/, 'Start the username with a letter or a number')
    .regex(/[a-zA-Z0-9]$/, 'End the username with a letter or a number'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
})

export async function POST(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: ORIGIN_BLOCKED_MSG }, { status: 403 })
  const ip = clientIp(req)
  if (!rateLimit(`signup:${ip}`, 6, 10 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Wait a few minutes.' }, { status: 429 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid details'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  const { email, username, password } = parsed.data

  // Neutral response for unsupported providers; no reason is disclosed.
  if (!isSupportedEmail(email)) {
    return NextResponse.json({ error: UNSUPPORTED_ACCOUNT_MSG }, { status: 400 })
  }

  const clash = await db.user.findFirst({
    where: { OR: [{ email }, { usernameLower: username.toLowerCase() }] },
    select: { email: true, usernameLower: true },
  })
  if (clash) {
    return NextResponse.json(
      { error: clash.email === email ? 'Email is already registered' : 'Username is taken' },
      { status: 409 },
    )
  }

  const passwordHash = await hashPassword(password)
  const user = await db.user.create({
    data: {
      email,
      username,
      usernameLower: username.toLowerCase(),
      passwordHash,
      profile: { create: { name: username } },
      ratings: {
        // The overall pool starts from the self-assessed skill seed, the same
        // number the profile route and puzzle ratings use. A hardcoded start
        // would put every newcomer at the same Elo regardless of level.
        create: { pool: 'overall', rating: seedForSkill('beginner'), rd: 350 },
      },
    },
  })

  const { token, expiresAt } = await createSession(user.id)
  // Token in the body as well, for browsers that block cookies in the preview
  // iframe; the client mirrors it into localStorage (see src/lib/session.ts).
  const res = NextResponse.json(
    { user: { id: user.id, email: user.email, username: user.username }, token, expiresAt: expiresAt.toISOString() },
    { headers: { 'cache-control': 'no-store' } },
  )
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt))
  return res
}
