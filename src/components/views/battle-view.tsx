'use client'
// Puzzle Battle: five rounds head to head against a character bot on the
// same positions. First to 3 points takes the match; one wrong move hands
// the round to your opponent, so every move carries the same weight a real
// battle carries. Casual mode: puzzle Elo is untouched, the match record
// and small XP are the whole prize.
import { readJson } from '@/lib/api-client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type FlashMark } from '@/components/chess/board'
import { CharacterFace } from '@/components/chess/characters'
import { PUZZLES } from '@/content/puzzles'
import type { Puzzle } from '@/content/schema'
import { BOTS, type Bot } from '@/lib/chess/bots'
import { useApp, type ProfileData } from '@/lib/store'
import { playSound } from '@/lib/chess/sounds'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronUp, Swords, Timer, Trophy } from 'lucide-react'

type Phase = 'idle' | 'running' | 'over'
type BotState = 'thinking' | 'solved' | 'failed'
type Point = 'you' | 'bot' | 'none'

interface Totals {
  battles: number
  wins: number
  losses: number
  draws: number
}

interface Records {
  totals: Totals
  vsBot: Record<string, Totals>
}

const ROUNDS = 5
const POINTS_TO_WIN = 3
const ROUND_SECONDS = 90

/** Bot head to head does not think like an engine: it solves or fails on a
 * schedule derived from how its rating compares to the puzzle rating. */
function planBot(bot: Bot, puzzleRating: number): { willSolve: boolean; seconds: number } {
  const edge = bot.rating - puzzleRating // positive: bot is stronger than the puzzle
  const pSolve = Math.min(0.94, Math.max(0.06, 1 / (1 + Math.exp(-edge / 110))))
  const willSolve = Math.random() < pSolve
  const noise = Math.random() * 9
  if (willSolve) {
    const seconds = 7 + 38 / (1 + Math.exp(edge / 110)) + noise
    return { willSolve, seconds: Math.max(5, seconds) }
  }
  // A failed bot grinds on for a while before giving up, sometimes past
  // your own clock: that path is how dead heats happen.
  return { willSolve, seconds: 50 + Math.random() * 25 }
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const r = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[r]] = [arr[r], arr[i]]
  }
  return arr
}

/** Five puzzles near the player's level, avoiding the previous battle's deal. */
function drawBatch(target: number, avoid: Set<string>): Puzzle[] {
  const sorted = [...PUZZLES].sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target))
  const near = sorted.slice(0, Math.min(14, sorted.length)).filter((p) => !avoid.has(p.id))
  const use = shuffle(near.length >= 5 ? near : sorted.slice(0, Math.min(14, sorted.length)))
  return use.slice(0, 5)
}

function recordLabel(t: Totals | undefined): string {
  if (!t || t.battles === 0) return 'First battle'
  return `${t.wins}-${t.losses}-${t.draws}`
}

export function BattlePanel() {
  const { profile, setProfile } = useApp()
  const [phase, setPhase] = useState<Phase>('idle')
  const [bot, setBot] = useState<Bot | null>(null)
  const [batch, setBatch] = useState<Puzzle[]>([])
  const [roundIdx, setRoundIdx] = useState(0)
  const [you, setYou] = useState(0)
  const [botPts, setBotPts] = useState(0)
  const [log, setLog] = useState<Point[]>([])
  const [roundTimeLeft, setRoundTimeLeft] = useState(ROUND_SECONDS)
  const [botState, setBotState] = useState<BotState>('thinking')
  const [botPlanSec, setBotPlanSec] = useState<number | null>(null)
  const [banner, setBanner] = useState<{ kind: Point; text: string } | null>(null)
  const [flashes, setFlashes] = useState<FlashMark[]>([])
  const [fen, setFen] = useState('')
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [records, setRecords] = useState<Records | null>(null)
  const [showAllBots, setShowAllBots] = useState(false)
  const [xpGain, setXpGain] = useState(0)

  const gameRef = useRef(new Chess())
  const plyRef = useRef(0)
  const busyRef = useRef(false)
  const roundTimeRef = useRef(ROUND_SECONDS)
  const tokenRef = useRef(0)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const botPlanRef = useRef<{ willSolve: boolean; seconds: number } | null>(null)
  const botFailedRef = useRef(false)
  const lastDealRef = useRef<Set<string>>(new Set())
  const soundEnabled = profile?.soundEnabled ?? true

  const puzzle = batch[roundIdx] ?? null
  const solverSide = puzzle ? new Chess(puzzle.fen).turn() : 'w'

  const checkSquare = (() => {
    try {
      const g = new Chess(fen)
      if (!g.isCheck()) return null
      return g.board().flat().find((s) => s && s.type === 'k' && s.color === g.turn())?.square ?? null
    } catch {
      return null
    }
  })()

  const suggested = useMemo(() => {
    const target = profile?.puzzleRating ?? 800
    return [...BOTS].sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target)).slice(0, 4)
  }, [profile?.puzzleRating])
  const others = useMemo(() => BOTS.filter((b) => !suggested.includes(b)), [suggested])

  const fetchRecords = useCallback(() => {
    fetch('/api/puzzles/battle')
      .then((r) => readJson<Records>(r))
      .then((d) => {
        if (d && d.totals) setRecords({ totals: d.totals, vsBot: d.vsBot ?? {} })
      })
      .catch(() => {
        /* records are a nicety, battling works without them */
      })
  }, [])

  useEffect(() => {
    fetchRecords()
  }, [fetchRecords])

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t)
    timersRef.current = []
  }, [])

  // Every pending bot/clock/banner timer dies with the component.
  useEffect(() => clearTimers, [clearTimers])

  const finishBattle = useCallback(
    async (finalYou: number, finalBot: number, roundsPlayed: number) => {
      clearTimers()
      setPhase('over')
      try {
        const res = await fetch('/api/puzzles/battle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            botId: bot?.id ?? '',
            you: finalYou,
            bot: finalBot,
            rounds: roundsPlayed,
            dayKey: new Date().toLocaleDateString('sv-SE'),
          }),
        })
        const d = await readJson<{ profile?: ProfileData; xpGain?: number; totals?: Totals; vsBot?: Record<string, Totals> }>(res)
        if (d.profile) setProfile(d.profile)
        if (d.totals) setRecords({ totals: d.totals, vsBot: d.vsBot ?? {} })
        setXpGain(typeof d.xpGain === 'number' ? d.xpGain : 0)
      } catch {
        setXpGain(0)
      }
    },
    [bot, clearTimers, setProfile],
  )

  /** Everything a new round needs, reset from event-handler context (never
   * synchronously inside an effect): board, round clock, bot plan. */
  const beginRound = useCallback((b: Bot, p: Puzzle) => {
    gameRef.current = new Chess(p.fen)
    plyRef.current = 0
    busyRef.current = false
    setFen(p.fen)
    setLastMove(null)
    botFailedRef.current = false
    roundTimeRef.current = ROUND_SECONDS
    setRoundTimeLeft(ROUND_SECONDS)
    setBotState('thinking')
    const plan = planBot(b, p.rating)
    botPlanRef.current = plan
    setBotPlanSec(plan.seconds)
  }, [])

  const resolveRound = useCallback(
    (winner: Point) => {
      if (banner) return
      tokenRef.current += 1 // invalidate every pending bot/clock timer
      clearTimers()
      const text = winner === 'you' ? 'You score.' : winner === 'bot' ? `${bot?.name ?? 'The bot'} scores.` : 'Dead heat. Nobody scores.'
      setBanner({ kind: winner, text })
      if (winner === 'you') playSound('correct', soundEnabled)
      else if (winner === 'bot') playSound('wrong', soundEnabled)
      setLog((l) => [...l, winner])
      const newYou = you + (winner === 'you' ? 1 : 0)
      const newBot = botPts + (winner === 'bot' ? 1 : 0)
      if (winner === 'you') setYou(newYou)
      if (winner === 'bot') setBotPts(newBot)
      const roundsPlayed = roundIdx + 1
      const done = newYou >= POINTS_TO_WIN || newBot >= POINTS_TO_WIN || roundsPlayed >= ROUNDS
      const t = setTimeout(() => {
        setBanner(null)
        if (done) {
          void finishBattle(newYou, newBot, roundsPlayed)
        } else {
          const next = roundIdx + 1
          const p = batch[next]
          if (!p || !bot) {
            void finishBattle(newYou, newBot, roundsPlayed)
            return
          }
          setRoundIdx(next)
          beginRound(bot, p)
        }
      }, 1600)
      timersRef.current.push(t)
    },
    [banner, bot, you, botPts, roundIdx, batch, clearTimers, finishBattle, soundEnabled, beginRound],
  )
  const resolveRef = useRef(resolveRound)
  useEffect(() => {
    resolveRef.current = resolveRound
  }, [resolveRound])

  const startBattle = useCallback(
    (b: Bot) => {
      const target = profile?.puzzleRating ?? 800
      const deal = drawBatch(target, lastDealRef.current)
      if (deal.length === 0) return
      lastDealRef.current = new Set(deal.map((p) => p.id))
      setBatch(deal)
      setBot(b)
      setRoundIdx(0)
      setYou(0)
      setBotPts(0)
      setLog([])
      setBanner(null)
      setXpGain(0)
      playSound('click', soundEnabled)
      setPhase('running')
      beginRound(b, deal[0])
    },
    [profile?.puzzleRating, soundEnabled, beginRound],
  )

  // Bot clock for the current round: only schedules the timeout, all state
  // for the round was reset by beginRound from event-handler context.
  useEffect(() => {
    if (phase !== 'running' || banner || !bot || !puzzle) return
    const token = ++tokenRef.current
    const plan = botPlanRef.current
    if (!plan) return
    const t = setTimeout(() => {
      if (tokenRef.current !== token) return
      if (plan.willSolve) {
        setBotState('solved')
        resolveRef.current('bot')
      } else {
        botFailedRef.current = true
        setBotState('failed')
      }
    }, plan.seconds * 1000)
    timersRef.current.push(t)
    return () => clearTimeout(t)
    // puzzle identity marks the round: batch + roundIdx
  }, [phase, banner, bot, puzzle, batch, roundIdx])

  // Player round clock.
  useEffect(() => {
    if (phase !== 'running' || banner) return
    const iv = setInterval(() => {
      roundTimeRef.current -= 1
      setRoundTimeLeft(Math.max(0, roundTimeRef.current))
      if (roundTimeRef.current <= 0) {
        clearInterval(iv)
        resolveRef.current(botFailedRef.current ? 'none' : 'bot')
      }
    }, 1000)
    return () => clearInterval(iv)
  }, [phase, banner])

  const applyScriptedReply = useCallback((p: Puzzle) => {
    const g = gameRef.current
    const expected = p.solution.split(' ').filter(Boolean)
    const reply = expected[plyRef.current]
    if (!reply) return
    try {
      const rmv = g.move(reply)
      if (rmv) {
        plyRef.current += 1
        setFen(g.fen())
        setLastMove({ from: rmv.from, to: rmv.to })
        playSound(rmv.captured ? 'capture' : 'move', soundEnabled)
      }
    } catch {
      /* validated content */
    }
  }, [soundEnabled])

  const flash = useCallback((marks: FlashMark[], ms = 900) => {
    setFlashes(marks)
    setTimeout(() => setFlashes((cur) => (cur === marks ? [] : cur)), ms)
  }, [])

  const onMove = useCallback(
    (from: Square, to: Square, promotion?: string) => {
      if (phase !== 'running' || banner || busyRef.current || !puzzle) return
      const g = gameRef.current
      let mv
      try {
        mv = g.move({ from, to, promotion: promotion ?? undefined })
      } catch {
        return
      }
      if (!mv) return

      const expected = puzzle.solution.split(' ').filter(Boolean)
      const expectedSan = expected[plyRef.current]?.replace(/[+#]/g, '')
      const sanNorm = mv.san.replace(/[+#]/g, '')

      if (sanNorm !== expectedSan) {
        // one wrong move and the round is gone: battle rules
        g.undo()
        playSound('wrong', soundEnabled)
        busyRef.current = true
        try {
          const probe = new Chess(g.fen())
          const next = probe.move(expected[plyRef.current])
          if (next) flash([{ square: next.from, color: 'gold' }], 800)
        } catch {
          /* validated content */
        }
        const gAtMiss = g
        setTimeout(() => {
          busyRef.current = false
          if (gameRef.current !== gAtMiss) return
          resolveRef.current('bot')
        }, 750)
        return
      }

      plyRef.current += 1
      setFen(g.fen())
      setLastMove({ from: mv.from, to: mv.to })
      playSound(mv.captured ? 'capture' : 'move', soundEnabled)

      const remaining = expected.length - plyRef.current
      if (remaining === 0) {
        busyRef.current = true
        const gAtEnd = g
        setTimeout(() => {
          busyRef.current = false
          if (gameRef.current !== gAtEnd) return
          resolveRef.current('you')
        }, 450)
      } else if (expected[plyRef.current]) {
        busyRef.current = true
        const gAtMove = g
        setTimeout(() => {
          busyRef.current = false
          if (gameRef.current !== gAtMove) return
          applyScriptedReply(puzzle)
        }, 220)
      }
    },
    [phase, banner, puzzle, flash, soundEnabled, applyScriptedReply],
  )

  /* ---------- idle: opponent picker ---------- */

  if (phase === 'idle') {
    const totals = records?.totals
    return (
      <div className="mx-auto max-w-2xl py-8">
        <div className="rounded-xl bg-card p-6 shadow-sm">
          <h2 className="font-display text-xl font-extrabold">Puzzle Battle</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Five rounds, same puzzle for both sides. First to 3 points takes the match. One wrong move hands the round to your opponent, and your clock only gives you {ROUND_SECONDS} seconds a round.
          </p>
          <div className="mt-3 text-sm font-semibold">
            {totals && totals.battles > 0
              ? `Your record: ${totals.wins}W ${totals.losses}L ${totals.draws}D in ${totals.battles} battles`
              : 'No battles yet. Pick an opponent.'}
          </div>

          <div className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Closest to your level</div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {suggested.map((b) => (
              <button
                key={b.id}
                onClick={() => startBattle(b)}
                className="rounded-xl border border-border p-3 text-left transition-all duration-150 hover:border-primary/60 hover:shadow-md active:scale-[0.98]"
              >
                <CharacterFace id={b.id} label={b.name} className="h-12 w-12 rounded-full" />
                <div className="mt-2 font-display text-sm font-bold">{b.name}</div>
                <div className="text-xs text-muted-foreground">{b.rating} puzzles</div>
                <div className="mt-1 text-xs font-semibold text-primary">{recordLabel(records?.vsBot[b.id])}</div>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowAllBots((s) => !s)}
            className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
            aria-expanded={showAllBots}
          >
            {showAllBots ? (
              <>
                Hide the rest <ChevronUp className="h-4 w-4" />
              </>
            ) : (
              <>
                Show the full roster ({BOTS.length - suggested.length} more) <ChevronDown className="h-4 w-4" />
              </>
            )}
          </button>
          {showAllBots && (
            <div className="mt-2 grid max-h-96 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
              {others.map((b) => (
                <button
                  key={b.id}
                  onClick={() => startBattle(b)}
                  className="rounded-xl border border-border p-3 text-left transition-all duration-150 hover:border-primary/60 hover:shadow-md active:scale-[0.98]"
                >
                  <CharacterFace id={b.id} label={b.name} className="h-12 w-12 rounded-full" />
                  <div className="mt-2 font-display text-sm font-bold">{b.name}</div>
                  <div className="text-xs text-muted-foreground">{b.rating} puzzles</div>
                  <div className="mt-1 text-xs font-semibold text-primary">{recordLabel(records?.vsBot[b.id])}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  /* ---------- over: result ---------- */

  if (phase === 'over') {
    const result = you > botPts ? 'win' : you < botPts ? 'loss' : 'draw'
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="rounded-xl bg-card p-6 text-center shadow-sm">
          {result === 'win' && <Trophy className="mx-auto h-10 w-10 text-[var(--gold)]" />}
          {result === 'loss' && <Swords className="mx-auto h-10 w-10 text-destructive" />}
          {result === 'draw' && <Timer className="mx-auto h-10 w-10 text-muted-foreground" />}
          <div className="mt-3 font-display text-4xl font-extrabold tabular-nums">
            {you} - {botPts}
          </div>
          <div className="text-sm text-muted-foreground">
            {result === 'win' ? `You beat ${bot?.name} (${bot?.rating})` : result === 'loss' ? `${bot?.name} (${bot?.rating}) took it` : `Split with ${bot?.name} (${bot?.rating})`}
          </div>
          {bot && records?.vsBot[bot.id] && (
            <div className="mt-1 text-xs text-muted-foreground">
              All time vs {bot.name}: {recordLabel(records.vsBot[bot.id])}
            </div>
          )}
          <div className="mt-4 flex items-center justify-center gap-1.5" aria-label="Round by round">
            {log.map((p, i) => (
              <span
                key={i}
                title={p === 'you' ? 'Your round' : p === 'bot' ? `${bot?.name ?? 'Bot'} round` : 'Dead heat'}
                className={cn('h-3 w-3 rounded-full', p === 'you' ? 'bg-primary' : p === 'bot' ? 'bg-destructive' : 'bg-muted')}
              />
            ))}
          </div>
          {xpGain > 0 && <div className="mt-3 text-sm font-semibold">+{xpGain} XP</div>}
          <div className="mt-6 flex justify-center gap-2">
            <Button className="btn-hero" onClick={() => bot && startBattle(bot)}>
              <Swords className="h-4 w-4" /> Rematch
            </Button>
            <Button variant="secondary" onClick={() => setPhase('idle')}>
              New opponent
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!puzzle || !bot) return null

  /* ---------- running ---------- */

  const timeLabel = `${Math.floor(roundTimeLeft / 60)}:${String(roundTimeLeft % 60).padStart(2, '0')}`
  const elapsedInRound = ROUND_SECONDS - roundTimeLeft
  const botProgress = botPlanSec ? Math.min(100, (elapsedInRound / botPlanSec) * 100) : 0

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="relative mx-auto w-full max-w-[600px]">
        <ChessBoard
          fen={fen}
          orientation={solverSide}
          onMove={onMove}
          movableSide={solverSide}
          interactive
          lastMove={lastMove}
          checkSquare={checkSquare}
          flashes={flashes}
          theme={profile?.theme ?? 'green'}
        />
        {banner && (
          <div
            role="status"
            className={cn(
              'pointer-events-none absolute inset-x-0 top-2 mx-auto w-fit rounded-md px-3 py-1 text-sm font-bold text-white shadow',
              banner.kind === 'you' ? 'bg-primary' : banner.kind === 'bot' ? 'bg-destructive' : 'bg-muted-foreground',
            )}
          >
            {banner.text}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {/* opponent card */}
        <div className="rounded-lg bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <CharacterFace id={bot.id} label={bot.name} className="h-12 w-12 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-sm font-bold">{bot.name}</span>
                <span className="text-xs text-muted-foreground">{bot.rating}</span>
              </div>
              <div className="mt-1 text-xs font-semibold">
                {botState === 'thinking' && <span className="text-muted-foreground">Thinking…</span>}
                {botState === 'failed' && <span className="text-destructive">Failed this one.</span>}
                {botState === 'solved' && <span className="text-primary">Solved it.</span>}
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn('h-full transition-all duration-1000 ease-linear', botState === 'failed' ? 'bg-transparent' : 'bg-primary/70')}
                  style={{ width: `${botState === 'thinking' ? botProgress : botState === 'solved' ? 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* scoreboard */}
        <div className="rounded-lg bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Battle · round {Math.min(roundIdx + 1, ROUNDS)} of {ROUNDS}</div>
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="font-mono font-display text-4xl font-extrabold tabular-nums">
              {you} - {botPts}
            </span>
            <span className="flex items-center gap-1 text-sm font-bold">
              <Timer className="h-4 w-4" /> {timeLabel}
            </span>
          </div>
          <div className="mt-3 text-sm">
            <span className="font-bold">{solverSide === 'w' ? 'White' : 'Black'} to play</span>
            <span className="text-muted-foreground"> · first to {POINTS_TO_WIN}</span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${(roundTimeLeft / ROUND_SECONDS) * 100}%` }} />
          </div>
          <div className="mt-3 flex items-center gap-1.5" aria-label="Rounds so far">
            {log.map((p, i) => (
              <span
                key={i}
                className={cn('h-2.5 w-2.5 rounded-full', p === 'you' ? 'bg-primary' : p === 'bot' ? 'bg-destructive' : 'bg-muted')}
              />
            ))}
          </div>
        </div>

        <div className="rounded-lg bg-card p-4 text-xs text-muted-foreground shadow-sm">
          One wrong move ends the round in the opponent&rsquo;s favor. If both of you fail, nobody scores. Battle never touches your puzzle rating.
        </div>
      </div>
    </div>
  )
}
