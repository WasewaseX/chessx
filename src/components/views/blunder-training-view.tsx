'use client'
// Blunder training — the decision layer under Learn. Eye training builds
// perception; this builds the two-second pre-move check that actually stops
// the bleeding: after every opponent move, run THEIR scan (checks, captures,
// threats); before every own move, blunder-check the candidate against the
// same scan. Three drills, one habit:
//   Threat scan      — play the opponent's best shot from their side.
//   Blunder check    — judge a tempting candidate: safe or blunder.
//   Safe move        — you are in danger: find the move that survives.
// Every round is graded by the shared scan engine (lib/chess/blunder-scan)
// with the exact same rules the content validator enforces, so a "blunder"
// always means: the opponent's single best reply nets a piece or more, or
// mate in one. Nothing is asserted, everything is computed.
import { readJson } from '@/lib/api-client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard } from '@/components/chess/board'
import { useApp, type ProfileData } from '@/lib/store'
import { playSound } from '@/lib/chess/sounds'
import {
  BLUNDER_CHECK_DRILLS,
  SAFE_MOVE_DRILLS,
  THREAT_DRILLS,
  type BlunderCheckDrill,
  type SafeMoveDrill,
  type ThreatDrill,
} from '@/content/blunder'
import { isSafeMove, isWinningShot, materialBalance, punishMove } from '@/lib/chess/blunder-scan'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Crosshair, LifeBuoy, SearchCheck, ShieldAlert } from 'lucide-react'

type Mode = 'threat' | 'blunderCheck' | 'safemove'
type Phase = 'idle' | 'running' | 'over'

const ROUNDS = 8
const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1'
const NEXT_ROUND_MS = 1900

interface RunResult {
  score: number
  mistakes: number
  seconds: number
  xpGain: number
  isNewBest: boolean
  previousBest: number
}

const MODE_META: Record<Mode, { label: string; icon: typeof Crosshair }> = {
  threat: { label: 'Threat scan', icon: Crosshair },
  blunderCheck: { label: 'Blunder check', icon: SearchCheck },
  safemove: { label: 'Safe move', icon: LifeBuoy },
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const r = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[r]] = [out[r], out[i]]
  }
  return out
}

function poolOf(mode: Mode): (ThreatDrill | BlunderCheckDrill | SafeMoveDrill)[] {
  return mode === 'threat' ? THREAT_DRILLS : mode === 'blunderCheck' ? BLUNDER_CHECK_DRILLS : SAFE_MOVE_DRILLS
}

function deckFor(mode: Mode): string[] {
  const ids = poolOf(mode).map((d) => d.id)
  const deal: string[] = []
  while (deal.length < ROUNDS) deal.push(...shuffle(ids))
  return deal.slice(0, ROUNDS)
}

function sanOf(fen: string, from: Square, to: Square, promotion?: string): string | null {
  try {
    return new Chess(fen).move({ from, to, promotion: promotion || undefined }).san
  } catch {
    return null
  }
}

const sideName = (c: 'w' | 'b') => (c === 'w' ? 'White' : 'Black')

export function BlunderTrainingView() {
  const { profile, setProfile, navigate } = useApp()
  const soundEnabled = profile?.sound !== false

  const [phase, setPhase] = useState<Phase>('idle')
  const [mode, setMode] = useState<Mode>('threat')
  const [result, setResult] = useState<RunResult | null>(null)
  const [bests, setBests] = useState<Record<Mode, number> | null>(null)

  const [round, setRound] = useState(0)
  const [score, setScore] = useState(0)
  const [mistakes, setMistakes] = useState(0)
  const [shake, setShake] = useState(false)

  const deckRef = useRef<string[]>([])
  const roundRef = useRef(0)
  const runRefs = useRef({ score: 0, mistakes: 0 })
  const runStartRef = useRef(0)
  const finishedRef = useRef(false)
  const tokenRef = useRef(0)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  // threat scan round state
  const [thDrill, setThDrill] = useState<ThreatDrill | null>(null)
  const [thShown, setThShown] = useState<{ correct: boolean; san: string } | null>(null)

  // blunder check round state
  const [bcDrill, setBcDrill] = useState<BlunderCheckDrill | null>(null)
  const [bcStage, setBcStage] = useState<'verdict' | 'punish' | 'shown'>('verdict')
  const [bcShown, setBcShown] = useState<{ correct: boolean; text: string; punishSan?: string; punishFromCand?: boolean } | null>(null)

  // safe move round state
  const [smDrill, setSmDrill] = useState<SafeMoveDrill | null>(null)
  const [smShown, setSmShown] = useState<{ correct: boolean; text: string; userSan: string; punishSan?: string } | null>(null)

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t)
    timersRef.current = []
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  useEffect(() => {
    fetch('/api/blunder')
      .then((r) => readJson<{ best?: Record<string, number> }>(r))
      .then((d) => {
        if (d?.best)
          setBests({
            threat: d.best.threat ?? 0,
            blunderCheck: d.best.blunderCheck ?? 0,
            safemove: d.best.safemove ?? 0,
          })
      })
      .catch(() => {
        /* bests are a nicety */
      })
  }, [])

  const finish = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    tokenRef.current++
    clearTimers()
    setPhase('over')
    const seconds = Math.min(600, Math.max(1, Math.round((Date.now() - runStartRef.current) / 1000)))
    const { score: s, mistakes: m } = runRefs.current
    const post = async () => {
      try {
        const res = await fetch('/api/blunder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, score: s, mistakes: m, seconds, dayKey: new Date().toLocaleDateString('sv-SE') }),
        })
        const d = await readJson<{ profile?: ProfileData; xpGain?: number; isNewBest?: boolean; previousBest?: number }>(res)
        if (d.profile) setProfile(d.profile)
        setResult({
          score: s,
          mistakes: m,
          seconds,
          xpGain: d.xpGain ?? 0,
          isNewBest: Boolean(d.isNewBest),
          previousBest: d.previousBest ?? 0,
        })
        if (d.isNewBest) playSound('win', soundEnabled)
        setBests((b) => (b ? { ...b, [mode]: Math.max(b[mode], s) } : b))
      } catch {
        setResult({ score: s, mistakes: m, seconds, xpGain: 0, isNewBest: false, previousBest: 0 })
      }
    }
    void post()
  }, [clearTimers, mode, setProfile, soundEnabled])

  const dealRound = useCallback(
    (r: number) => {
      roundRef.current = r
      setRound(r)
      setShake(false)
      const id = deckRef.current[r]
      if (mode === 'threat') {
        const d = THREAT_DRILLS.find((x) => x.id === id) ?? THREAT_DRILLS[0]
        setThDrill(d)
        setThShown(null)
      } else if (mode === 'blunderCheck') {
        const d = BLUNDER_CHECK_DRILLS.find((x) => x.id === id) ?? BLUNDER_CHECK_DRILLS[0]
        setBcDrill(d)
        setBcStage('verdict')
        setBcShown(null)
      } else {
        const d = SAFE_MOVE_DRILLS.find((x) => x.id === id) ?? SAFE_MOVE_DRILLS[0]
        setSmDrill(d)
        setSmShown(null)
      }
    },
    [mode],
  )

  const scheduleNext = useCallback(
    (ms = NEXT_ROUND_MS) => {
      const token = tokenRef.current
      const t = setTimeout(() => {
        if (tokenRef.current !== token || finishedRef.current) return
        const next = roundRef.current + 1
        if (next >= ROUNDS) {
          finish()
          return
        }
        dealRound(next)
      }, ms)
      timersRef.current.push(t)
    },
    [dealRound, finish],
  )

  const begin = useCallback(
    (m: Mode) => {
      tokenRef.current++
      finishedRef.current = false
      clearTimers()
      setMode(m)
      setResult(null)
      playSound('click', soundEnabled)
      deckRef.current = deckFor(m)
      runRefs.current = { score: 0, mistakes: 0 }
      setScore(0)
      setMistakes(0)
      runStartRef.current = Date.now()
      setPhase('running')
      // dealRound reads `mode` from state which is still the old value here,
      // so deal inline for round 0
      roundRef.current = 0
      setRound(0)
      setShake(false)
      const id = deckRef.current[0]
      if (m === 'threat') {
        setThDrill(THREAT_DRILLS.find((x) => x.id === id) ?? THREAT_DRILLS[0])
        setThShown(null)
      } else if (m === 'blunderCheck') {
        setBcDrill(BLUNDER_CHECK_DRILLS.find((x) => x.id === id) ?? BLUNDER_CHECK_DRILLS[0])
        setBcStage('verdict')
        setBcShown(null)
      } else {
        setSmDrill(SAFE_MOVE_DRILLS.find((x) => x.id === id) ?? SAFE_MOVE_DRILLS[0])
        setSmShown(null)
      }
    },
    [clearTimers, soundEnabled],
  )

  const bump = useCallback(
    (correct: boolean) => {
      if (correct) {
        runRefs.current.score += 1
        setScore(runRefs.current.score)
        playSound('correct', soundEnabled)
      } else {
        runRefs.current.mistakes += 1
        setMistakes(runRefs.current.mistakes)
        playSound('wrong', soundEnabled)
        setShake(true)
        const t = setTimeout(() => setShake(false), 500)
        timersRef.current.push(t)
      }
    },
    [soundEnabled],
  )

  /* ----------------------------- threat scan ----------------------------- */

  const threatTurn = thDrill ? (new Chess(thDrill.fen).turn() as 'w' | 'b') : 'w'

  const playThreat = useCallback(
    (from: Square, to: Square, promotion?: string) => {
      if (!thDrill || thShown) return
      const san = sanOf(thDrill.fen, from, to, promotion)
      if (!san) return
      const correct = san === thDrill.threat && isWinningShot(thDrill.fen, san)
      bump(correct)
      setThShown({ correct, san })
      scheduleNext()
    },
    [bump, scheduleNext, thDrill, thShown],
  )

  /* ----------------------------- blunder check ---------------------------- */

  const answerVerdict = useCallback(
    (pick: 'safe' | 'blunder') => {
      if (!bcDrill || bcStage !== 'verdict') return
      const truth = isSafeMove(bcDrill.fen, bcDrill.candidate) ? 'safe' : 'blunder'
      const correct = pick === truth
      bump(correct)
      if (truth === 'blunder' && correct) {
        // they called the blunder: now play the punishment out
        setBcStage('punish')
        return
      }
      const punish = truth === 'blunder' ? punishMove(bcDrill.fen, bcDrill.candidate) : undefined
      setBcShown({
        correct,
        text: correct
          ? `Right — ${bcDrill.why}`
          : truth === 'safe'
            ? `It is actually safe. ${bcDrill.why}`
            : `It is actually a blunder. ${bcDrill.why}`,
        punishSan: truth === 'blunder' ? punish ?? undefined : undefined,
        punishFromCand: truth === 'blunder' && !correct,
      })
      setBcStage('shown')
      scheduleNext()
    },
    [bump, bcDrill, bcStage, scheduleNext],
  )

  const playPunish = useCallback(
    (from: Square, to: Square, promotion?: string) => {
      if (!bcDrill || bcStage !== 'punish') return
      const g = new Chess(bcDrill.fen)
      let played: ReturnType<Chess['move']>
      try {
        played = g.move(bcDrill.candidate)
      } catch {
        return
      }
      void played
      const afterCand = g.fen()
      const san = sanOf(afterCand, from, to, promotion)
      if (!san) return
      // a punishment is a reply that inflicts two pawns or more ON THE CANDIDATE
      // MOVER, or mates them — measured from their side, not the punisher's
      const probe = new Chess(afterCand)
      let mates = false
      let harm = 0
      try {
        probe.move(san)
        mates = probe.isCheckmate()
        if (!mates) {
          const candMoverSign = new Chess(afterCand).turn() === 'w' ? -1 : 1
          harm = candMoverSign * (materialBalance(afterCand) - materialBalance(probe.fen()))
        }
      } catch {
        /* illegal replies cannot happen: the board only emits legal moves */
      }
      const harmful = mates || harm >= 2
      const canonical = punishMove(bcDrill.fen, bcDrill.candidate)
      bump(harmful)
      setBcShown({
        correct: harmful,
        text: harmful
          ? `Punished. ${bcDrill.why}`
          : `That lets the blunder stand. The clean punishment was ${canonical ?? 'the biggest capture'}. ${bcDrill.why}`,
        punishSan: canonical ?? undefined,
        punishFromCand: true,
      })
      setBcStage('shown')
      scheduleNext()
    },
    [bcDrill, bcStage, bump, scheduleNext],
  )

  /* -------------------------------- safe move ------------------------------ */

  const playSafeMove = useCallback(
    (from: Square, to: Square, promotion?: string) => {
      if (!smDrill || smShown) return
      const san = sanOf(smDrill.fen, from, to, promotion)
      if (!san) return
      const safe = isSafeMove(smDrill.fen, san)
      bump(safe)
      const punish = safe ? undefined : punishMove(smDrill.fen, san)
      const isTrap = !safe && smDrill.traps.includes(san)
      setSmShown({
        correct: safe,
        text: safe
          ? san === smDrill.escape
            ? smDrill.escapeNote
            : 'That survives the scan: nothing hangs, no mate comes. The scan approves.'
          : isTrap
            ? `${smDrill.trapNote} ${punish ? `${sideName(smDrill.fen.includes(' w ') ? 'b' : 'w')} answers ${punish}.` : ''}`
            : `That leaves you worse: ${punish ? `${sideName(smDrill.fen.includes(' w ') ? 'b' : 'w')} answers ${punish}.` : 'the scan finds nothing good for you.'}`,
        userSan: san,
        punishSan: punish ?? undefined,
      })
      scheduleNext()
    },
    [bump, scheduleNext, smDrill, smShown],
  )

  /* --------------------------------- render -------------------------------- */

  const meta = MODE_META[mode]

  const cards = useMemo(
    () => [
      {
        m: 'threat' as Mode,
        icon: Crosshair,
        title: 'Threat scan · 8 rounds',
        hint: 'Their move changed the board. Step into their shoes and play the shot that punishes: their check, their capture, their mate.',
      },
      {
        m: 'blunderCheck' as Mode,
        icon: SearchCheck,
        title: 'Blunder check · 8 rounds',
        hint: 'A tempting move is on the board. Call it safe or a blunder — and if it blunders, play the punishment yourself.',
      },
      {
        m: 'safemove' as Mode,
        icon: LifeBuoy,
        title: 'Safe move · 8 rounds',
        hint: 'You are under attack right now. Find the one kind of move that survives: leave the line, eat the attacker, or defend.',
      },
    ],
    [],
  )

  if (phase === 'idle') {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <div className="rounded-xl bg-card p-6 shadow-sm">
          <h2 className="font-display text-xl font-extrabold">Blunder training</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Blunders decide games, and almost every blunder is a scan that never ran: the opponent&apos;s checks, captures and threats went
            unseen, or the candidate move was never checked before it was played. These three drills build the two-second check on BOTH sides
            of every move. Every verdict is computed on the spot — a blunder here really means a piece, or the whole game, walks away.
          </p>
          <div className="mt-5 grid gap-3">
            {cards.map(({ m, icon: Icon, title, hint }) => (
              <button
                key={m}
                onClick={() => begin(m)}
                className="rounded-xl border border-border p-5 text-left transition-all duration-150 hover:border-primary/60 hover:shadow-md active:scale-[0.98]"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-display text-base font-bold">
                    <Icon className="h-4 w-4 text-primary" /> {title}
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground">
                    {bests ? (bests[m] > 0 ? `Best: ${bests[m]}/${ROUNDS}` : 'No runs yet') : ''}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
              </button>
            ))}
          </div>
          <div className="mt-5 rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <div className="font-semibold">Your own blunders live in the Mistake Corrector</div>
            <p className="mt-1 text-muted-foreground">
              These drills train the scan on fresh positions. The mistakes YOU actually played in real games are harvested into the
              Mistake Corrector when you review games.{' '}
              <button type="button" onClick={() => navigate('review')} className="font-semibold text-primary underline underline-offset-2">
                Open Game Review
              </button>{' '}
              and the two together close the loop: see the pattern here, never repeat it there.
            </p>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            The seeing-it part — square colors, loose pieces, rays — is trained separately in{' '}
            <button type="button" onClick={() => navigate('eyetraining')} className="font-semibold text-primary underline underline-offset-2">
              Eye Training
            </button>
            .
          </p>
        </div>
      </div>
    )
  }

  if (phase === 'over' && result) {
    const Icon = meta.icon
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="rounded-xl bg-card p-6 text-center shadow-sm">
          <Icon className={cn('mx-auto h-10 w-10', result.isNewBest ? 'text-[var(--gold)]' : 'text-primary')} />
          <div className="mt-3 font-display text-4xl font-extrabold tabular-nums">
            {result.score}
            <span className="text-2xl text-muted-foreground">/{ROUNDS}</span>
          </div>
          <div className="text-sm text-muted-foreground">
            {meta.label} · {result.mistakes} {result.mistakes === 1 ? 'miss' : 'misses'} · {result.seconds}s
          </div>
          <div className="mt-4 text-sm text-muted-foreground">
            {mode === 'threat' && 'Every round you survived started with their scan: their checks, their captures, their threats.'}
            {mode === 'blunderCheck' && 'Good move first, safe move last: the candidate check catches what hope misses.'}
            {mode === 'safemove' && 'Under attack there is always an answer: leave the line, eat the attacker, or defend.'}
          </div>
          {result.isNewBest ? (
            <div className="mt-3 rounded-md border border-[#e6a82c]/50 bg-[#e6a82c]/10 px-3 py-2 text-sm font-bold">New personal best.</div>
          ) : (
            <div className="mt-3 text-sm text-muted-foreground">Best: {result.previousBest}/{ROUNDS}</div>
          )}
          {result.xpGain > 0 && <div className="mt-2 text-sm font-semibold">+{result.xpGain} XP</div>}
          <div className="mt-6 flex justify-center gap-2">
            <Button className="btn-hero" onClick={() => begin(mode)}>
              Go again
            </Button>
            <Button variant="secondary" onClick={() => setPhase('idle')}>
              Other drills
            </Button>
          </div>
        </div>
      </div>
    )
  }

  /* ------------------------------ running views ---------------------------- */

  const boardTheme = profile?.theme ?? 'green'

  if (mode === 'threat' && thDrill) {
    const shown = thShown
    // resolve the played move for display: show the position after it and
    // highlight the real landing square (SAN suffixes break slice-based parsing)
    let shownFen = thDrill.fen
    let shownSquare: string | null = null
    if (shown) {
      try {
        const g = new Chess(thDrill.fen)
        const mv = g.move(shown.san)
        shownFen = g.fen()
        shownSquare = mv.to
      } catch {
        /* keep base position */
      }
    }
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="mx-auto w-full max-w-[600px]">
          <ChessBoard
            fen={shownFen}
            orientation={threatTurn}
            interactive={!shown}
            movableSide={threatTurn}
            onMove={playThreat}
            showCoords
            showLegal={!shown}
            shake={shake}
            marks={shown && shownSquare ? [{ square: shownSquare, color: shown.correct ? 'green' : 'red' }] : undefined}
            theme={boardTheme}
          />
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-lg bg-card p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Threat scan · round {round + 1} of {ROUNDS}
            </div>
            <p className="mt-2 text-sm font-semibold" aria-live="polite">
              {sideName(threatTurn)} to move. You just made a quiet move — what can they do to you right now?
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Step into their shoes and PLAY their best shot: their check, their capture, their mate.
            </p>
            <div className="mt-3 text-sm text-muted-foreground">
              {score} found · {mistakes} missed
            </div>
            {shown && (
              <div className={cn('mt-3 rounded-md border px-3 py-2 text-sm', shown.correct ? 'border-primary/50 bg-primary/10' : 'border-destructive/50 bg-destructive/10')}>
                <span className="font-bold">{shown.correct ? 'Found it: ' : 'The shot was '}</span>
                {shown.san}. {thDrill.note}
              </div>
            )}
            <Button variant="outline" className="mt-4 w-full" onClick={finish}>
              End run
            </Button>
          </div>
          <div className="rounded-lg bg-card p-4 text-xs text-muted-foreground shadow-sm">
            The scan you are drilling is the one that runs after EVERY opponent move: what does that move check, capture, or attack NOW?
          </div>
        </div>
      </div>
    )
  }

  if (mode === 'blunderCheck' && bcDrill) {
    const shown = bcShown
    // resolve the candidate move exactly once: origin, landing square and the
    // position the verdict stage displays (the candidate is played on the board)
    let candOrigin: string | null = null
    let candTo: string | null = null
    let candFen = bcDrill.fen
    try {
      const g = new Chess(bcDrill.fen)
      const mv = g.move(bcDrill.candidate)
      candOrigin = mv.from
      candTo = mv.to
      candFen = g.fen()
    } catch {
      candOrigin = null
    }
    let punishFrom: string | null = null
    let punishTo: string | null = null
    if (shown?.punishSan) {
      try {
        const g = new Chess(bcDrill.fen)
        g.move(bcDrill.candidate)
        const pm = g.move(shown.punishSan)
        punishFrom = pm.from
        punishTo = pm.to
      } catch {
        punishFrom = null
        punishTo = null
      }
    }
    const punishSide = bcStage === 'punish' || (shown?.punishFromCand ?? false) ? (new Chess(bcDrill.fen).turn() === 'w' ? 'b' : 'w') : 'w'
    const displayFen = punishFrom && punishTo && shown?.punishFromCand
      ? (() => {
          const g = new Chess(bcDrill.fen)
          try {
            g.move(bcDrill.candidate)
            g.move(shown.punishSan)
          } catch {
            /* keep candidate position */
          }
          return g.fen()
        })()
      : candFen

    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="mx-auto w-full max-w-[600px]">
          <ChessBoard
            fen={displayFen}
            orientation={new Chess(bcDrill.fen).turn()}
            interactive={bcStage === 'punish'}
            movableSide={punishSide}
            onMove={playPunish}
            showCoords
            showLegal={bcStage === 'punish'}
            shake={shake}
            arrows={
              punishFrom && punishTo
                ? [{ from: punishFrom, to: punishTo, color: 'red' }]
                : candOrigin && candTo
                  ? [{ from: candOrigin, to: candTo, color: 'orange' }]
                  : undefined
            }
            marks={shown && !shown.punishSan && candTo ? [{ square: candTo, color: shown.correct ? 'green' : 'red' }] : undefined}
            theme={boardTheme}
          />
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-lg bg-card p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Blunder check · round {round + 1} of {ROUNDS}
            </div>
            {bcStage === 'verdict' && (
              <>
                <p className="mt-2 text-sm font-semibold" aria-live="polite">
                  You want to play <span className="font-mono font-bold">{bcDrill.candidate}</span>. One last look before you move:
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button size="lg" variant="outline" className="min-h-14 text-base font-bold" onClick={() => answerVerdict('safe')}>
                    Safe
                  </Button>
                  <Button size="lg" variant="outline" className="min-h-14 text-base font-bold" onClick={() => answerVerdict('blunder')}>
                    Blunder
                  </Button>
                </div>
              </>
            )}
            {bcStage === 'punish' && (
              <>
                <p className="mt-2 text-sm font-semibold" aria-live="polite">
                  Right — it is a blunder. Now play the punishment as {sideName(punishSide)}.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Take the biggest bite the board allows.</p>
              </>
            )}
            {bcStage === 'shown' && shown && (
              <div className={cn('mt-3 rounded-md border px-3 py-2 text-sm', shown.correct ? 'border-primary/50 bg-primary/10' : 'border-destructive/50 bg-destructive/10')}>
                <span className="font-bold">{shown.correct ? 'Correct. ' : 'Missed. '}</span>
                {shown.text}
              </div>
            )}
            <div className="mt-3 text-sm text-muted-foreground">
              {score} correct · {mistakes} missed
            </div>
            <Button variant="outline" className="mt-4 w-full" onClick={finish}>
              End run
            </Button>
          </div>
          <div className="rounded-lg bg-card p-4 text-xs text-muted-foreground shadow-sm">
            The candidate check: after you pick a move, ask what the opponent&apos;s best reply is BEFORE playing it. Two seconds, every move.
          </div>
        </div>
      </div>
    )
  }

  if (mode === 'safemove' && smDrill) {
    const shown = smShown
    const mover = new Chess(smDrill.fen).turn() as 'w' | 'b'
    let punishFrom: string | null = null
    let punishTo: string | null = null
    if (shown?.punishSan) {
      try {
        const g = new Chess(smDrill.fen)
        g.move(shown.userSan)
        const pm = g.move(shown.punishSan)
        punishFrom = pm.from
        punishTo = pm.to
      } catch {
        punishFrom = null
        punishTo = null
      }
    }
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="mx-auto w-full max-w-[600px]">
          <ChessBoard
            fen={shown?.punishSan ? (() => {
              const g = new Chess(smDrill.fen)
              try {
                g.move(shown.userSan)
                g.move(shown.punishSan)
              } catch {
                /* keep base fen */
              }
              return g.fen()
            })() : shown ? (() => {
              const g = new Chess(smDrill.fen)
              try {
                g.move(shown.userSan)
              } catch {
                /* keep base fen */
              }
              return g.fen()
            })() : smDrill.fen}
            orientation={mover}
            interactive={!shown}
            movableSide={mover}
            onMove={playSafeMove}
            showCoords
            showLegal={!shown}
            shake={shake}
            arrows={punishFrom && punishTo ? [{ from: punishFrom, to: punishTo, color: 'red' }] : undefined}
            theme={boardTheme}
          />
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-lg bg-card p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Safe move · round {round + 1} of {ROUNDS}
            </div>
            <p className="mt-2 text-sm font-semibold" aria-live="polite">
              {smDrill.scene}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Play the move that survives the scan. You are {sideName(mover).toLowerCase()}.</p>
            {shown && (
              <div className={cn('mt-3 rounded-md border px-3 py-2 text-sm', shown.correct ? 'border-primary/50 bg-primary/10' : 'border-destructive/50 bg-destructive/10')}>
                <span className="font-bold">{shown.correct ? 'Safe. ' : 'Blundered. '}</span>
                {shown.text}
              </div>
            )}
            <div className="mt-3 text-sm text-muted-foreground">
              {score} survived · {mistakes} blundered
            </div>
            <Button variant="outline" className="mt-4 w-full" onClick={finish}>
              End run
            </Button>
          </div>
          <div className="rounded-lg bg-card p-4 text-xs text-muted-foreground shadow-sm">
            When something is attacked there are exactly four answers: move it, capture the attacker, protect it, or block the line.
            The scan tells you which one this position allows.
          </div>
        </div>
      </div>
    )
  }

  // unreachable while a drill is always set in the running phase
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="mx-auto w-full max-w-[600px]">
        <ChessBoard fen={EMPTY_FEN} interactive={false} theme={boardTheme} />
      </div>
      <div className="rounded-lg bg-card p-6 shadow-sm">
        <div className="text-sm text-muted-foreground">Dealing the next position…</div>
      </div>
    </div>
  )
}
