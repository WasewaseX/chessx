import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { destroySession, ORIGIN_BLOCKED_MSG, originOk, SESSION_COOKIE } from '@/lib/auth'

export async function POST(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: ORIGIN_BLOCKED_MSG }, { status: 403 })
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (token) await destroySession(token)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
