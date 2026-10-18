import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { buildDnaReport } from '@/lib/server/chess-dna'

/**
 * Chess DNA report: five domain scores computed from the profile's own
 * analyzed games (see src/lib/server/chess-dna.ts for the exact formulas and
 * honesty rules). GET only — the report is a projection, nothing is written.
 * The percentile pool is cached in module memory for 5 minutes and the
 * computation itself is cheap (SAN-text scans of stored PGNs, no engine).
 */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })

  try {
    const report = await buildDnaReport(profile.id)
    return NextResponse.json(report, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    console.error('[dna] report failure', e)
    return NextResponse.json({ error: 'Could not compute your Chess DNA right now.' }, { status: 500 })
  }
}
