'use client'
import { readJson } from '@/lib/api-client'

// The Study: the learn page. A chess workbook, not a game map. Course
// contents read like a printed book's table of contents (chapters, ledger
// rows, dotted leaders), the coach leaves a margin note, and one honest
// sentence up top says why this teaches better than watching videos.
// Progress loads exactly as before from /api/progress; only presentation.

import { useEffect, useMemo, useState } from 'react'
import { TIERS, findLevel } from '@/content/levels'
import type { Tier } from '@/content/schema'
import { useApp } from '@/lib/store'
import { coachMaybe } from '@/lib/coaches'
import { CharacterFace } from '@/components/chess/characters'
import { LessonContents } from '@/components/learn/lesson-contents'
import { cn } from '@/lib/utils'
import { Check, Loader2, Play } from 'lucide-react'

interface ProgressRow {
  lessonId: string
  completed: boolean
  stepsDone: number
  totalSteps: number
}

export function LessonsView() {
  const { navigate, profile } = useApp()
  const [progress, setProgress] = useState<ProgressRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/progress')
      .then((r) => readJson<unknown>(r))
      .then((d) => setProgress(d.progress ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const byId = useMemo(() => new Map(progress.map((p) => [p.lessonId, p])), [progress])
  const doneSet = useMemo(() => new Set(progress.filter((p) => p.completed).map((p) => p.lessonId)), [progress])
  const doneCount = progress.filter((p) => p.completed).length
  const totalLessons = TIERS.reduce((n, t) => n + t.levels.length, 0)
  const pct = totalLessons > 0 ? Math.round((doneCount / totalLessons) * 100) : 0

  // first uncompleted level is the recommended next one
  const nextId = useMemo(() => {
    for (const tier of TIERS) {
      for (const level of tier.levels) {
        if (!byId.get(level.id)?.completed) return level.id
      }
    }
    return null
  }, [byId])

  // plain value: the React Compiler memoizes it, manual useMemo upset the lint rule
  const nextRef = nextId ? (findLevel(nextId) ?? null) : null
  const coach = coachMaybe(profile?.coach)

  // bring the current row into view once progress is showing
  useEffect(() => {
    if (loading) return
    const t = window.setTimeout(() => {
      document.getElementById('current-lesson-node')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 80)
    return () => window.clearTimeout(t)
  }, [loading])

  function jumpToTier(id: string) {
    document.getElementById(`tier-anchor-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  const tierDone = (tier: Tier) => tier.levels.filter((l) => doneSet.has(l.id)).length

  return (
    <div className="w-full paper text-[#262421]">
      <div className="mx-auto w-full max-w-3xl px-4 pb-32 pt-6 sm:px-6 sm:pt-8">
        {/* page head: title, the honest difference, progress */}
        <header>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.24em] text-[#6f8f42]">ChessX course</p>
          <h1 className="mt-1 font-book text-3xl font-semibold text-[#262421] sm:text-4xl">The Study</h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[#262421]/70">
            Videos have you watch. Here you play: every lesson hands you the winning move, and you are the one who
            finds it on a real board. Make a mistake and it is caught on the spot: the move comes back, your coach
            explains the idea in one line, and you try again before you go on. Every level ends with a position you
            win yourself, so the last thing you practice is winning. Answer on the first try and your streak builds
            at the top of the screen. That is the whole difference: you do not watch someone else play well, you do
            it, at first badly, then on purpose. Every chapter opens at its first level, so if you already know how
            the pieces move, start at Beginner.
          </p>

          <div className="mt-5 flex items-center gap-3">
            <div
              className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-[#262421]/10"
              role="progressbar"
              aria-label="Course progress"
              aria-valuemin={0}
              aria-valuemax={totalLessons}
              aria-valuenow={doneCount}
            >
              <div className="h-full rounded-full bg-[#81b64c] transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
            <span className="shrink-0 text-xs font-extrabold tabular-nums text-[#262421]/55">
              {doneCount}/{totalLessons}
            </span>
          </div>

          {/* chapter quick links */}
          <nav aria-label="Jump to chapter" className="scroll-slim -mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1">
            {TIERS.map((tier) => {
              const d = tierDone(tier)
              return (
                <button
                  key={tier.id}
                  onClick={() => jumpToTier(tier.id)}
                  aria-label={`Jump to chapter ${tier.title}, ${d} of ${tier.levels.length} levels complete`}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-full border border-[#262421]/12 bg-[#fdfbf5] py-1.5 pl-1.5 pr-3 text-xs font-bold text-[#262421]/70 transition-colors hover:border-[#262421]/25 hover:text-[#262421]',
                    d === tier.levels.length && 'border-[#81b64c]/40 text-[#4a6b28]',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-extrabold text-[#262421]"
                    style={{ background: tier.color }}
                  >
                    {d === tier.levels.length ? <Check className="h-3 w-3" strokeWidth={3} /> : tier.n}
                  </span>
                  {tier.title}
                </button>
              )
            })}
          </nav>
        </header>

        {/* coach margin note */}
        <aside className="mt-6 flex items-start gap-3 rounded-2xl border border-[#262421]/10 bg-[#fdfbf5] p-4 shadow-sm">
          {coach ? (
            <CharacterFace
              id={coach.id}
              label={coach.name}
              className="h-12 w-12 shrink-0 rounded-full border-2 border-[#5d8534] shadow-sm"
            />
          ) : (
            <img
              src="/brand.svg"
              alt="ChessX"
              className="h-12 w-12 shrink-0 rounded-xl border-2 border-[#262421]/10 bg-[#f4f1e8] p-1"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#6f8f42]">
              {coach ? `${coach.name} · ${coach.title}` : 'Your coach'}
            </p>
            {loading ? (
              <p className="mt-0.5 text-sm text-[#8a8580]">Loading your progress.</p>
            ) : nextRef ? (
              <>
                <p className="mt-0.5 font-display text-sm font-extrabold text-[#262421]">{nextRef.level.title}</p>
                <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-[#57534e]">{nextRef.level.subtitle}</p>
              </>
            ) : (
              <>
                <p className="mt-0.5 font-display text-sm font-extrabold text-[#262421]">Every level complete</p>
                <p className="mt-0.5 text-xs leading-snug text-[#57534e]">
                  All {totalLessons} levels finished. Replay any row, or take your skills to Play.
                </p>
              </>
            )}
            {!coach && !loading && (
              <button
                type="button"
                onClick={() => navigate('coach')}
                className="mt-1.5 text-[11px] font-bold text-[#4a6b28] underline underline-offset-2 hover:text-[#3a5520]"
              >
                Choose a coach so every hint and correction is theirs.
              </button>
            )}
          </div>
        </aside>

        {/* the workbook contents */}
        <main className="mt-8">
          {loading ? (
            <div className="flex h-40 items-center justify-center" aria-label="Loading progress">
              <Loader2 className="h-6 w-6 animate-spin text-[#262421]/50" />
            </div>
          ) : (
            <LessonContents tiers={TIERS} done={doneSet} nextId={nextId} onSelect={(id) => navigate('lesson', id)} />
          )}
        </main>
      </div>

      {/* pinned primary action */}
      <div className="pointer-events-none fixed inset-x-0 bottom-16 z-30 px-4 lg:bottom-6">
        <div className="pointer-events-auto mx-auto w-full max-w-3xl">
          <button
            type="button"
            className="btn-hero h-12 w-full text-base shadow-[0_10px_30px_rgba(38,36,33,0.25)]"
            disabled={loading || !nextId}
            onClick={() => {
              if (nextId) navigate('lesson', nextId)
            }}
          >
            <Play className="h-5 w-5" />
            {nextId ? 'Continue: pick up where you left off' : 'Course complete'}
          </button>
        </div>
      </div>
    </div>
  )
}
