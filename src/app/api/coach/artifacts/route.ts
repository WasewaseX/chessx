// The coach's generated-material shelf: list, inspect, remove.
//
// Every row is retro-audited before it is served (see artifact-audit.ts).
// Artifacts stored before the strict truth checks existed cannot render to a
// student: a title that lies about the line, a fragment that stops early, an
// illegal replay or an unanswerable quiz is retired on the spot, so the
// shelf self-heals the moment it is read.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { artifactFromRow, stripUnsolved } from '@/lib/coach-artifacts'
import { auditArtifact } from '@/lib/server/artifact-audit'

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) return NextResponse.json({ artifacts: [] })

  // Single-card fetch: the card pulls its own full copy the moment it is
  // solved, so the real headline can arrive for the reveal. Unsolved cards
  // still go out through the spoiler strip below.
  const singleId = req.nextUrl.searchParams.get('id') ?? ''
  if (singleId) {
    const row = await db.coachArtifact.findFirst({ where: { id: singleId, profileId: profile.id } })
    if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json({ artifact: stripUnsolved(artifactFromRow(row as unknown as Record<string, unknown>)) })
  }

  const limitRaw = Number(req.nextUrl.searchParams.get('limit') ?? 24)
  const limit = Math.min(60, Math.max(1, Math.round(Number.isFinite(limitRaw) ? limitRaw : 24)))
  const rows = await db.coachArtifact.findMany({
    where: { profileId: profile.id },
    orderBy: { createdAt: 'desc' },
    take: limit * 2, // headroom, so the shelf stays full after retiring stale rows
  })
  const stale: string[] = []
  const clean: Record<string, unknown>[] = []
  for (const row of rows) {
    const verdict = auditArtifact(artifactFromRow(row as unknown as Record<string, unknown>))
    if (verdict.ok) {
      clean.push(row as unknown as Record<string, unknown>)
    } else {
      stale.push(row.id)
      console.log(`[artifact-audit] retiring ${row.kind} "${String(row.title).slice(0, 60)}": ${verdict.reason}`)
    }
    if (clean.length >= limit) break
  }
  // Retire once, permanently: an audited-off card never comes back.
  if (stale.length) {
    await db.coachArtifact.deleteMany({ where: { id: { in: stale }, profileId: profile.id } }).catch(() => {})
  }
  // Spoiler guard at the boundary: an unsolved puzzle or drill ships a
  // neutral name and no hint. The audit above already ran on the real rows.
  return NextResponse.json({ artifacts: clean.slice(0, limit).map((r) => stripUnsolved(artifactFromRow(r))) })
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
