'use client'
import { readJson } from '@/lib/api-client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type FlashMark } from '@/components/chess/board'
import { PUZZLES, PUZZLE_THEMES } from '@/content/puzzles'
import type { Puzzle } from '@/content/schema'
import { useApp, type ProfileData } from '@/lib/store'
import { engine } from '@/lib/chess/engine-client'
import { playSound } from '@/lib/chess/sounds'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RushPanel } from '@/components/views/rush-view'
import { cn } from '@/lib/utils'
import { Flame, Lightbulb, RotateCcw, CalendarDays, Loader2, Trophy, Repeat2 } from 'lucide-react'

type Phase = 'loading' | 'solving' | 'solved' | 'failed'
type PuzzleTab = 'rated' | 'daily' | 'rush'

interface PuzzleState {
  puzzle: Puzzle
  dayKey?: string
  seriesNumber?: number
  daily?: boolean
}

export function PuzzlesView() {
  const { profile, setProfile, pendingReview, setPendingReview } = useApp()
  const [tab, setTab] = useState<PuzzleTab>('rated')
  const [state, setState] = useState<PuzzleState | null>(null)
  const [reviewItemId, setReviewItemId] = useState<string | null>(null)
  const [graded, setGraded] = useState<{ intervalDays: number } | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [fen, setFen] = useState('')
  const [line, setLine] = useState<string[]>([])
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [hintShown, setHintShown] = useState(false)
  const [ratingDelta, setRatingDelta] = useState<number | null>(null)
  const [diverged, setDiverged] = useState(false)
  const [showSolution, setShowSolution] = useState(false)
  const [solutionPly, setSolutionPly] = useState(0)
  const [attempts, setAttempts] = useState(0)
  const [guide, setGuide] = useState<string | null>(null)
  const [flashes, setFlashes] = useState<FlashMark[]>([])
  const gameRef = useRef(new Chess())
  const busyRef = useRef(false)
  const reviewLoadRef = useRef(false)
  const soundEnabled = profile?.soundEnabled ?? true

  // Theme practice filter. Kept in component state on purpose: persisting it
  // would need a new profile field and profile API changes, which are outside
  // this feature's scope.
  const [themeFilter, setThemeFilter] = useState<string | null>(null)
  // Real per-theme counts from PuzzleAttempt rows, fetched and refetched after
  // every attempt. Nothing seeded.
  const [themeStats, setThemeStats] = useState<Record<string, { attempts: number; solved: number }> | null>(null)

  const refreshThemeStats = useCallback(() => {
    fetch('/api/puzzles/theme-stats')
      .then((r) => readJson<unknown>(r))
      .then((d) => {
        if (d && d.themes) setThemeStats(d.themes)
      })
      .catch(() => {
        /* stats are a nicety, the practice flow works without them */
      })
  }, [])

  useEffect(() => {
    refreshThemeStats()
  }, [refreshThemeStats])

  // Chips: All plus the themes that actually exist in the pool, with real counts.
  const themeOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of PUZZLES) {
      for (const t of p.themes) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    const ordered = Object.keys(PUZZLE_THEMES).filter((t) => counts.has(t))
    const extras = [...counts.keys()].filter((t) => !PUZZLE_THEMES[t]).sort()
    return [...ordered, ...extras].map((t) => ({
      key: t,
      label: PUZZLE_THEMES[t] ?? t,
      count: counts.get(t) ?? 0,
    }))
  }, [])

  const flash = useCallback((marks: FlashMark[]) => {
    setFlashes(marks)
    setTimeout(() => setFlashes((cur) => (cur === marks ? [] : cur)), 2900)
  }, [])

  const loadRated = useCallback(() => {
    if (!profile) return
    const target = profile.puzzleRating ?? 800
    // theme practice stays inside the chosen theme, otherwise the whole pool
    const themed = themeFilter ? PUZZLES.filter((p) => p.themes.includes(themeFilter)) : PUZZLES
    // pick a random puzzle among the closest to the target rating, avoiding the current one
    const pool = [...themed].sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target))
    const candidates = pool.slice(0, Math.min(5, pool.length)).filter((p) => p.id !== state?.puzzle.id)
    const choices = candidates.length ? candidates : pool.slice(0, 1)
    const best = choices[Math.floor(Math.random() * choices.length)]
    setState({ puzzle: best })
    startPuzzle(best)
  }, [profile, state?.puzzle.id, themeFilter])

  const loadDaily = useCallback(async () => {
    const dayKey = new Date().toLocaleDateString('sv-SE')
    try {
      const res = await fetch(`/api/puzzles/daily?day=${dayKey}`)
      const d = await readJson<{ puzzle?: Puzzle; seriesNumber?: number }>(res)
      if (d.puzzle) {
        setState({ puzzle: d.puzzle, dayKey, seriesNumber: d.seriesNumber, daily: true })
        startPuzzle(d.puzzle)
      }
    } catch {
      setPhase('failed')
    }
  }, [])

  function startPuzzle(p: Puzzle) {
    gameRef.current = new Chess(p.fen)
    setFen(p.fen)
    setLine([])
    setLastMove(null)
    setPhase('solving')
    setHintShown(false)
    setRatingDelta(null)
    setDiverged(false)
    setShowSolution(false)
    setSolutionPly(0)
    setAttempts(0)
    setGuide(null)
    setGraded(null)
    setFlashes([])
    busyRef.current = false
  }

  useEffect(() => {
    // Launching a spaced-review puzzle from the Review view.
    if (profile && pendingReview?.kind === 'puzzle') {
      const p = PUZZLES.find((x) => x.id === pendingReview.refId)
      setPendingReview(null)
      if (p) {
        reviewLoadRef.current = true
        setTab('rated')
        setReviewItemId(pendingReview.itemId)
        setState({ puzzle: p })
        startPuzzle(p)
      }
    }
  }, [profile, pendingReview, setPendingReview])

  useEffect(() => {
    if (reviewLoadRef.current) return
    if (tab === 'rush') return
    if (profile && !state) {
      if (tab === 'rated') loadRated()
      else void loadDaily()
    }
  }, [profile, state, tab, loadRated, loadDaily])

  useEffect(() => {
    if (tab === 'rush') return
    if (state) {
      if (tab === 'rated' && !state.daily) loadRated()
      else if (tab === 'daily' && !state.daily) void loadDaily()
      else if (tab === 'rated' && state.daily) loadRated()
      else if (tab === 'daily' && state.daily && state.dayKey !== new Date().toLocaleDateString('sv-SE')) void loadDaily()
    }
  }, [tab])

  // Picking a theme chip loads a new puzzle from that theme right away.
  const themeLoadRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (tab !== 'rated' || !profile) return
    if (themeLoadRef.current === undefined) {
      themeLoadRef.current = themeFilter // first mount: the normal load already ran
      return
    }
    if (themeLoadRef.current === themeFilter) return
    themeLoadRef.current = themeFilter
    loadRated()
  }, [themeFilter, tab, profile, loadRated])

  const game = useMemo(() => {
    try {
      return new Chess(fen)
    } catch {
      return new Chess()
    }
  }, [fen])
  const solverSide = useMemo(() => (state ? new Chess(state.puzzle.fen).turn() : 'w'), [state])
  const checkSquare = useMemo(() => {
    if (!game.isCheck()) return null
    return game.board().flat().find((s) => s && s.type === 'k' && s.color === game.turn())?.square ?? null
  }, [game])

  const materialBalance = useCallback((g: Chess) => {
    const vals: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 }
    let bal = 0
    for (const row of g.board()) {
      for (const sq of row) {
        if (!sq || sq.type === 'k') continue
        bal += sq.color === solverSide ? vals[sq.type] : -vals[sq.type]
      }
    }
    return bal
  }, [solverSide])

  const record = useCallback(
    async (solved: boolean) => {
      if (!state) return
      try {
        const isReview = Boolean(reviewItemId)
        const res = await fetch('/api/puzzles/attempt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            puzzleId: state.puzzle.id,
            kind: isReview ? 'review' : state.daily ? 'daily' : 'rated',
            solved,
            puzzleRating: state.puzzle.rating,
            dayKey: state.dayKey,
            reviewItemId,
          }),
        })
        const d = await readJson<{ profile?: ProfileData; ratingDelta?: number | null; graded?: { intervalDays?: number } | null }>(res)
        if (d.profile) setProfile(d.profile)
        setRatingDelta(d.ratingDelta ?? null)
        if (isReview) {
          setReviewItemId(null)
          if (d.graded?.intervalDays != null) setGraded({ intervalDays: d.graded.intervalDays })
        }
        refreshThemeStats() // per-theme counters only move from real attempts
      } catch {
        /* offline attempt, ignore */
      }
    },
    [state, setProfile, reviewItemId, refreshThemeStats],
  )

  const engineReply = useCallback(
    async (afterUserMove: boolean) => {
      const g = gameRef.current
      if (g.isGameOver()) return
      busyRef.current = true
      try {
        const { uci } = await engine.bestMove({ fen: g.fen(), skill: 20, depth: 14 })
        if (uci && uci.length >= 4) {
          const mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined })
          if (mv) {
            setFen(g.fen())
            setLine((l) => [...l, mv.san])
            setLastMove({ from: mv.from, to: mv.to })
            playSound(mv.captured ? 'capture' : 'move', soundEnabled)
          }
        }
      } finally {
        busyRef.current = false
      }
      void afterUserMove
    },
    [soundEnabled],
  )

  const judgeEnd = useCallback(
    (g: Chess): 'solved' | null => {
      if (g.isCheckmate() && g.turn() !== solverSide) return 'solved'
      if (g.isGameOver()) return null // draw/stalemate, not the goal
      return null
    },
    [solverSide],
  )

  const onMove = useCallback(
    async (from: Square, to: Square, promotion?: string) => {
      if (phase !== 'solving' || busyRef.current || !state) return
      const g = gameRef.current
      let mv
      try {
        mv = g.move({ from, to, promotion: promotion ?? undefined })
      } catch {
        return
      }
      if (!mv) return

      const expected = state.puzzle.solution.split(' ').filter(Boolean)
      const plyIdx = line.length
      const expectedSan = expected[plyIdx]?.replace(/[+#]/g, '')
      const sanNorm = mv.san.replace(/[+#]/g, '')
      const matchesScript = !diverged && sanNorm === expectedSan

      if (!matchesScript) {
        // also accept the engine's best move in this position (alternative wins)
        const { uci } = await engine.bestMove({ fen: g.fen(), skill: 20, depth: 16 })
        const bestNorm = uci.slice(0, 2) + uci.slice(2, 4) + (uci.slice(4, 5) || '')
        const moveNorm = mv.from + mv.to + (mv.promotion ?? '')
        if (bestNorm !== moveNorm) {
          // a miss, not a failure: take the move back and guide toward the idea
          g.undo()
          setFen(g.fen())
          playSound('wrong', soundEnabled)
          const n = attempts + 1
          setAttempts(n)
          if (n === 1) {
            setGuide('Not the strongest move. Take it back and scan every check, capture and threat once more.')
          } else if (n === 2) {
            setGuide('The piece that moves is glowing. Find its most damaging square.')
            try {
              const probe = new Chess(g.fen())
              const next = probe.move(expected[plyIdx])
              if (next) flash([{ square: next.from, color: 'gold' }])
            } catch {
              /* validated content */
            }
          } else {
            setGuide('Watch how the line works. Then take the next one with fresh eyes.')
            void record(false)
            playSolution()
          }
          return
        }
        if (sanNorm !== expectedSan) setDiverged(true)
      }

      setFen(g.fen())
      setLine((l) => [...l, mv.san])
      setLastMove({ from: mv.from, to: mv.to })
      playSound(mv.captured ? 'capture' : 'move', soundEnabled)

      // mate delivered?
      if (g.isCheckmate()) {
        setPhase('solved')
        playSound('correct', soundEnabled)
        void record(true)
        return
      }
      // winningMaterial judged at end of scripted line or when material target hit
      const remainingScript = expected.length - (plyIdx + 1)
      if (state.puzzle.themes.includes('winningMaterial') && (remainingScript <= 0 || diverged)) {
        if (materialBalance(g) >= 2) {
          setPhase('solved')
          playSound('correct', soundEnabled)
          void record(true)
          return
        }
      }
      if (remainingScript > 0) {
        // opponent reply, use the scripted one while on-script, engine otherwise
        if (!diverged) {
          setTimeout(() => {
            const gg = gameRef.current
            try {
              const rmv = gg.move(expected[plyIdx + 1])
              if (rmv) {
                setFen(gg.fen())
                setLine((l) => [...l, rmv.san])
                setLastMove({ from: rmv.from, to: rmv.to })
                playSound(rmv.captured ? 'capture' : 'move', soundEnabled)
              }
            } catch {
              void engineReply(true)
            }
          }, 500)
        } else {
          setTimeout(() => void engineReply(true), 500)
        }
      } else if (state.puzzle.themes.includes('mate')) {
        // scripted line ended but no mate, keep playing (should not happen post-validation)
        setTimeout(() => void engineReply(true), 500)
      } else {
        setPhase('solved')
        playSound('correct', soundEnabled)
        void record(true)
      }
    },
    [phase, state, line, diverged, attempts, record, engineReply, materialBalance, soundEnabled, flash],
  )

  function playSolution() {
    if (!state) return
    const expected = state.puzzle.solution.split(' ').filter(Boolean)
    setShowSolution(true)
    setPhase('failed')
    const g = gameRef.current
    // replay from scratch
    gameRef.current = new Chess(state.puzzle.fen)
    let i = 0
    const tick = () => {
      if (i >= expected.length) return
      try {
        const mv = gameRef.current.move(expected[i])
        if (mv) {
          setFen(gameRef.current.fen())
          setLastMove({ from: mv.from, to: mv.to })
          setSolutionPly(i + 1)
          playSound(mv.captured ? 'capture' : 'move', soundEnabled)
        }
      } catch {
        return
      }
      i++
      setTimeout(tick, 700)
    }
    void g
    setTimeout(tick, 300)
  }

  const puzzle = state?.puzzle

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold">Puzzles</h1>
          <div className="text-sm text-muted-foreground">
            Rating: {profile?.puzzleRating ?? '-'} · Streak: {profile?.puzzleStreak ?? 0} · Best: {profile?.bestPuzzleStreak ?? 0}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as PuzzleTab)}>
            <TabsList>
              <TabsTrigger value="rated">Rated</TabsTrigger>
              <TabsTrigger value="daily">Daily</TabsTrigger>
              <TabsTrigger value="rush">Rush</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {tab === 'rated' && (
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Practice a puzzle theme">
            <button
              type="button"
              onClick={() => setThemeFilter(null)}
              aria-pressed={themeFilter === null}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold transition active:scale-95',
                themeFilter === null
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              All <span className="ml-0.5 font-normal opacity-70">{PUZZLES.length}</span>
            </button>
            {themeOptions.map((t) => {
              const active = themeFilter === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setThemeFilter(active ? null : t.key)}
                  aria-pressed={active}
                  title={`${t.count} puzzle${t.count === 1 ? '' : 's'} tagged ${t.label}`}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-semibold transition active:scale-95',
                    active
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {t.label} <span className="ml-0.5 font-normal opacity-70">{t.count}</span>
                </button>
              )
            })}
          </div>
          {themeFilter && (
            <div className="mt-1.5 text-xs text-muted-foreground" aria-live="polite">
              {PUZZLE_THEMES[themeFilter] ?? themeFilter} practice ·{' '}
              {themeStats?.[themeFilter] && themeStats[themeFilter].attempts > 0 ? (
                <>
                  solved <span className="font-bold text-foreground">{themeStats[themeFilter].solved}</span> of{' '}
                  {themeStats[themeFilter].attempts} attempt{themeStats[themeFilter].attempts === 1 ? '' : 's'} on this theme
                </>
              ) : (
                'no attempts on this theme yet'
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'rush' && <RushPanel />}

      {tab !== 'rush' && phase === 'loading' && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Setting the board…
        </div>
      )}

      {puzzle && tab !== 'rush' && phase !== 'loading' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="mx-auto w-full max-w-[600px]">
            <ChessBoard
              fen={fen}
              orientation={solverSide}
              onMove={showSolution || phase !== 'solving' ? undefined : onMove}
              movableSide={showSolution || phase !== 'solving' ? undefined : solverSide}
              interactive={phase === 'solving' && !showSolution}
              lastMove={lastMove}
              checkSquare={checkSquare}
              flashes={flashes}
            />
          </div>

          <div className="flex flex-col gap-3">
            <div className="rounded-lg bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {reviewItemId ? (
                    <span className="inline-flex items-center gap-1 text-[#a3d160]">
                      <Repeat2 className="h-3.5 w-3.5" /> Spaced review
                    </span>
                  ) : state?.daily ? (
                    'Daily puzzle'
                  ) : themeFilter ? (
                    'Theme practice'
                  ) : (
                    'Rated puzzle'
                  )}
                </div>
                <div className="flex items-center gap-1 text-sm font-bold">
                  <Flame className="h-4 w-4 text-[#e6a82c]" /> {profile?.puzzleStreak ?? 0}
                </div>
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-2">
                <span className="font-display text-xl font-extrabold">{puzzle.title}</span>
                <span className="text-sm text-muted-foreground">{puzzle.rating}</span>
              </div>
              <div className="mt-1 text-sm">
                <span className={cn('font-bold', solverSide === 'w' ? 'text-foreground' : 'text-foreground')}>
                  {solverSide === 'w' ? 'White' : 'Black'} to play
                </span>
                <span className="text-muted-foreground"> · find the best move</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {puzzle.themes.map((t) => (
                  <span key={t} className="rounded bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                    {PUZZLE_THEMES[t] ?? t}
                  </span>
                ))}
              </div>
              {puzzle.source && <div className="mt-2 text-xs italic text-muted-foreground">from {puzzle.source}</div>}

              {phase === 'solving' && line.length > 0 && (
                <div className="mt-3 text-sm text-muted-foreground">
                  Line: <span className="font-mono font-semibold text-foreground">{line.join(' ')}</span>
                </div>
              )}
              {guide && (
                <div className="mt-3 rounded-md border border-[#e6a82c]/50 bg-[#e6a82c]/10 px-3 py-2 text-sm font-semibold text-foreground">
                  {guide}
                  {attempts > 0 && attempts < 3 && (
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">Attempt {attempts} of 3 before the line is shown.</span>
                  )}
                </div>
              )}
              {phase === 'solved' && (
                <div className="mt-3 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-semibold">
                  <Trophy className="mr-1 inline h-4 w-4 text-primary" /> Solved.
                  {graded
                    ? ` Back in ${graded.intervalDays === 1 ? 'a day' : `${graded.intervalDays} days`}.`
                    : ratingDelta != null && ` Rating ${ratingDelta >= 0 ? '+' : ''}${ratingDelta}.`}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {phase === 'solving' && !showSolution && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setHintShown(true)
                      try {
                        const expected = puzzle.solution.split(' ').filter(Boolean)
                        const probe = new Chess(gameRef.current.fen())
                        const next = probe.move(expected[line.length])
                        if (next) flash([{ square: next.from, color: 'gold' }])
                      } catch {
                        /* validated content */
                      }
                    }}
                  >
                    <Lightbulb className="h-4 w-4" /> Show me the piece
                  </Button>
                )}
                {(phase === 'failed' || attempts >= 2) && !showSolution && (
                  <Button variant="secondary" size="sm" onClick={playSolution}>
                    <Lightbulb className="h-4 w-4" /> Show solution
                  </Button>
                )}
                {(phase === 'solved' || phase === 'failed' || showSolution) && (
                  <Button
                    className="btn-hero"
                    size="sm"
                    onClick={() => {
                      if (tab === 'rated') loadRated()
                      else void loadDaily()
                    }}
                  >
                    <RotateCcw className="h-4 w-4" /> Next puzzle
                  </Button>
                )}
              </div>
              {graded && phase === 'failed' && (
                <p className="mt-2 text-xs text-muted-foreground">Still in the review queue, it comes back tomorrow.</p>
              )}
              {hintShown && phase === 'solving' && (
                <p className="mt-2 text-sm text-muted-foreground">The glowing piece is the one that moves. It is up to you to find where.</p>
              )}
              {showSolution && state && (
                <p className="mt-2 text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">Solution:</span> {state.puzzle.solution.split(' ').filter(Boolean).join(' ')}
                </p>
              )}
            </div>

            {state?.daily && (
              <div className="rounded-lg bg-card p-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  Daily for{' '}
                  {new Date(state.dayKey + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">Comes back tomorrow with a fresh position.</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
