'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { Dna, Loader2, X } from 'lucide-react'

/**
 * Shared Chess DNA report overlay. Opened by /?dna=<token> links; works for
 * signed-out visitors (it renders before the auth gate). Shows ONLY what the
 * public API returns — display name, archetype, domain scores with honest
 * sample sizes. No account data ever crosses this boundary.
 */

interface PublicDomain {
  key: string
  label: string
  score: number | null
  percentile: number | null
  sample: string
  note: string
}

interface PublicReport {
  name: string
  ready: boolean
  games: number
  archetype: { name: string; tagline: string } | null
  population: number
  computedAt: string
  domains: PublicDomain[]
}

export function SharedDnaOverlay({ token, onClose }: { token: string; onClose: () => void }) {
  const [report, setReport] = useState<PublicReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/dna/share?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as { report?: PublicReport; error?: string }
        if (!alive) return
        if (!r.ok || !d.report) {
          setError(d.error ?? 'This share link could not be loaded.')
          return
        }
        setReport(d.report)
      })
      .catch(() => {
        if (alive) setError('Network error. Try again.')
      })
    return () => {
      alive = false
    }
  }, [token])

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-sidebar text-sidebar-foreground">
      <div className="mx-auto w-full max-w-xl px-4 py-8">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/brand.svg" alt="ChessX" className="h-9 w-9 rounded-lg shadow" />
            <span className="font-display text-lg font-extrabold tracking-tight">ChessX</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close shared report"
            className="rounded-lg p-2 text-sidebar-foreground/70 transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-background p-6 text-foreground shadow-2xl sm:p-8">
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : !report ? (
            <div className="flex items-center gap-3 py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading the shared report…</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
                <Dna className="h-4 w-4 text-primary" />
                Shared Chess DNA report
              </div>
              <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight">
                {report.name}&rsquo;s Chess DNA
              </h1>
              {report.archetype && (
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="font-bold text-foreground">{report.archetype.name}</span>
                  {' — '}
                  {report.archetype.tagline}
                </p>
              )}

              {report.ready ? (
                <div className="mt-6 space-y-5">
                  {report.domains.map((d) => (
                    <div key={d.key}>
                      <div className="mb-1.5 flex items-baseline justify-between gap-2">
                        <span className="text-sm font-bold">{d.label}</span>
                        <span className="text-sm font-extrabold tabular-nums">
                          {d.score != null ? `${d.score}/100` : 'not enough data'}
                        </span>
                      </div>
                      <Progress value={d.score ?? 0} aria-label={`${d.label}: ${d.score ?? 'no score'} of 100`} />
                      <p className="mt-1 text-xs text-muted-foreground">
                        {d.sample}
                        {d.percentile != null ? ` · better than ${d.percentile}% of players here` : ''}
                      </p>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Percentiles compare against the {report.population} active players on this deployment —
                    a small pool says so instead of pretending to be global.
                  </p>
                </div>
              ) : (
                <p className="mt-6 text-sm text-muted-foreground">
                  This report is not ready yet — it needs at least 3 analyzed games.
                </p>
              )}

              <div className={cn('mt-8 rounded-xl bg-secondary p-4')}>
                <p className="text-sm font-semibold">Want your own Chess DNA?</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Import your chess.com or lichess games and ChessX measures the same seven domains
                  from your own play — free.
                </p>
                <Button className="btn-hero mt-3 h-10 w-full" onClick={onClose}>
                  Create your free report
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
