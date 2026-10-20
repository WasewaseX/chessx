import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  getSessionUser,
  hashPassword,
  ORIGIN_BLOCKED_MSG,
  originOk,
  rateLimit,
  verifyPassword,
} from '@/lib/auth'

// Change password for the signed-in account. Deliberately separate from the
// profile PATCH: a credential change re-verifies the current password and is
// rate-limited on its own, tighter budget.
const bodySchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(128),
})

const WRONG_CURRENT = 'Current password is incorrect'

export async function POST(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: ORIGIN_BLOCKED_MSG }, { status: 403 })

  const sessionUser = await getSessionUser()
  if (!sessionUser) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (!rateLimit(`password-change:${sessionUser.id}`, 5, 10 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Wait a few minutes.' }, { status: 429 })
  }
  // AuthUser is the slim public shape; load the row for the credential fields.
  const user = await db.user.findUnique({ where: { id: sessionUser.id } })
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid details' }, { status: 400 })
  }

  // Google-only accounts carry a random "oauth:<...>" hash — no way to verify
  // a current password, so say exactly that instead of failing mysteriously.
  if (user.passwordHash.startsWith('oauth:')) {
    return NextResponse.json(
      { error: 'This account signs in with Google, so it has no password to change here.' },
      { status: 409 },
    )
  }

  const ok = await verifyPassword(parsed.data.currentPassword, user.passwordHash)
  if (!ok) return NextResponse.json({ error: WRONG_CURRENT }, { status: 401 })

  // Same value as before is a no-op, not an error — but say so honestly.
  const same = await verifyPassword(parsed.data.newPassword, user.passwordHash)
  if (same) {
    return NextResponse.json({ error: 'That is already your current password.' }, { status: 400 })
  }

  const passwordHash = await hashPassword(parsed.data.newPassword)
  await db.user.update({ where: { id: user.id }, data: { passwordHash } })
  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
}
