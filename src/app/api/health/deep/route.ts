import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, rateLimit } from '@/lib/auth'
import { engineAvailable, engineIdentity } from '@/lib/server/engine'
import { bankStatus, kickBankBootstrap } from '@/lib/server/bank-bootstrap'
import { lichessAvailable, lichessCount, lichessThemeStats } from '@/lib/server/lichess-bank'
import { buildPlan } from '@/lib/server/daily-plan'
import { buildDnaReport } from '@/lib/server/chess-dna'
import { dayKeyLocal } from '@/lib/day'

/**
 * Deep health: the app diagnosing its own subsystems. Every check is a real
 * exercise of the real dependency (a prisma round-trip, a live engine probe,
 * an actual plan/DNA build for the caller's profile) — no mocks, no canned
 * "ok". Latency is measured per check so a slow-but-alive dependency is
 * visible. This is the ground truth the self-driving quality loop consumes;
 * it is also what the Settings status card renders.
 *
 * Signed-in only (it builds caller-scoped projections), strict rate limit,
 * no user data in the response — booleans, numbers and ms timings only.
 */

interface CheckResult {
  ok: boolean
  ms: number
  detail: string
}

async function timed(name: string, fn: () => Promise<string>): Promise<[string, CheckResult]> {
  const t0 = Date.now()
  try {
    const detail = await fn()
    return [name, { ok: true, ms: Date.now() - t0, detail }]
  } catch (e) {
    return [name, { ok: false, ms: Date.now() - t0, detail: e instanceof Error ? e.message.slice(0, 120) : 'failed' }]
  }
}

/** TCP-ish reachability probe with a hard timeout for the mini services. */
async function serviceUp(port: number): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 1500)
  try {
    // socket.io answers a plain GET with its engine.io handshake; any HTTP
    // response (even 404) proves the process is listening.
    await fetch(`http://127.0.0.1:${port}/`, { signal: ctrl.signal, cache: 'no-store' })
    return 'responding'
  } finally {
    clearTimeout(timer)
  }
}

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (!rateLimit(`health-deep:${user.id}`, 4, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 })
  }

  let profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) profile = await db.profile.create({ data: { userId: user.id, name: user.username } })

  const results = Object.fromEntries(
    await Promise.all([
      timed('database', async () => {
        await db.$queryRaw`SELECT 1`
        return 'round-trip ok'
      }),
      timed('engine', async () => {
        const up = await engineAvailable()
        if (!up) throw new Error('engine not responding')
        return (await engineIdentity()) ?? 'up'
      }),
      timed('puzzleBank', async () => {
        kickBankBootstrap()
        const s = bankStatus()
        if (!s.available) throw new Error(s.phase || 'bank unavailable')
        return `${lichessCount().toLocaleString('en-US')} puzzles on disk`
      }),
      timed('planBuilder', async () => {
        const plan = await buildPlan(profile.id, dayKeyLocal())
        return `built ${plan.doneCount}/${plan.target} slots${plan.focus ? ` · focus ${plan.focus.label}` : ''}`
      }),
      timed('dnaBuilder', async () => {
        const report = await buildDnaReport(profile.id)
        return report.ready ? `ready on ${report.games} games` : `building (${report.games}/3 games)`
      }),
      timed('gameService', async () => serviceUp(3030)),
      timed('mcpServer', async () => serviceUp(3031)),
      timed('puzzleThemes', async () => {
        if (!lichessAvailable()) throw new Error('bank not mounted yet')
        const themes = lichessThemeStats(5)
        return `${themes.length} theme rows indexed`
      }),
    ]),
  )

  const allOk = Object.values(results).every((r: CheckResult) => r.ok)
  return NextResponse.json(
    { ok: allOk, checks: results, at: new Date().toISOString() },
    { headers: { 'cache-control': 'no-store' } },
  )
}
