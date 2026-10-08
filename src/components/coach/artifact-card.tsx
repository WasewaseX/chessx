'use client'

// Interactive card for coach-generated material. A puzzle or drill is played
// right on the card with the app's guided-miss model (nudge, glow, reveal),
// a quiz is answered in place. Every finished pass records an attempt, which
// feeds the skill model like any other training event.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type Mark } from '@/components/chess/board'
import { useApp } from '@/lib/store'
import { levelRefLabel, type ArtifactView } from '@/lib/coach-artifacts'
import { coachMaybe } from '@/lib/coaches'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SpeakButton } from '@/components/chess/speak-button'
import { cn } from '@/lib/utils'
import { BookOpen, Check, Copy, RotateCcw, ShieldCheck, Sparkles, TriangleAlert, X } from 'lucide-react'

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

export function ArtifactCard({ artifact, onRecorded, onRemove, className }: Props) {
  const theme = useApp((s) => s.profile?.theme ?? 'green')
  const isBoardKind = artifact.kind === 'puzzle' || artifact.kind === 'drill'
  const kindLabel =
    artifact.kind === 'quiz'
      ? 'Quiz'
      : artifact.kind === 'drill'
        ? 'Drill'
        : artifact.kind === 'line'
          ? 'Walkthrough'
          : 'Puzzle'

  return (
    <div className={cn('rounded-lg border border-primary/30 bg-card shadow-sm', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-sm font-bold">{artifact.title}</span>
        <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
          {kindLabel}
        </Badge>
        {artifact.rating != null && (
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
        <BoardAttempt artifact={artifact} theme={theme} onRecorded={onRecorded} />
      ) : artifact.kind === 'line' ? (
        <LineWalkthrough artifact={artifact} />
      ) : (
        <QuizAttempt artifact={artifact} onRecorded={onRecorded} />
      )}

      {(artifact.levelRef || onRemove) && (
        <div className="flex items-center gap-2 border-t border-border/70 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {levelRefLabel(artifact.levelRef) ?? 'Made for you by your coach'}
          </span>
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
}: {
  artifact: ArtifactView
  theme: string
  onRecorded?: (solved: boolean) => void
}) {
  const solution = artifact.solution
  const side = artifact.sideToMove === 'b' ? 'b' : 'w'
  const coachVoice = coachMaybe(useApp((s) => s.profile?.coach))?.voice ?? 'nina'

  // The live game lives in a ref the render never reads; everything the
  // render needs is derived from the view state below.
  const gameRef = useRef<Chess | null>(null)
  if (gameRef.current == null) gameRef.current = chessAt(artifact.fen)
  const [view, setView] = useState<BoardView>({ fen: chessAt(artifact.fen).fen(), lastMove: null })
  const [ply, setPly] = useState(0)
  const [phase, setPhase] = useState<'solving' | 'won' | 'revealed'>('solving')
  const [misses, setMisses] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const recordedRef = useRef(false)
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (replyTimer.current) clearTimeout(replyTimer.current)
    }
  }, [])

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
    setMisses(0)
    setNote(null)
    recordedRef.current = false
  }, [artifact.fen])

  const playOpponentAndAdvance = useCallback(
    (nextPly: number) => {
      // Opponent reply exists: play it, then hand the move back.
      const reply = solution[nextPly]
      replyTimer.current = setTimeout(() => {
        const g = gameRef.current
        if (!g) return
        try {
          const mv = g.move(reply)
          if (!mv) {
            setPhase('revealed')
            return
          }
          setView({ fen: g.fen(), lastMove: { from: mv.from, to: mv.to } })
          const next = nextPly + 1
          setPly(next)
          // A line that ends on the opponent's reply is won once it plays out.
          if (next === solution.length) {
            setPhase('won')
            setNote(null)
            record(true)
          }
        } catch {
          setPhase('revealed')
        }
      }, 550)
    },
    [solution, record],
  )

  const onMove = useCallback(
    (from: Square, to: Square, promotion?: string) => {
      if (phase !== 'solving' || ply >= solution.length) return
      const g = gameRef.current
      if (!g) return
      let mv
      try {
        mv = g.move({ from, to, promotion: promotion ?? 'q' })
      } catch {
        return
      }
      if (!mv) return
      const expected = solution[ply]
      if (mv.san === expected) {
        setView({ fen: g.fen(), lastMove: { from: mv.from, to: mv.to } })
        if (ply === solution.length - 1) {
          setPly(ply + 1)
          setPhase('won')
          setNote(null)
          record(true)
        } else {
          setPly(ply + 1)
          playOpponentAndAdvance(ply + 1)
        }
      } else {
        g.undo()
        setShake(true)
        setTimeout(() => setShake(false), 500)
        const nextMisses = misses + 1
        setMisses(nextMisses)
        if (nextMisses === 1) {
          setNote(artifact.hint ?? NUDGE)
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
      }
    },
    [phase, ply, solution, misses, artifact.hint, artifact.explanation, playOpponentAndAdvance, record],
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
    if (phase === 'won') return 'Solved. Well played.'
    if (phase === 'revealed') return 'Line revealed.'
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
          interactive={phase === 'solving'}
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
          <RotateCcw className="h-3.5 w-3.5" /> {phase === 'solving' ? 'Restart' : 'Play again'}
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
  const steps = (artifact.steps ?? []).length
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

function QuizAttempt({ artifact, onRecorded }: { artifact: ArtifactView; onRecorded?: (solved: boolean) => void }) {
  const options = artifact.options ?? []
  // Reset on artifact change the React way: adjust state during render.
  const [state, setState] = useState<{ id: string; chosen: number | null }>({ id: artifact.id, chosen: null })
  if (state.id !== artifact.id) {
    setState({ id: artifact.id, chosen: null })
  }
  const chosen = state.chosen

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
