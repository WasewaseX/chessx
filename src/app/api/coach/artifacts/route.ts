// The coach's generated-material shelf: list, inspect, remove.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { artifactFromRow } from '@/lib/coach-artifacts'

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) return NextResponse.json({ artifacts: [] })

  const limitRaw = Number(req.nextUrl.searchParams.get('limit') ?? 24)
  const limit = Math.min(60, Math.max(1, Math.round(Number.isFinite(limitRaw) ? limitRaw : 24)))
  const rows = await db.coachArtifact.findMany({
    where: { profileId: profile.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return NextResponse.json({ artifacts: rows.map((r) => artifactFromRow(r as unknown as Record<string, unknown>)) })
}

export async function DELETE(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) return NextResponse.json({ error: 'Nothing to remove.' }, { status: 404 })
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const deleted = await db.coachArtifact.deleteMany({ where: { id, profileId: profile.id } })
  if (deleted.count === 0) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
