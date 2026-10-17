// Mission snapshot and cancel endpoint. The SSE stream is the live channel;
// this route is the pull fallback (and the cancel button's hand).
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { getTaskView, requestCancel } from '@/lib/server/agent/runtime'

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 404 })
  const taskId = req.nextUrl.searchParams.get('id') ?? ''
  const task = getTaskView(taskId, profile.id)
  if (!task) return NextResponse.json({ error: 'Mission not found' }, { status: 404 })
  return NextResponse.json({ task })
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  const taskId = String(body.id ?? '')
  const ok = requestCancel(taskId, profile.id)
  if (!ok) return NextResponse.json({ error: 'Nothing to cancel (already finished or unknown mission).' }, { status: 409 })
  return NextResponse.json({ cancelling: true })
}
