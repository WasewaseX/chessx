// Deployment freshness probe. The footer renders the build stamp from here so
// the owner can see AT A GLANCE which build a deployment is actually serving
// (the "still Oct 18" problem: without a visible stamp, a stale deployment is
// indistinguishable from a fresh one). In dev there is no build id, so the
// server boot time is reported instead — equally honest.
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const bootIso = (globalThis as { __chessxBootIso?: string }).__chessxBootIso ?? null
  return NextResponse.json(
    {
      buildId: process.env.NEXT_BUILD_ID ?? process.env.BUILD_ID ?? null,
      dev: process.env.NODE_ENV !== 'production',
      bootIso,
      serverTimeIso: new Date().toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
