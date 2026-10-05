import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { destroySession, ORIGIN_BLOCKED_MSG, originOk, SESSION_COOKIE } from '@/lib/auth'

export async function POST(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: ORIGIN_BLOCKED_MSG }, { status: 403 })
  // Destroy whichever credential is present: cookie and/or bearer token.
  const auth = req.headers.get('authorization')
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null
  const store = await cookies()
  const cookieToken = store.get(SESSION_COOKIE)?.value
  if (bearer) await destroySession(bearer)
  if (cookieToken && cookieToken !== bearer) await destroySession(cookieToken)
  const res = NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
