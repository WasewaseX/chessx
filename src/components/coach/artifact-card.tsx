'use client'

// Interactive card for coach-generated material. A puzzle or drill is played
// right on the card with the app's guided-miss model (nudge, glow, reveal),
// a quiz is answered in place. Every finished pass records an attempt, which
// feeds the skill model like any other training event.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type Mark } from '@/components/chess/board'
import { engine } from '@/lib/chess/engine-client'
import { playSound } from '@/lib/chess/sounds'
import { PRESS_ENTER_CP, PRESS_HOLD_CP, PRESS_MAX_PLIES, PRESS_MISS_LIMIT, normSan, solverPovCp } from '@/lib/chess/press'
import { useApp } from '@/lib/store'
import { displayTitle, levelRefLabel, type ArtifactView, type LineStep } from '@/lib/coach-artifacts'
import { coachMaybe } from '@/lib/coaches'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SpeakButton } from '@/components/chess/speak-button'
import { cn } from '@/lib/utils'
import { BookOpen, Check, Copy, ExternalLink, RotateCcw, ShieldCheck, Sparkles, TriangleAlert, X } from 'lucide-react'

const NUDGE = 'Walk through every check, capture and threat before choosing. One of them is the move.'

interface Props {
  artifact: ArtifactView
  /** Fired after an attempt was recorded, with the pass result. */
  onRecorded?: (solved: boolean) => void
  /** Show a remove button (used in the drills shelf dialog). */
  onRemove?: () => void
  className?: string
}

function chessAt(fen: string | null): Chess {
  try {
    return new Chess(fen ?? undefined)
  } catch {
    return new Chess()
  }
}

function checkSquareOf(fen: string): string | null {
  try {
    const g = new Chess(fen)
    if (!g.isCheck()) return null
    const turn = g.turn()
    return g.board().flat().find((sq) => sq && sq.type === 'k' && sq.color === turn)?.square ?? null
  } catch {
    return null
  }
}

export function ArtifactCard(props: Props) {
  const { onRecorded, onRemove, className } = props
  // The artifact that arrives may be the spoiler-stripped copy (an unsolved
  // card ships a neutral name and no hint from every endpoint). Once the
  // material is solved and the headline unlocks, the card pulls its own full
  // copy so the real headline lands as the reward.
  const [full, setFull] = useState<ArtifactView | null>(null)
  const artifact = full ?? props.artifact
  const theme = useApp((s) => s.profile?.theme ?? 'green')
  const isBoardKind = artifact.kind === 'puzzle' || artifact.kind === 'drill'
  // Spoiler-safe headline: a puzzle title like "Knight sacrifice forces mate"
  // gives the whole answer away before the first move, and a quiz headline
  // like "Spot the fork" names the answer. The real headline only appears
  // once the material is solved (or was already in last session).
  const [titleOpen, setTitleOpen] = useState(artifact.kind === 'line' || artifact.solved === true)
  const kindLabel =
    artifact.kind === 'quiz'
      ? 'Quiz'
      : artifact.kind === 'drill'
        ? 'Drill'
        : artifact.kind === 'line'
          ? 'Walkthrough'
          : 'Puzzle'

  useEffect(() => {
    if (!titleOpen) return
    let live = true
    // The attempt POST that flips solved=true can still be in flight when the
    // headline unlocks, and a first fetch racing it returns the stripped copy
    // again. Poll briefly: the moment the server marks the card solved, the
    // real headline arrives; if the record was already banked, it lands on
    // the first try.
    const pull = (tries: number) => {
      if (!live) return
      fetch(`/api/coach/artifacts?id=${encodeURIComponent(artifact.id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { artifact?: ArtifactView } | null) => {
          if (!live || !d?.artifact) return
          if (d.artifact.solved === true || d.artifact.kind === 'line' || tries <= 0) {
            setFull(d.artifact)
          } else {
            setTimeout(() => pull(tries - 1), 900)
          }
        })
        .catch(() => {
          /* the neutral card stays honest even if the reveal fetch fails */
        })
    }
    pull(5)
    return () => {
      live = false
    }
  }, [titleOpen, artifact.id])

  return (
    <div className={cn('rounded-lg border border-primary/30 bg-card shadow-sm', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span
          className="min-w-0 flex-1 line-clamp-1 text-sm font-bold"
          title={titleOpen ? artifact.title : 'The headline is revealed when it is solved'}
        >
          {titleOpen ? artifact.title : displayTitle(artifact)}
        </span>
        {!titleOpen && (
          <span
            className="hidden text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground/60 sm:inline"
            title="Solve the card and the headline is yours"
          >
            solve to reveal
          </span>
        )}
        <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
          {kindLabel}
        </Badge>
        {titleOpen && artifact.rating != null && (
          <span className="text-[11px] font-semibold text-muted-foreground">{artifact.rating} Elo</span>
        )}
        <span
          className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground"
          title={artifact.engineVerified ? 'Every move checked with the engine' : 'Moves checked for legality; the engine had no time budget left'}
        >
          {artifact.engineVerified ? <ShieldCheck className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}
          {artifact.engineVerified ? 'Engine verified' : 'Legality checked'}
        </span>
      </div>

      {isBoardKind ? (
        <BoardAttempt artifact={artifact} theme={theme} onRecorded={onRecorded} onTitleReveal={() => setTitleOpen(true)} />
      ) : artifact.kind === 'line' ? (
        <LineWalkthrough artifact={artifact} />
      ) : (
        <QuizAttempt artifact={artifact} onRecorded={onRecorded} onTitleReveal={() => setTitleOpen(true)} />
      )}

      {(artifact.source || artifact.levelRef || onRemove) && (
        <div className="flex items-center gap-2 border-t border-border/70 px-3 py-2">
          {artifact.source ? (
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-muted-foreground">
              <BookOpen className="h-3 w-3 shrink-0 text-primary/70" />
              <span className="min-w-0 flex-1 line-clamp-1" title={artifact.source}>From a real game: {artifact.source}</span>
              {artifact.gameUrl && (
                <a
                  href={artifact.gameUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded px-1 py-0.5 font-medium text-primary/80 transition hover:bg-secondary hover:text-primary"
                  aria-label="Open the original game"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {levelRefLabel(artifact.levelRef) ?? 'Made for you by your coach'}
            </span>
          )}
          {onRemove && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onRemove}>
              <X className="h-3.5 w-3.5" /> Remove
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

interface BoardView {
  fen: string
  lastMove: { from: string; to: string } | null
}

function BoardAttempt({
  artifact,
  theme,
  onRecorded,
  onTitleReveal,
}: {
  artifact: ArtifactView
  theme: string
  onRecorded?: (solved: boolean) => void
  /** Fired when the line has fully played out (won or revealed): the card's
   * real headline and its rating may be shown from here on. */
  onTitleReveal?: () => void
}) {
  const solution = artifact.solution
  const side = artifact.sideToMove === 'b' ? 'b' : 'w'
  const coachVoice = coachMaybe(useApp((s) => s.profile?.coach))?.voice ?? 'nina'
  const soundEnabled = useApp((s) => s.profile?.soundEnabled ?? true)
  // A mate puzzle only counts when the king actually falls; anything else the
  // scripted tactic completes the job and the press is a bonus round.
  const mateGoal = (artifact.goal ?? '').toLowerCase().includes('mate') || /^.*#/.test(solution[solution.length - 1] ?? '')

  // The live game lives in a ref the render never reads; everything the
  // render needs is derived from the view state below.
  const gameRef = useRef<Chess | null>(null)
  if (gameRef.current == null) gameRef.current = chessAt(artifact.fen)
  const [view, setView] = useState<BoardView>({ fen: chessAt(artifact.fen).fen(), lastMove: null })
  const [ply, setPly] = useState(0)
  // 'pressing': the scripted tactic is done, the engine now defends and the
  // student keeps converting until the checkmate lands.
  const [phase, setPhase] = useState<'solving' | 'pressing' | 'won' | 'revealed'>('solving')
  const [pressPlies, setPressPlies] = useState(0)
  const [misses, setMisses] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const recordedRef = useRef(false)
  const busyRef = useRef(false)
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressMissRef = useRef(0)
  const pressPliesRef = useRef(0)

  useEffect(() => {
    return () => {
      if (replyTimer.current) clearTimeout(replyTimer.current)
    }
  }, [])

  // The headline is part of the reward: solved or shown, either way the real
  // title ("Knight sacrifice forces mate") is only readable after the line.
  useEffect(() => {
    if (phase === 'won' || phase === 'revealed') onTitleReveal?.()
  }, [phase, onTitleReveal])

  const record = useCallback(
    (solved: boolean) => {
      if (recordedRef.current) return
      recordedRef.current = true
      onRecorded?.(solved)
      void fetch('/api/coach/artifacts/attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: artifact.id, solved }),
      }).catch(() => {
        /* a lost attempt record must never block the student */
      })
    },
    [artifact.id, onRecorded],
  )

  const reset = useCallback(() => {
    if (replyTimer.current) clearTimeout(replyTimer.current)
    const fresh = chessAt(artifact.fen)
    gameRef.current = fresh
    setView({ fen: fresh.fen(), lastMove: null })
    setPly(0)
    setPhase('solving')
    setPressPlies(0)
    setMisses(0)
    setNote(null)
    recordedRef.current = false
    busyRef.current = false
    pressMissRef.current = 0
    pressPliesRef.current = 0
  }, [artifact.fen])

  /** The engine plays the defence from here; used between pressing moves. */
  const playEngineDefence = useCallback(
    async (thenWhat: 'press' | 'finish') => {
      const g = gameRef.current
      if (!g || g.isGameOver()) return
      busyRef.current = true
      try {
        const { uci } = await engine.bestMove({ fen: g.fen(), skill: 20, depth: 14 })
        if (!uci || uci.length < 4 || gameRef.current !== g) return
        const mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined })
        if (!mv) return
        setView({ fen: g.fen(), lastMove: { from: mv.from, to: mv.to } })
        playSound(mv.captured ? 'capture' : 'move', soundEnabled)
        if (thenWhat === 'finish' && g.isCheckmate()) {
          // The engine demonstration mates the student's king: honest reveal.
          setPhase('revealed')
        }
      } finally {
        busyRef.current = false
      }
    },
    [soundEnabled],
  )

  /** Called when the scripted line has run out. Decides: mate delivered,
   * keep pressing the win, or the tactic is complete as it stands. */
  const afterScript = useCallback(async () => {
    const g = gameRef.current
    if (!g) return
    if (g.isCheckmate()) {
      setPhase('won')
      setNote(mateGoal ? null : 'Checkmate — the whole win is yours.')
      playSound('correct', soundEnabled)
      record(true)
      return
    }
    const solverToMove = g.turn() === side
    const info = await engine.eval({ fen: g.fen(), depth: 14 })
    if (gameRef.current !== g) return
    const cp = solverPovCp(info, solverToMove)
    if (cp >= PRESS_ENTER_CP) {
      // There is still a decisive win on the board: the puzzle goes on and
      // the student must press it all the way.
      setPhase('pressing')
      setPressPlies(0)
      pressPliesRef.current = 0
      setNote(
        mateGoal
          ? 'The tactic landed. Do not stop here: the engine defends, you keep going until the mate.'
          : 'The tactic landed and the position is still crushing. Press the win to the very end.',
      )
      if (solverToMove === false) {
        // The script ended on the defender's turn: play the defence first.
        void playEngineDefence('press')
      }
      return
    }
    // Quiet finish: the point was made, nothing decisive left to press.
    setPhase('won')
    playSound('correct', soundEnabled)
    record(true)
  }, [mateGoal, side, record, soundEnabled, playEngineDefence])

  /** Show how the win finishes: the engine plays BOTH sides to the end. */
  const revealFinish = useCallback(async () => {
    const g = gameRef.current
    if (!g) return
    setPhase('revealed')
    if (mateGoal) record(false)
    setNote('Here is how the win finishes. Play it again and make it yours.')
    const demo = new Chess(g.fen())
    gameRef.current = demo
    busyRef.current = true
    try {
      let guard = 0
      while (!demo.isGameOver() && guard < 40) {
        guard++
        const { uci } = await engine.bestMove({ fen: demo.fen(), skill: 20, depth: 12 })
        if (!uci || uci.length < 4) break
        const mv = demo.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined })
        if (!mv) break
        setView({ fen: demo.fen(), lastMove: { from: mv.from, to: mv.to } })
        if (demo.isCheckmate()) break
      }
    } finally {
      busyRef.current = false
    }
  }, [mateGoal, record])

  /** One student move inside the pressing phase: judged by the engine, not
   * by a script. Keeps the win → the defence answers; loses it → takeback. */
  const pressingMove = useCallback(
    async (g: Chess, from: Square, to: Square, promotion?: string) => {
      let mv
      try {
        mv = g.move({ from, to, promotion: promotion ?? 'q' })
      } catch {
        return
      }
      if (!mv) return
      const info = await engine.eval({ fen: g.fen(), depth: 14 })
      if (gameRef.current !== g) return
      const cp = solverPovCp(info, false) // opponent to move after the solver
      if (cp < PRESS_HOLD_CP) {
        // The win slipped: take the move back and make the student look again.
        g.undo()
        setView({ fen: g.fen(), lastMove: null })
        setShake(true)
        setTimeout(() => setShake(false), 500)
        playSound('wrong', soundEnabled)
        pressMissRef.current += 1
        if (pressMissRef.current >= PRESS_MISS_LIMIT) {
          setNote('The conversion keeps drifting. Watch how the win is finished, then take it from the top.')
          await revealFinish()
          return
        }
        setNote('That lets the win slip. Take it back and keep every piece coordinated and the king safe.')
        return
      }
      setView({ fen: g.fen(), lastMove: { from: mv.from, to: mv.to } })
      playSound(mv.captured ? 'capture' : 'move', soundEnabled)
      if (g.isCheckmate()) {
        setPhase('won')
        setNote(null)
        playSound('correct', soundEnabled)
        record(true)
        return
      }
      if (g.isGameOver()) {
        // Stalemate or a dead draw while pressing: the win slipped away.
        setPhase('revealed')
        setNote('Stalemate: the king has no moves and no checks. The win slipped at the very end.')
        if (mateGoal) record(false)
        return
      }
      const nextPlies = pressPliesRef.current + 2
      pressPliesRef.current = nextPlies
      setPressPlies(nextPlies)
      if (nextPlies >= PRESS_MAX_PLIES) {
        setPhase('won')
        setNote('Conversion complete: the advantage never came back for the other side.')
        record(true)
        return
      }
      await playEngineDefence('press')
    },
    [record, soundEnabled, playEngineDefence, revealFinish, mateGoal],
  )

  const playOpponentAndAdvance = useCallback(
    (nextPly: number) => {
      // Opponent reply exists: play it, then hand the move back.
      const reply = solution[nextPly]
      replyTimer.current = setTimeout(async () => {
        const g = gameRef.current
        if (!g) return
        try {
          const mv = g.move(reply)
          if (!mv) {
            setPhase('revealed')
            return
          }
          setView({ fen: g.fen(), lastMove: { from: mv.from, to: mv.to } })
          playSound(mv.captured ? 'capture' : 'move', soundEnabled)
          const next = nextPly + 1
          setPly(next)
          if (next === solution.length) {
            // Script complete: mate now, or the continuation decides.
            if (g.isCheckmate()) {
              setPhase('won')
              setNote(null)
              playSound('correct', soundEnabled)
              record(true)
            } else {
              await afterScript()
            }
          }
        } catch {
          setPhase('revealed')
        }
      }, 550)
    },
    [solution, record, afterScript, soundEnabled],
  )

  const onMove = useCallback(
    (from: Square, to: Square, promotion?: string) => {
      if (busyRef.current) return
      if (phase !== 'solving' && phase !== 'pressing') return
      const g = gameRef.current
      if (!g) return
      if (phase === 'pressing') {
        busyRef.current = true
        void pressingMove(g, from, to, promotion)
          .catch(() => {
            /* an engine hiccup must never freeze the card */
          })
          .finally(() => {
            busyRef.current = false
          })
        return
      }
      if (ply >= solution.length) return
      let mv
      try {
        mv = g.move({ from, to, promotion: promotion ?? 'q' })
      } catch {
        return
      }
      if (!mv) return
      const expected = solution[ply]
      const matches = normSan(mv.san) === normSan(expected)
      if (!matches) {
        // Alternative wins count: rewind, ask the engine about the position
        // the student actually faced, and accept its best move too.
        g.undo()
        busyRef.current = true
        void (async () => {
          try {
            const before = g.fen()
            const { uci } = await engine.bestMove({ fen: before, skill: 20, depth: 16 })
            const moveNorm = mv!.from + mv!.to + (mv!.promotion ?? '')
            const bestNorm = uci.slice(0, 2) + uci.slice(2, 4) + (uci.slice(4, 5) || '')
            if (bestNorm === moveNorm) {
              // A real alternative solution: play it again for real and let
              // the engine-driven continuation take over from here.
              const again = g.move({ from, to, promotion: promotion ?? 'q' })
              if (!again) return
              setView({ fen: g.fen(), lastMove: { from: again.from, to: again.to } })
              playSound(again.captured ? 'capture' : 'move', soundEnabled)
              setPly(solution.length)
              await afterScript()
              return
            }
          } finally {
            busyRef.current = false
          }
          setShake(true)
          setTimeout(() => setShake(false), 500)
          playSound('wrong', soundEnabled)
          const nextMisses = misses + 1
          setMisses(nextMisses)
          if (nextMisses === 1) {
            // Generic process nudge only: the stored hint names ideas, and a
            // hint that names an idea is the answer in disguise.
            setNote(NUDGE)
          } else if (nextMisses === 2) {
            setNote('The key piece is glowing on the board.')
          } else {
            // Third miss: show the idea played out, honestly marked as a miss.
            const reveal = chessAt(g.fen())
            const parts: string[] = []
            for (let i = ply; i < solution.length; i++) {
              try {
                const m = reveal.move(solution[i])
                if (!m) break
                parts.push(m.san)
              } catch {
                break
              }
            }
            gameRef.current = reveal
            setView({ fen: reveal.fen(), lastMove: null })
            setPly(solution.length)
            setPhase('revealed')
            setNote(`The idea: ${parts.join(' ')}. ${artifact.explanation ?? ''} Play again to make it yours.`.trim())
            record(false)
          }
        })()
        return
      }
      setView({ fen: g.fen(), lastMove: { from: mv.from, to: mv.to } })
      playSound(mv.captured ? 'capture' : 'move', soundEnabled)
      if (ply === solution.length - 1) {
        setPly(ply + 1)
        // The scripted line just ended: only a real checkmate closes the
        // puzzle here; anything else runs the continuation.
        if (g.isCheckmate()) {
          setPhase('won')
          setNote(null)
          playSound('correct', soundEnabled)
          record(true)
        } else {
          busyRef.current = true
          void afterScript().finally(() => {
            busyRef.current = false
          })
        }
      } else {
        setPly(ply + 1)
        playOpponentAndAdvance(ply + 1)
      }
    },
    [phase, ply, solution, misses, artifact.explanation, playOpponentAndAdvance, afterScript, pressingMove, record, soundEnabled],
  )

  // Render-time derivations, all from plain state, never from the ref.
  const glowSquare = useMemo(() => {
    if (misses < 2 || phase !== 'solving' || ply >= solution.length) return null
    try {
      const probe = new Chess(view.fen)
      return probe.move(solution[ply])?.from ?? null
    } catch {
      return null
    }
  }, [misses, phase, ply, solution, view.fen])

  const checkSquare = useMemo(() => checkSquareOf(view.fen), [view.fen])
  const moverText = view.fen.split(' ')[1] === 'b' ? 'Black' : 'White'
  const marks: Mark[] = glowSquare ? [{ square: glowSquare, color: 'yellow' }] : []

  const caption = (() => {
    if (phase === 'won') return mateGoal && pressPlies + ply > 0 ? 'Checkmate. The whole win is yours.' : 'Solved. Well played.'
    if (phase === 'revealed') return mateGoal ? 'That is how the win finishes. Play it again and make it yours.' : 'The line played out. Restart and make it yours.'
    if (phase === 'pressing') return `Keep pressing, ${moverText.toLowerCase()} to move. The engine defends with best play.`
    return `${moverText} to move. You play ${side === 'w' ? 'White' : 'Black'}.`
  })()

  return (
    <div className="p-3">
      <div className="mx-auto max-w-[420px]">
        <ChessBoard
          fen={view.fen}
          orientation={side}
          onMove={onMove}
          movableSide={side}
          interactive={phase === 'solving' || phase === 'pressing'}
          lastMove={view.lastMove}
          marks={marks}
          checkSquare={checkSquare}
          shake={shake}
          theme={theme}
        />
      </div>
      <div className="mx-auto mt-2 flex max-w-[420px] flex-wrap items-center gap-2">
        <p className={cn('min-w-0 flex-1 text-xs leading-relaxed', phase === 'won' ? 'font-semibold text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
          {artifact.goal ? `${artifact.goal} ` : ''}
          {caption}
        </p>
        <Button variant="secondary" size="sm" className="h-7" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5" /> {phase === 'solving' || phase === 'pressing' ? 'Restart' : 'Play again'}
        </Button>
      </div>
      {note && (
        <div className="mx-auto mt-2 max-w-[420px] rounded-md bg-secondary/70 px-3 py-2 text-xs leading-relaxed">
          <div className="flex items-start gap-1.5">
            <span className="min-w-0 flex-1">{note}</span>
            {artifact.explanation && phase !== 'solving' && (
              <SpeakButton text={note} voice={coachVoice} speed={0.95} className="shrink-0" />
            )}
          </div>
        </div>
      )}
      {misses > 0 && phase === 'solving' && (
        <p className="mx-auto mt-1.5 max-w-[420px] text-[11px] text-muted-foreground">
          {misses === 1 ? 'Try again with that nudge in mind.' : 'One more miss and the line is shown.'}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

/** Walkthrough card for opening traps and famous games: the move sequence
 * with commentary on the key moves, plus a copy-as-PGN button. Long games
 * scroll; every move was replay-verified before the card was stored. */
function LineWalkthrough({ artifact }: { artifact: ArtifactView }) {
  const [copied, setCopied] = useState(false)
  const steps: LineStep[] = (artifact.steps ?? []).length
    ? artifact.steps!
    : artifact.solution.map((san) => ({ san }))
  const [openPly, setOpenPly] = useState<number | null>(null)
  const coachVoice = coachMaybe(useApp((s) => s.profile?.coach))?.voice ?? 'nina'

  const pairs: { n: number; white: string; black?: string; whitePly: number; blackPly?: number }[] = []
  steps.forEach((s, i) => {
    if (i % 2 === 0) pairs.push({ n: i / 2 + 1, white: s.san, whitePly: i })
    else pairs[pairs.length - 1].black = s.san
    if (i % 2 === 0) pairs[pairs.length - 1].blackPly = undefined
    if (i % 2 === 1) pairs[pairs.length - 1].blackPly = i
  })

  const copy = async () => {
    try {
      const pgn = pairs.map((p) => `${p.n}. ${p.white}${p.black ? ` ${p.black}` : ''}`).join(' ')
      await navigator.clipboard.writeText(pgn)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard unavailable */
    }
  }

  const noteText = (ply: number | undefined): string | null => {
    if (ply == null) return null
    const note = steps[ply]?.note
    return note ?? null
  }

  const visibleNote = openPly != null ? noteText(openPly) : null

  return (
    <div className="p-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        {artifact.explanation ?? ''}
      </p>
      <div className="scroll-slim mt-2 max-h-64 overflow-y-auto rounded-md bg-secondary/50 p-2">
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
          {pairs.map((p) => {
            const hasNote = noteText(p.whitePly) != null || noteText(p.blackPly) != null
            return (
              <div key={p.n} className="flex items-baseline gap-1 text-sm">
                <span className="w-6 shrink-0 text-right text-[11px] font-semibold text-muted-foreground">{p.n}.</span>
                <button
                  onClick={() => setOpenPly(p.whitePly)}
                  className={cn(
                    'rounded px-1 font-semibold transition hover:bg-accent',
                    hasNote && noteText(p.whitePly) && 'text-primary',
                  )}
                >
                  {p.white}
                </button>
                {p.black && (
                  <button
                    onClick={() => setOpenPly(p.blackPly ?? null)}
                    className={cn(
                      'rounded px-1 font-semibold transition hover:bg-accent',
                      hasNote && noteText(p.blackPly) && 'text-primary',
                    )}
                  >
                    {p.black}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" className="h-7" onClick={copy}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy moves'}
        </Button>
        {visibleNote ? (
          <div className="flex min-w-0 flex-1 items-start gap-1.5 rounded-md bg-secondary/70 px-3 py-2">
            <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 text-xs leading-relaxed">{visibleNote}</span>
            <SpeakButton text={visibleNote} voice={coachVoice} speed={0.95} className="shrink-0" />
          </div>
        ) : (
          <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">Tap any highlighted move to see the commentary.</p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function QuizAttempt({
  artifact,
  onRecorded,
  onTitleReveal,
}: {
  artifact: ArtifactView
  onRecorded?: (solved: boolean) => void
  /** Fired once the question is answered: the card's real headline may show. */
  onTitleReveal?: () => void
}) {
  const options = artifact.options ?? []
  // Reset on artifact change the React way: adjust state during render.
  const [state, setState] = useState<{ id: string; chosen: number | null }>({ id: artifact.id, chosen: null })
  if (state.id !== artifact.id) {
    setState({ id: artifact.id, chosen: null })
  }
  const chosen = state.chosen

  // The headline is part of the reveal: a quiz headline names the motif, so
  // it stays neutral until the answer is in.
  useEffect(() => {
    if (chosen != null) onTitleReveal?.()
  }, [chosen, onTitleReveal])

  if (!artifact.question) return null

  const pick = (i: number) => {
    if (chosen != null) return
    setState((s) => ({ ...s, chosen: i }))
    const solved = Boolean(options[i]?.correct)
    onRecorded?.(solved)
    void fetch('/api/coach/artifacts/attempt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: artifact.id, solved }),
    }).catch(() => {
      /* the answer stands even if the record did not land */
    })
  }

  return (
    <div className="p-3">
      <p className="text-sm font-semibold leading-relaxed">{artifact.question}</p>
      <div className="mt-3 space-y-2">
        {options.map((o, i) => {
          const revealed = chosen != null
          const isChosen = chosen === i
          return (
            <button
              key={i}
              onClick={() => pick(i)}
              disabled={revealed}
              className={cn(
                'block w-full rounded-md border px-3 py-2 text-left text-sm transition',
                !revealed && 'border-border hover:border-primary/50 hover:bg-secondary',
                revealed && o.correct && 'border-emerald-500/60 bg-emerald-500/10',
                revealed && isChosen && !o.correct && 'border-destructive/60 bg-destructive/10',
                revealed && !o.correct && !isChosen && 'border-border opacity-60',
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                {revealed && o.correct && <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
                {revealed && isChosen && !o.correct && <X className="h-4 w-4 shrink-0 text-destructive" />}
                {o.text}
              </span>
              {revealed && <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{o.why}</span>}
            </button>
          )
        })}
      </div>
      {artifact.explanation && chosen != null && (
        <p className="mt-3 rounded-md bg-secondary/70 px-3 py-2 text-xs leading-relaxed">{artifact.explanation}</p>
      )}
    </div>
  )
}
