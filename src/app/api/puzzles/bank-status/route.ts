// Honest, public health report for the puzzle bank. The bank is a large
// file that is not part of git; on a fresh environment the server installs
// it in the background (see lib/server/bank-bootstrap). This endpoint lets
// the UI (and a human) see exactly what that installer is doing — instead
// of a mysterious "214 puzzles" with no explanation.
import { NextResponse } from 'next/server'
import { bankStatus, kickBankBootstrap } from '@/lib/server/bank-bootstrap'
import { lichessCount } from '@/lib/server/lichess-bank'

export async function GET() {
  // Kicking here makes this endpoint self-starting even if instrumentation
  // was skipped (e.g. a runtime that does not run the register hook).
  kickBankBootstrap()
  const status = bankStatus()
  // The full COUNT is cached for a minute inside lichess-bank; only ask when
  // the file is actually present so a fresh boot answers instantly.
  const count = status.available ? lichessCount() : 0
  return NextResponse.json({
    ...status,
    count,
  })
}
