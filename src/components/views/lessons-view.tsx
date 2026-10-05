'use client'

// Lessons view: the chess.com-style dark learn page. A winding Duolingo
// path in a tall panel (coach bubble on top, Next Lesson button pinned at
// the bottom), with an accessible flat list one toggle away. Progress
// loads exactly as before from /api/progress; only the presentation changed.

import { useEffect, useMemo, useRef, useState } from 'react'
import { TIERS, findLevel } from '@/content/levels'
import type { Tier } from '@/content/schema'
import { useApp } from '@/lib/store'
import { coachMaybe } from '@/lib/coaches'
import { CharacterFace } from '@/components/chess/characters'
import { LessonMap } from '@/components/learn/lesson-map'
import { cn } from '@/lib/utils'
import { Check, Loader2, List, Lock, Play } from 'lucide-react'

interface ProgressRow {
  lessonId: string
  completed: boolean
  stepsDone: number
  totalSteps: number
}

type NodeState = 'done' | 'current' | 'locked'

function stateFor(levelId: string, done: Set<string>, nextId: string | null): NodeState {
  if (done.has(levelId)) return 'done'
  if (levelId === nextId) return 'current'
  return 'locked'
}

export function LessonsView() {
  const { navigate, profile } = useApp()
  const [progress, setProgress] = useState<ProgressRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showList, setShowList] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    fetch('/api/progress')
      .then((r) => r.json())
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

  // bring the current node into view once progress (or the path) is showing
  useEffect(() => {
    if (loading || showList) return
    const t = window.setTimeout(() => {
      document.getElementById('current-lesson-node')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 80)
    return () => window.clearTimeout(t)
  }, [loading, showList])

  function jumpToTier(id: string) {
    document.getElementById(`tier-anchor-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  const tierDone = (tier: Tier) => tier.levels.filter((l) => doneSet.has(l.id)).length

  return (
    <div className="w-full bg-sidebar text-sidebar-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:flex-row lg:items-start lg:justify-center lg:gap-10">
        {/* left context column on desktop, page header on mobile */}
        <header className="lg:sticky lg:top-6 lg:w-72 lg:shrink-0">
          <h1 className="font-display text-3xl font-extrabold text-white">Lessons</h1>
          <p className="mt-2 text-sm leading-relaxed text-sidebar-foreground/70">
            {doneCount} of {totalLessons} levels complete. Six tiers, twenty levels each: every level is a short
            interactive workout, not a textbook.
          </p>
          <div
            className="mt-4 h-2 w-full max-w-xs overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-label="Course progress"
            aria-valuemin={0}
            aria-valuemax={totalLessons}
            aria-valuenow={doneCount}
          >
            <div className="h-full rounded-full bg-[#81b64c] transition-all" style={{ width: `${pct}%` }} />
          </div>

          <nav aria-label="Jump to tier" className="mt-6 hidden space-y-1 lg:block">
            {TIERS.map((tier) => {
              const d = tierDone(tier)
              const tp = Math.round((d / tier.levels.length) * 100)
              return (
                <button
                  key={tier.id}
                  onClick={() => jumpToTier(tier.id)}
                  aria-label={`Jump to the ${tier.title} tier, ${d} of ${tier.levels.length} levels complete`}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5"
                >
                  <span
                    className="grid h-6 w-6 shrink-0 place-items-center rounded text-[11px] font-extrabold text-white"
                    style={{ background: tier.color }}
                  >
                    {tier.n}
                  </span>
                  <span className="flex-1 truncate text-sm font-semibold text-sidebar-foreground/85">{tier.title}</span>
                  <span className="text-xs font-bold tabular-nums text-sidebar-foreground/50">
                    {d}/{tier.levels.length}
                  </span>
                  <span aria-hidden="true" className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-white/10">
                    <span className="block h-full rounded-full" style={{ width: `${tp}%`, background: tier.color }} />
                  </span>
                </button>
              )
            })}
          </nav>
        </header>

        {/* the path panel */}
        <section
          aria-label="Lesson path"
          className="mx-auto flex w-full max-w-[420px] flex-col overflow-hidden rounded-2xl border border-sidebar-border bg-black/20 shadow-2xl lg:h-[calc(100dvh-7rem)]"
        >
          {/* coach speech bubble */}
          <div className="flex items-start gap-3 p-4 pb-3">
            {coach ? (
              <CharacterFace
                id={coach.id}
                label={coach.name}
                className="h-14 w-14 shrink-0 rounded-full border-2 border-[#5d8534] shadow-md"
              />
            ) : (
              <img
                src="/brand.svg"
                alt="ChessX"
                className="h-14 w-14 shrink-0 rounded-xl border-2 border-sidebar-border bg-black/30 p-1"
              />
            )}
            <div className="relative min-w-0 flex-1 rounded-2xl bg-white px-4 py-3 text-[#312e2b] shadow-lg">
              <span aria-hidden="true" className="absolute -left-1 top-5 h-3 w-3 rotate-45 rounded-[2px] bg-white" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#6f8f42]">
                {coach ? `${coach.name} · ${coach.title}` : 'ChessX'}
              </p>
              {loading ? (
                <p className="mt-0.5 text-xs text-[#8a8580]">Loading your progress.</p>
              ) : nextRef ? (
                <>
                  <p className="mt-0.5 truncate font-display text-sm font-extrabold">{nextRef.level.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-[#57534e]">{nextRef.level.subtitle}</p>
                </>
              ) : (
                <>
                  <p className="mt-0.5 font-display text-sm font-extrabold">Every level complete</p>
                  <p className="mt-0.5 text-xs leading-snug text-[#57534e]">
                    All {totalLessons} levels finished. Replay any green node, or take your skills to Play.
                  </p>
                </>
              )}
              {!coach && !loading && (
                <p className="mt-1 text-[11px] font-semibold text-[#8a8580]">
                  Pick a coach in the Coach tab for guided lessons.
                </p>
              )}
            </div>
          </div>

          {/* scrolling path or list */}
          <div ref={scrollRef} className="scroll-slim lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {loading ? (
              <div className="flex h-40 items-center justify-center" aria-label="Loading progress">
                <Loader2 className="h-6 w-6 animate-spin text-sidebar-foreground/50" />
              </div>
            ) : showList ? (
              <LessonList tiers={TIERS} done={doneSet} nextId={nextId} onSelect={(id) => navigate('lesson', id)} />
            ) : (
              <LessonMap tiers={TIERS} done={doneSet} nextId={nextId} onSelect={(id) => navigate('lesson', id)} />
            )}
          </div>

          {/* pinned footer */}
          <div className="border-t border-sidebar-border/70 p-4">
            <button
              type="button"
              onClick={() => setShowList((v) => !v)}
              aria-expanded={showList}
              aria-controls="lessons-list"
              className="mb-2 flex w-full items-center justify-center gap-2 rounded-md py-2 text-xs font-bold uppercase tracking-wide text-sidebar-foreground/60 transition-colors hover:bg-white/5 hover:text-sidebar-foreground"
            >
              <List className="h-4 w-4" />
              {showList ? 'Show the path' : 'All lessons'}
            </button>
            <button
              type="button"
              className="btn-hero h-12 w-full text-base"
              disabled={loading || !nextId}
              onClick={() => {
                if (nextId) navigate('lesson', nextId)
              }}
            >
              <Play className="h-5 w-5" />
              {nextId ? 'Next Lesson' : 'Course complete'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

/* ---------- accessible flat list of every lesson ---------- */

function LessonList({
  tiers,
  done,
  nextId,
  onSelect,
}: {
  tiers: Tier[]
  done: Set<string>
  nextId: string | null
  onSelect: (levelId: string) => void
}) {
  return (
    <div id="lessons-list" className="space-y-4 px-3 pb-4 pt-1">
      {tiers.map((tier) => {
        const d = tier.levels.filter((l) => done.has(l.id)).length
        return (
          <div key={tier.id}>
            <div className="flex items-center gap-2 px-1 pb-1.5">
              <span
                className="grid h-5 w-5 shrink-0 place-items-center rounded text-[10px] font-extrabold text-white"
                style={{ background: tier.color }}
              >
                {tier.n}
              </span>
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-sidebar-foreground/80">{tier.title}</h3>
              <span className="text-[11px] font-bold tabular-nums text-sidebar-foreground/40">
                {d}/{tier.levels.length}
              </span>
              <span aria-hidden="true" className="h-px flex-1 bg-sidebar-border/70" />
            </div>
            <ul className="space-y-1">
              {tier.levels.map((level) => {
                const state = stateFor(level.id, done, nextId)
                const locked = state === 'locked'
                const row = (
                  <>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'grid h-6 w-6 shrink-0 place-items-center rounded-full',
                        state === 'done' && 'bg-[#81b64c]',
                        state === 'current' && 'bg-[#e8a33d]',
                        locked && 'bg-white/10',
                      )}
                    >
                      {state === 'done' && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                      {state === 'current' && <Play className="h-3 w-3 fill-white text-white" />}
                      {locked && <Lock className="h-3 w-3 text-white/40" />}
                    </span>
                    <span className="w-5 shrink-0 text-right text-xs font-bold tabular-nums text-sidebar-foreground/45">
                      {level.n}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate text-sm font-bold',
                          locked ? 'text-sidebar-foreground/50' : 'text-white',
                        )}
                      >
                        {level.title}
                      </span>
                      <span className="block truncate text-xs text-sidebar-foreground/45">{level.subtitle}</span>
                    </span>
                    <span className="shrink-0 text-[11px] font-semibold text-sidebar-foreground/40">
                      {level.minutes} min
                    </span>
                  </>
                )
                return (
                  <li key={level.id} className="list-none">
                    {locked ? (
                      <div
                        aria-disabled="true"
                        aria-label={`Level ${level.n}: ${level.title}. Locked. Finish the earlier levels first.`}
                        className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left opacity-70"
                      >
                        {row}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelect(level.id)}
                        aria-label={`Level ${level.n}: ${level.title}. ${state === 'done' ? 'Completed. Select to replay.' : 'Current lesson.'}`}
                        aria-current={state === 'current' ? 'step' : undefined}
                        className={cn(
                          'flex min-h-[44px] w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
                          state === 'current' && 'bg-[#e8a33d]/10 ring-1 ring-[#e8a33d]/30 hover:bg-[#e8a33d]/15',
                        )}
                      >
                        {row}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
