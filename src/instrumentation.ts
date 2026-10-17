// Next.js instrumentation hook: runs once when the server boots. The puzzle
// bank bootstrap is kicked here so a fresh environment starts healing itself
// immediately, before the first request arrives. It must never delay or break
// startup: any failure is swallowed, and the puzzle API routes kick the same
// bootstrap as a backstop anyway.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  try {
    const { kickBankBootstrap } = await import('@/lib/server/bank-bootstrap')
    kickBankBootstrap()
  } catch {
    // Never let bootstrap scheduling take the server down. API routes will
    // kick it again on the first puzzle request.
  }
}
