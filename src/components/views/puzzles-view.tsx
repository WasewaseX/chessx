'use client'
import { readJson } from '@/lib/api-client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type FlashMark } from '@/components/chess/board'
import { PUZZLE_THEMES, humanizeTheme, type PublicPuzzle, type PuzzleStub } from '@/content/schema'
import { fetchPuzzleIndex, gradePuzzleMove, revealPuzzleAnswer, type MoveVerdict, type PuzzleGoal, type PuzzleMeta } from '@/lib/chess/solver'
import { useApp, type ProfileData } from '@/lib/store'
import { engine } from '@/lib/chess/engine-client'
import { PRESS_ENTER_CP, PRESS_HOLD_CP, PRESS_MAX_PLIES, solverPovCp } from '@/lib/chess/press'
import { playSound } from '@/lib/chess/sounds'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RushPanel } from '@/components/views/rush-view'
import { BattlePanel } from '@/components/views/battle-view'
import { VisionPanel } from '@/components/views/vision-view'
import { WoodpeckerPanel, PuzzleLeaderboard } from '@/components/views/woodpecker-view'
import { cn } from '@/lib/utils'
import { Flame, Lightbulb, RotateCcw, CalendarDays, Loader2, Trophy, Repeat2 } from 'lucide-react'

type Phase = 'loading' | 'solving' | 'converting' | 'solved' | 'failed'
type PuzzleTab = 'rated' | 'daily' | 'rush' | 'battle' | 'vision' | 'woodpecker'

const PUZZLE_TABS: PuzzleTab[] = ['rated', 'daily', 'rush', 'battle', 'vision', 'woodpecker']

interface PuzzleState {
  puzzle: PuzzleStub
  dayKey?: string
  seriesNumber?: number
  daily?: boolean
}

export function PuzzlesView() {
  const { profile, setProfile, pendingReview, setPendingReview } = useApp()
  // Deep links land here with a view arg in the hash (#/puzzles/woodpecker);
  // unknown or missing args open the rated tab as always.
  const viewArg = useApp((s) => s.view.lessonId)
  const [tab, setTab] = useState<PuzzleTab>(
    PUZZLE_TABS.includes(viewArg as PuzzleTab) ? (viewArg as PuzzleTab) : 'rated',
  )
  // Also honor a hash change that arrives while this view is already mounted.
  useEffect(() => {
    if (viewArg && PUZZLE_TABS.includes(viewArg as PuzzleTab)) setTab(viewArg as PuzzleTab)
  }, [viewArg])
  const [state, setState] = useState<PuzzleState | null>(null)
  const [reviewItemId, setReviewItemId] = useState<string | null>(null)
  const [graded, setGraded] = useState<{ intervalDays: number } | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [fen, setFen] = useState('')
  const [line, setLine] = useState<string[]>([])
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [hintShown, setHintShown] = useState(false)
  const [ratingDelta, setRatingDelta] = useState<number | null>(null)
  const [showSolution, setShowSolution] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const [guide, setGuide] = useState<string | null>(null)
  const [flashes, setFlashes] = useState<FlashMark[]>([])
  // Spoiler-safe solving state: the pool carries positions and ratings only,
  // `revealed` fills in title/themes/source (and the line) after the solve,
  // and `goalRef` says what the landed tactic should do next. None of that
  // crosses the wire before the solver earns it.
  const [pool, setPool] = useState<PublicPuzzle[]>([])
  const [revealed, setRevealed] = useState<(PuzzleMeta & { solution?: string }) | null>(null)
  const goalRef = useRef<PuzzleGoal>('other')
  const userMovesRef = useRef<string[]>([])
  const revealedOnceRef = useRef(false)
  const gameRef = useRef(new Chess())
  const busyRef = useRef(false)
  const reviewLoadRef = useRef(false)
  const recordedRef = useRef(false)
  const pressMissRef = useRef(0)
  const pressPliesRef = useRef(0)
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
      .then((r) => readJson<{ themes?: Record<string, { attempts: number; solved: number }> | null }>(r))
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

  // The sanitized pool: positions and ratings only. Solutions, titles and
  // sources stay on the server until the solver earns them.
  useEffect(() => {
    fetchPuzzleIndex()
      .then(setPool)
      .catch(() => {
        /* empty pool: the honest failure states below take over */
      })
  }, [])

  // Chips: All plus the themes that actually exist in the pool, with real counts.
  const themeOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of pool) {
      for (const t of p.themes) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    const ordered = Object.keys(PUZZLE_THEMES).filter((t) => counts.has(t))
    const extras = [...counts.keys()].filter((t) => !PUZZLE_THEMES[t]).sort()
    return [...ordered, ...extras].map((t) => ({
      key: t,
      label: humanizeTheme(t),
      count: counts.get(t) ?? 0,
    }))
  }, [pool])

  const flash = useCallback((marks: FlashMark[]) => {
    setFlashes(marks)
    setTimeout(() => setFlashes((cur) => (cur === marks ? [] : cur)), 2900)
  }, [])

  const loadRated = useCallback(() => {
    if (!profile || pool.length === 0) return
    const target = profile.puzzleRating ?? 800
    // theme practice stays inside the chosen theme, otherwise the whole pool
    const themed = themeFilter ? pool.filter((p) => p.themes.includes(themeFilter)) : pool
    if (themed.length === 0) {
      setPhase('failed')
      return
    }
    // pick a random puzzle among the closest to the target rating, avoiding the current one
    const ranked = [...themed].sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target))
    const candidates = ranked.slice(0, Math.min(5, ranked.length)).filter((p) => p.id !== state?.puzzle.id)
    const choices = candidates.length ? candidates : ranked.slice(0, 1)
    const best = choices[Math.floor(Math.random() * choices.length)]
    setState({ puzzle: best })
    startPuzzle(best)
  }, [profile, pool, state?.puzzle.id, themeFilter])

  const loadDaily = useCallback(async () => {
    const dayKey = new Date().toLocaleDateString('sv-SE')
    try {
      const res = await fetch(`/api/puzzles/daily?day=${dayKey}`)
      const d = await readJson<{ puzzle?: PuzzleStub; seriesNumber?: number }>(res)
      if (d.puzzle) {
        setState({ puzzle: d.puzzle, dayKey, seriesNumber: d.seriesNumber, daily: true })
        startPuzzle(d.puzzle)
      } else {
        // the endpoint answered but had nothing for today: an honest failure
        // beats a spinner that never ends
        setPhase('failed')
      }
    } catch {
      setPhase('failed')
    }
  }, [])

  function startPuzzle(p: PuzzleStub) {
    gameRef.current = new Chess(p.fen)
    setRevealed(null)
    goalRef.current = 'other'
    userMovesRef.current = []
    revealedOnceRef.current = false
    setFen(p.fen)
    setLine([])
    setLastMove(null)
    setPhase('solving')
    setHintShown(false)
    setRatingDelta(null)
    setShowSolution(false)
    setAttempts(0)
    setGuide(null)
    setGraded(null)
    setFlashes([])
    busyRef.current = false
    recordedRef.current = false
    pressMissRef.current = 0
    pressPliesRef.current = 0
  }

  useEffect(() => {
    // Launching a spaced-review puzzle from the Review view.
    if (profile && pendingReview?.kind === 'puzzle') {
      const p = pool.find((x) => x.id === pendingReview.refId)
      setPendingReview(null)
      if (p) {
        reviewLoadRef.current = true
        setTab('rated')
        setReviewItemId(pendingReview.itemId)
        setState({ puzzle: p })
        startPuzzle(p)
      }
    }
  }, [profile, pendingReview, setPendingReview, pool])

  useEffect(() => {
    if (reviewLoadRef.current) return
    if (tab === 'rush' || tab === 'battle' || tab === 'vision' || tab === 'woodpecker') return
    if (profile && !state && (tab !== 'rated' || pool.length > 0)) {
      if (tab === 'rated') loadRated()
      else void loadDaily()
    }
  }, [profile, state, tab, pool, loadRated, loadDaily])

  useEffect(() => {
    if (tab === 'rush' || tab === 'battle' || tab === 'vision' || tab === 'woodpecker') return
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

  // Weakest themes, ranked from the player's REAL solve record only. A theme
  // qualifies after at least 3 attempts (one fluke can't crown a weakness) and
  // shows as a one-click training chip. No attempts -> no strip, no guesses.
  const weakThemes = useMemo(() => {
    if (!themeStats) return []
    return Object.entries(themeStats)
      .filter(([, s]) => s.attempts >= 3 && s.solved < s.attempts)
      .map(([key, s]) => ({
        key,
        attempts: s.attempts,
        solved: s.solved,
        acc: Math.round((s.solved / s.attempts) * 100),
      }))
      .sort((a, b) => a.acc - b.acc)
      .slice(0, 4)
  }, [themeStats])

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


  const record = useCallback(
    async (solved: boolean) => {
      if (!state) return
      if (recordedRef.current) return
      recordedRef.current = true
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

  /** The full answer, fetched only when the finish has already been shown:
   * failed attempts and the explicit show-solution click. */
  const revealAnswer = useCallback(async () => {
    if (!state || revealedOnceRef.current) return
    revealedOnceRef.current = true
    try {
      const rev = await revealPuzzleAnswer(state.puzzle.id)
      setRevealed((r) => ({ ...(r ?? { title: '', themes: [] }), ...rev }))
    } catch {
      /* the board flow continues even if the reveal call fails */
    }
  }, [state])

  /** Shared conversion entry: the engine defends with best play and the
   * student keeps converting until the mate lands or the win is banked. */
  const enterConversion = useCallback(
    (g: Chess, solverToMove: boolean, text: string) => {
      setPhase('converting')
      pressPliesRef.current = 0
      pressMissRef.current = 0
      setGuide(text)
      if (!solverToMove) {
        setTimeout(() => {
          if (gameRef.current !== g) return
          void engineReply(true)
        }, 500)
      }
    },
    [engineReply],
  )

  /** The scripted tactic just landed. Decides what the puzzle does next:
   * mate already delivered, keep pressing a crushing win until the king
   * actually falls, or close quietly when the position is merely better.
   * The goal arrives from the grading server with the tactic — the client
   * never knows it in advance. Material wins do NOT close early: while the
   * engine still scores the position as crushing, the student keeps
   * converting — a puzzle runs to checkmate, not to the first capture. */
  const afterScript = useCallback(
    async (g: Chess, goal: PuzzleGoal) => {
      if (g.isCheckmate()) {
        setPhase('solved')
        playSound('correct', soundEnabled)
        void record(true)
        return
      }
      const solverToMove = g.turn() === solverSide
      const info = await engine.eval({ fen: g.fen(), depth: 14 })
      if (gameRef.current !== g) return
      const cp = solverPovCp(info, solverToMove)
      if (cp >= PRESS_ENTER_CP) {
        // The win is far from over: the puzzle keeps going, the engine
        // defends with best play, and the student must convert everything.
        enterConversion(
          g,
          solverToMove,
          goal === 'mate'
            ? 'The tactic landed. Do not stop: the engine defends, keep going until the mate.'
            : 'The tactic landed and the position is still crushing. Press the win all the way to the end.',
        )
        return
      }
      setPhase('solved')
      playSound('correct', soundEnabled)
      void record(true)
    },
    [solverSide, soundEnabled, record, enterConversion],
  )

  const onMove = useCallback(
    async (from: Square, to: Square, promotion?: string) => {
      if (busyRef.current || !state) return
      if (phase !== 'solving' && phase !== 'converting') return
      const g = gameRef.current

      // ---- converting phase: the engine defends, every move is judged ----
      if (phase === 'converting') {
        let cmv
        try {
          cmv = g.move({ from, to, promotion: promotion ?? undefined })
        } catch {
          return
        }
        if (!cmv) return
        setFen(g.fen())
        setLine((l) => [...l, cmv.san])
        busyRef.current = true
        try {
          const info = await engine.eval({ fen: g.fen(), depth: 14 })
          if (gameRef.current !== g) return
          const cp = solverPovCp(info, false) // defender to move now
          if (cp < PRESS_HOLD_CP) {
            g.undo()
            setFen(g.fen())
            setLine((l) => l.slice(0, -1))
            playSound('wrong', soundEnabled)
            pressMissRef.current += 1
            if (pressMissRef.current >= 4) {
              setGuide('The conversion keeps drifting. Watch the finish, then take the next one from the top.')
              setShowSolution(true)
              setPhase('failed')
              void revealAnswer()
              if (goalRef.current !== 'mate') void record(true) // the tactic itself was solved
              return
            }
            setGuide('That lets the win slip. Take it back: keep the pieces coordinated and the king safe.')
            return
          }
          setLastMove({ from: cmv.from, to: cmv.to })
          playSound(cmv.captured ? 'capture' : 'move', soundEnabled)
          if (g.isCheckmate()) {
            setPhase('solved')
            setGuide('Checkmate. The whole win is yours.')
            playSound('correct', soundEnabled)
            void record(true)
            return
          }
          if (g.isGameOver()) {
            // stalemate or a dead draw: the win slipped at the very end
            setShowSolution(true)
            setPhase('failed')
            setGuide('Stalemate: the king has no moves and no checks. The win slipped at the very end.')
            void revealAnswer()
            if (goalRef.current !== 'mate') void record(true) // the tactic itself was solved
            return
          }
          const nextPlies = pressPliesRef.current + 2
          pressPliesRef.current = nextPlies
          if (nextPlies >= PRESS_MAX_PLIES) {
            setPhase('solved')
            setGuide('Conversion complete: the advantage never came back for the other side.')
            playSound('correct', soundEnabled)
            void record(true)
            return
          }
          await engineReply(true)
        } finally {
          busyRef.current = false
        }
        return
      }

      // ---- solving phase: the scripted tactic, graded on the server ----
      busyRef.current = true
      try {
        let mv
        try {
          mv = g.move({ from, to, promotion: promotion ?? undefined })
        } catch {
          return
        }
        if (!mv) return

        const played = [...userMovesRef.current, mv.san]
        let verdict: MoveVerdict
        try {
          verdict = await gradePuzzleMove(state.puzzle.id, played)
        } catch {
          // grading unreachable: take the move back rather than guess
          g.undo()
          setGuide('The move checker is unreachable. Reconnect and play that move again.')
          return
        }
        if (gameRef.current !== g) return

        if (!verdict.correct) {
          // Alternative wins count: rewind, ask the engine about the position
          // the student actually faced, and accept its best move as well.
          g.undo()
          const { uci } = await engine.bestMove({ fen: g.fen(), skill: 20, depth: 16 })
          const bestNorm = uci.slice(0, 2) + uci.slice(2, 4) + (uci.slice(4, 5) || '')
          const moveNorm = mv.from + mv.to + (mv.promotion ?? '')
          if (bestNorm !== moveNorm) {
            // a miss, not a failure: take the move back and guide toward the idea
            setFen(g.fen())
            playSound('wrong', soundEnabled)
            const n = attempts + 1
            setAttempts(n)
            if (n === 1) {
              setGuide('Not the strongest move. Take it back and scan every check, capture and threat once more.')
            } else if (n === 2) {
              setGuide('The piece that moves is glowing. Find its most damaging square.')
              if (verdict.hintFrom) flash([{ square: verdict.hintFrom as Square, color: 'gold' }])
            } else {
              setGuide('Watch how the line works. Then take the next one with fresh eyes.')
              void record(false)
              void playSolution()
            }
            return
          }
          // the engine blesses this move: replay it for real, then judge the
          // position the same way a landed tactic is judged
          const again = g.move({ from, to, promotion: promotion ?? undefined })
          if (!again) return
          setFen(g.fen())
          setLine((l) => [...l, again.san])
          setLastMove({ from: again.from, to: again.to })
          playSound(again.captured ? 'capture' : 'move', soundEnabled)
          if (g.isCheckmate()) {
            setPhase('solved')
            playSound('correct', soundEnabled)
            void record(true)
            return
          }
          const solverToMove = g.turn() === solverSide
          const info = await engine.eval({ fen: g.fen(), depth: 14 })
          if (gameRef.current !== g) return
          const cp = solverPovCp(info, solverToMove)
          if (cp >= PRESS_ENTER_CP) {
            enterConversion(g, solverToMove, 'A different route to the same win. The engine defends — press it all the way home.')
            return
          }
          setPhase('solved')
          playSound('correct', soundEnabled)
          void record(true)
          return
        }

        // on script: bank the move and let the server steer the rest
        userMovesRef.current = played
        setFen(g.fen())
        setLine((l) => [...l, mv.san])
        setLastMove({ from: mv.from, to: mv.to })
        playSound(mv.captured ? 'capture' : 'move', soundEnabled)

        if (verdict.scriptDone) {
          // The scripted line ran out. A mate puzzle keeps going until the
          // king falls; a crushing win keeps going until it is converted;
          // anything quieter closes here, tactic complete. The goal comes
          // from the grading server, never from client-side content.
          goalRef.current = verdict.goal ?? 'other'
          if (verdict.meta) setRevealed(verdict.meta)
        }
        if (verdict.reply) {
          // opponent reply, scripted and served by the grading route. The
          // captured game instance guards against the reply landing on a
          // puzzle the user has already moved away from. When the script
          // ends on this reply, the landed-tactic decision runs right
          // after the reply lands on the board.
          const replySan = verdict.reply
          const doneNow = verdict.scriptDone
          setTimeout(() => {
            if (gameRef.current !== g) return
            const gg = gameRef.current
            let playedReply = false
            try {
              const rmv = gg.move(replySan)
              playedReply = Boolean(rmv)
              if (rmv) {
                setFen(gg.fen())
                setLine((l) => [...l, rmv.san])
                setLastMove({ from: rmv.from, to: rmv.to })
                playSound(rmv.captured ? 'capture' : 'move', soundEnabled)
              }
            } catch {
              /* fall through to the engine reply */
            }
            if (doneNow) {
              void afterScript(gg, goalRef.current)
            } else if (!playedReply) {
              void engineReply(true)
            }
          }, 500)
          return
        }
        if (verdict.scriptDone) {
          await afterScript(g, goalRef.current)
          return
        }
        // no scripted reply and the script continues: malformed content,
        // let the engine defend instead of stalling
        setTimeout(() => {
          if (gameRef.current !== g) return
          void engineReply(true)
        }, 500)
      } finally {
        busyRef.current = false
      }
    },
    [phase, state, attempts, record, engineReply, soundEnabled, flash, afterScript, enterConversion],
  )

  async function playSolution() {
    if (!state) return
    setShowSolution(true)
    setPhase('failed')
    revealedOnceRef.current = true
    // swap in a dead instance first so every pending reply timer bails
    gameRef.current = new Chess()
    let expected: string[] = []
    try {
      const rev = await revealPuzzleAnswer(state.puzzle.id)
      setRevealed((r) => ({ ...(r ?? { title: '', themes: [] }), ...rev }))
      expected = rev.solution.trim().split(/\s+/).filter(Boolean)
    } catch {
      return
    }
    if (expected.length === 0) return
    // replay on a fresh instance; if the view moves to another puzzle
    // mid-replay, the tick bails instead of moving the new board
    const gSol = new Chess(state.puzzle.fen)
    gameRef.current = gSol
    let i = 0
    const tick = () => {
      if (gameRef.current !== gSol) return
      if (i >= expected.length) return
      try {
        const mv = gSol.move(expected[i])
        if (mv) {
          setFen(gSol.fen())
          setLastMove({ from: mv.from, to: mv.to })
          playSound(mv.captured ? 'capture' : 'move', soundEnabled)
        }
      } catch {
        return
      }
      i++
      setTimeout(tick, 700)
    }
    setTimeout(tick, 300)
  }

  const puzzle = state?.puzzle
  // Spoiler-safe solving: while the user is still solving (or converting) and has
  // not revealed the solution, the puzzle title, themes, and source stay hidden.
  const hideMeta = (phase === 'solving' || phase === 'converting') && !showSolution

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
            <TabsList className="h-auto max-w-full flex-wrap">
              <TabsTrigger value="rated">Rated</TabsTrigger>
              <TabsTrigger value="daily">Daily</TabsTrigger>
              <TabsTrigger value="rush">Rush</TabsTrigger>
              <TabsTrigger value="battle">Battle</TabsTrigger>
              <TabsTrigger value="vision">Vision</TabsTrigger>
              <TabsTrigger value="woodpecker">Woodpecker</TabsTrigger>
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
                'inline-flex min-h-11 items-center justify-center rounded-full px-3 py-2 text-xs font-semibold transition active:scale-95',
                themeFilter === null
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              All <span className="ml-0.5 font-normal opacity-70">{pool.length}</span>
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
                    'inline-flex min-h-11 items-center justify-center rounded-full px-3 py-2 text-xs font-semibold transition active:scale-95',
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
          {!themeFilter && weakThemes.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                Your weakest themes
              </span>
              {weakThemes.map((w) => (
                <button
                  key={w.key}
                  type="button"
                  onClick={() => setThemeFilter(w.key)}
                  title={`Solved ${w.solved} of ${w.attempts} on ${humanizeTheme(w.key)} — click to train exactly this`}
                  className="inline-flex min-h-9 items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-bold text-destructive transition hover:bg-destructive/20 active:scale-95"
                >
                  {humanizeTheme(w.key)}
                  <span className="font-semibold opacity-80">{w.acc}%</span>
                </button>
              ))}
            </div>
          )}
          {themeFilter && (
            <div className="mt-1.5 text-xs text-muted-foreground" aria-live="polite">
              {humanizeTheme(themeFilter)} practice ·{' '}
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

      {tab === 'rated' && <PuzzleLeaderboard />}

      {tab === 'rush' && <RushPanel />}

      {tab === 'battle' && <BattlePanel />}

      {tab === 'vision' && <VisionPanel />}
      {tab === 'woodpecker' && <WoodpeckerPanel poolThemes={themeOptions.map((t) => t.key)} />}

      {tab !== 'rush' && tab !== 'battle' && tab !== 'woodpecker' && phase === 'loading' && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Setting the board…
        </div>
      )}

      {tab !== 'rush' && tab !== 'battle' && tab !== 'vision' && phase === 'failed' && !state && (
        <div className="mx-auto max-w-md rounded-lg bg-card p-6 text-center shadow-sm">
          <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <div className="mt-2 font-display text-lg font-bold">Could not load today's puzzle</div>
          <p className="mt-1 text-sm text-muted-foreground">Check your connection, then try again.</p>
          <Button
            variant="secondary"
            className="mt-4"
            onClick={() => {
              setPhase('loading')
              void loadDaily()
            }}
          >
            <RotateCcw className="h-4 w-4" /> Retry
          </Button>
        </div>
      )}

      {puzzle && tab !== 'rush' && tab !== 'battle' && tab !== 'vision' && phase !== 'loading' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="mx-auto w-full max-w-[600px]">
            <ChessBoard
              fen={fen}
              orientation={solverSide}
              onMove={showSolution || (phase !== 'solving' && phase !== 'converting') ? undefined : onMove}
              movableSide={showSolution || (phase !== 'solving' && phase !== 'converting') ? undefined : solverSide}
              interactive={(phase === 'solving' || phase === 'converting') && !showSolution}
              lastMove={lastMove}
              checkSquare={checkSquare}
              flashes={flashes}
              theme={profile?.theme ?? 'green'}
            />
          </div>

          <div className="flex flex-col gap-3">
            <div className="rounded-lg bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {reviewItemId ? (
                    <span className="inline-flex items-center gap-1 text-[var(--primary-light)]">
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
                  <Flame className="h-4 w-4 text-[var(--gold)]" /> {profile?.puzzleStreak ?? 0}
                </div>
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-2">
                {hideMeta || !revealed ? (
                  <span className="font-display text-xl font-extrabold">{hideMeta ? `Puzzle · ${puzzle.rating}` : 'Solved puzzle'}</span>
                ) : (
                  <>
                    <span className="font-display text-xl font-extrabold">{revealed.title}</span>
                    <span className="text-sm text-muted-foreground">{puzzle.rating}</span>
                  </>
                )}
              </div>
              <div className="mt-1 text-sm">
                <span className="font-bold">{solverSide === 'w' ? 'White' : 'Black'} to play</span>
                <span className="text-muted-foreground">
                  {' '}
                  · {phase === 'converting' ? 'press the win to the end' : 'find the best move'}
                </span>
              </div>
              {!hideMeta && revealed && (
                <div className="mt-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Themes</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {revealed.themes.map((t) => (
                      <span key={t} className="rounded bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                        {PUZZLE_THEMES[t] ?? t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {!hideMeta && revealed?.source && <div className="mt-2 text-xs italic text-muted-foreground">from {revealed.source}</div>}

              {(phase === 'solving' || phase === 'converting') && line.length > 0 && (
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
                  <Trophy className="mr-1 inline h-4 w-4 text-primary" /> {guide?.startsWith('Conversion complete') || guide?.startsWith('Checkmate') ? guide : 'Solved.'}
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
                      if (!state) return
                      void gradePuzzleMove(state.puzzle.id, userMovesRef.current, true)
                        .then((v) => {
                          if (v.hintFrom) flash([{ square: v.hintFrom as Square, color: 'gold' }])
                        })
                        .catch(() => {
                          /* the hint glow is a nicety, solving continues */
                        })
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
                {(phase === 'solved' || phase === 'failed' || phase === 'converting' || showSolution) && (
                  <Button
                    className="btn-hero"
                    size="sm"
                    onClick={() => {
                      // Leaving a conversion early still banks the tactic
                      // itself (the point was found); a mate puzzle keeps its
                      // rule: no credit until the king actually falls.
                      if (phase === 'converting' && goalRef.current !== 'mate') void record(true)
                      if (tab === 'rated') loadRated()
                      else void loadDaily()
                    }}
                  >
                    <RotateCcw className="h-4 w-4" /> {phase === 'converting' ? 'Bank it and move on' : 'Next puzzle'}
                  </Button>
                )}
              </div>
              {graded && phase === 'failed' && (
                <p className="mt-2 text-xs text-muted-foreground">Still in the review queue, it comes back tomorrow.</p>
              )}
              {hintShown && phase === 'solving' && (
                <p className="mt-2 text-sm text-muted-foreground">The glowing piece is the one that moves. It is up to you to find where.</p>
              )}
              {showSolution && revealed?.solution && (
                <p className="mt-2 text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">Solution:</span> {revealed.solution}
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
