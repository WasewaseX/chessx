import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  clientIp,
  createSession,
  hashPassword,
  originOk,
  rateLimit,
  sessionCookieOptions,
  SESSION_COOKIE,
} from '@/lib/auth'

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  username: z
    .string()
    .trim()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/, 'Letters, numbers and underscore only'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
})

export async function POST(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: 'Bad origin' }, { status: 403 })
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
        create: [
          { pool: 'bullet', rating: 1000, rd: 350 },
          { pool: 'blitz', rating: 1000, rd: 350 },
          { pool: 'rapid', rating: 1000, rd: 350 },
        ],
      },
    },
  })

  const { token, expiresAt } = await createSession(user.id)
  const res = NextResponse.json({ user: { id: user.id, email: user.email, username: user.username } })
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt))
  return res
}
