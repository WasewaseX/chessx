import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { destroySession, originOk, SESSION_COOKIE } from '@/lib/auth'

export async function POST(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: 'Bad origin' }, { status: 403 })
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (token) await destroySession(token)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
