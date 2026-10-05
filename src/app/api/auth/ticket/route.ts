import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, originOk } from '@/lib/auth'

/**
 * Mints a single-use, 60-second ticket the websocket service can verify
 * against the shared DB. This is how the browser proves who it is to the
 * game service without exposing the session cookie to JavaScript.
 */
export async function POST(req: NextRequest) {
  if (!originOk(req)) return NextResponse.json({ error: 'Bad origin' }, { status: 403 })
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const ticket = await db.socketTicket.create({
    data: { userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
  })
  return NextResponse.json({ ticket: ticket.id })
}
