'use client'
import { useCallback, useEffect, useState } from 'react'
import { readJson } from '@/lib/api-client'
import { Activity, CheckCircle2, Loader2, RotateCcw, XCircle } from 'lucide-react'

/**
 * System status — the app diagnosing its own subsystems through
 * GET /api/health/deep (real round-trips, not canned "ok"s): database,
 * engine, puzzle bank, plan builder, DNA builder, both mini services.
 * This is the user-visible half of the self-driving quality loop; the
 * endpoint is the machine-readable half.
 */

interface CheckResult {
  ok: boolean
  ms: number
  detail: string
}

interface HealthReport {
  ok: boolean
  checks: Record<string, CheckResult>
  at: string
}

const CHECK_LABELS: Record<string, string> = {
  database: 'Database',
  engine: 'Chess engine',
  puzzleBank: 'Puzzle bank',
  planBuilder: "Today's plan builder",
  dnaBuilder: 'Chess DNA builder',
  gameService: 'Live games service',
  mcpServer: 'MCP server',
  puzzleThemes: 'Puzzle theme index',
}

export function SystemStatusCard() {
  const [report, setReport] = useState<HealthReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const execute = useCallback(() => {
    // All state changes happen inside the promise chain (async callbacks),
    // so calling this from an effect never synchronously sets state.
    fetch('/api/health/deep')
      .then((r) => readJson<HealthReport>(r))
      .then((d) => {
        if (d.checks) {
          setReport(d)
          setError(null)
        } else {
          setError(typeof d === 'object' && d !== null && 'error' in d ? String((d as { error: unknown }).error) : 'Check failed')
        }
      })
      .catch(() => setError('Could not run the system check.'))
      .finally(() => setLoading(false))
  }, [])

  function run() {
    // Click handler: synchronous state resets are fine here.
    setLoading(true)
    setError(null)
    execute()
  }

  useEffect(() => {
    // loading already starts true, so the first run needs no sync setState.
    execute()
  }, [execute])

  return (
    <section className="rounded-lg bg-card p-6 shadow-sm" aria-label="System status">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="font-display text-lg font-bold">System status</h2>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold text-primary transition-colors hover:bg-secondary disabled:opacity-60"
          aria-label="Run the system check again"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          {loading ? 'Checking…' : 'Run check'}
        </button>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>
      ) : loading && !report ? (
        <div className="mt-4 space-y-2" role="status" aria-label="Running system check">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-5 w-full animate-pulse rounded bg-secondary motion-reduce:animate-none" />
          ))}
        </div>
      ) : report ? (
        <>
          <div className="mt-3 grid gap-1.5" role="list">
            {Object.entries(report.checks).map(([key, r]) => (
              <div key={key} role="listitem" className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  {r.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-label="passing" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-label="failing" />
                  )}
                  <span className="truncate font-semibold">{CHECK_LABELS[key] ?? key}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {r.detail} · {r.ms} ms
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            {report.ok
              ? 'Every subsystem answered a real request just now — nothing here is canned.'
              : 'Something is degraded. The affected feature will say so where it is used; everything else keeps working.'}
          </p>
        </>
      ) : null}
    </section>
  )
}
