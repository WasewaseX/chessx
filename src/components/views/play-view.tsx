'use client'
import { readJson } from '@/lib/api-client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type Arrow } from '@/components/chess/board'
import { MoveList } from '@/components/chess/move-list'
import { BOTS, botForLevel, type Bot } from '@/lib/chess/bots'
import { SPARRING_ROSTER, personaForBot, progressFor, nextUpLevel, titleCardFor, type SparringGameRow } from '@/lib/chess/sparring-roster'
import { CharacterFace } from '@/components/chess/characters'
import { engine } from '@/lib/chess/engine-client'
import { playSound } from '@/lib/chess/sounds'
import { useApp, overallRating, type PoolRating, type ProfileData } from '@/lib/store'
import { tcLabel } from '@/lib/rating'
import { BoardEditor } from '@/components/chess/board-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { pickBark } from '@/lib/chess/bots'
import { connectGameService, getSocketSafe, type GameOverView, type GameStateView, type OnlineGameView } from '@/lib/online-client'
import { ArrowLeft, ClipboardPaste, Flag, Handshake, Lightbulb, Play, Puzzle, RefreshCw, Search, SquareStack, Trash2, Undo2, Volume2, VolumeX, X, Globe, Bot as BotIcon, Loader2 } from 'lucide-react'

type Phase = 'lobby' | 'playing' | 'over'

interface Setup {
  bot: Bot
  playerColor: 'w' | 'b'
  /** Play from a pasted/saved position instead of the standard start. */
  fen?: string
}

interface GameEnd {
  result: 'win' | 'loss' | 'draw'
  reason: string
}

/** A Chess instance from an optional FEN, falling back to the standard start. */
function safeChess(fen?: string): Chess {
  if (!fen || !fen.trim()) return new Chess()
  try {
    return new Chess(fen.trim())
  } catch {
    return new Chess()
  }
}

function BotFace({ bot, className }: { bot: Bot; className?: string }) {
  return <CharacterFace id={bot.id} label={bot.name} className={cn('shrink-0 rounded-full', className)} />
}

function initials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/* ---------------- cockpit primitives (fullscreen stable board) ----------------
 * The in-game layouts are built from FIXED-SIZE slots (see the "Fullscreen
 * stable board cockpit" section in globals.css). Plates, captured rows and
 * the clock chips below always render — captures and status swaps fill slots
 * that already exist, so the board itself can never move. */

/** One player plate: fixed-height card with identity on the left, chips
 * (clock / game mode) on the right. Rendered for BOTH players at all times. */
function CockpitPlate({ left, right, className }: { left: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'cockpit-plate flex min-w-0 items-center justify-between gap-2 rounded-lg bg-card px-2.5 shadow-sm ring-1 ring-inset ring-border/60',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">{left}</div>
      {right != null && <div className="flex shrink-0 items-center gap-1.5">{right}</div>}
    </div>
  )
}

/** Mono clock chip (chess.com style): tabular digits, the side on move gets
 * the green face, under ten seconds reads red no matter whose turn it is. */
function ClockChip({ ms, active, label }: { ms: number; active: boolean; label: string }) {
  const face = active ? 'bg-primary' : 'bg-secondary'
  const tone = ms < 10_000 ? 'text-destructive' : active ? 'text-primary-foreground' : 'text-secondary-foreground'
  return (
    <div
      className={cn('rounded-md px-3 py-1 font-mono text-lg font-bold leading-6 tabular-nums transition-colors sm:text-xl', face, tone)}
      aria-label={`${label} clock: ${formatClock(ms)}${active ? ', running' : ''}`}
    >
      {formatClock(ms)}
    </div>
  )
}

const CAPTURE_ORDER = ['q', 'r', 'b', 'n', 'p'] as const
const CAPTURE_VALUES: Record<string, number> = { q: 9, r: 5, b: 3, n: 3, p: 1 }

interface CapturedSummary {
  /** captured piece types in display order (most valuable first) */
  rows: { type: string; count: number }[]
  /** material balance from `capturator`'s point of view, in pawns */
  diff: number
}

/** What `capturator` has taken from the board (start counts minus what is
 * still standing), plus the material spread between the two sides. */
function capturedSummary(fen: string, capturator: 'w' | 'b'): CapturedSummary {
  const start: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 }
  const missing: Record<'w' | 'b', Record<string, number>> = { w: { ...start }, b: { ...start } }
  try {
    const g = new Chess(fen)
    for (const row of g.board()) {
      for (const sq of row) {
        if (!sq || sq.type === 'k') continue
        missing[sq.color][sq.type]--
      }
    }
  } catch {
    return { rows: [], diff: 0 }
  }
  // pieces captured BY capturator = pieces of the opposite color that vanished
  const mine = capturator === 'w' ? missing.b : missing.w
  const theirs = capturator === 'w' ? missing.w : missing.b
  const value = (m: Record<string, number>) => CAPTURE_ORDER.reduce((s, t) => s + Math.max(0, m[t]) * CAPTURE_VALUES[t], 0)
  const rows = CAPTURE_ORDER.filter((t) => mine[t] > 0).map((t) => ({ type: t, count: mine[t] }))
  return { rows, diff: value(mine) - value(theirs) }
}

/** Captured-material slot for ONE side: mini overlapping piece icons plus a
 * +N badge when that side is ahead in material. ALWAYS rendered (fixed 18px
 * cockpit slot); with no captures yet it is an intentional empty row. */
function CapturedSlot({ fen, capturator, className }: { fen: string; capturator: 'w' | 'b'; className?: string }) {
  const { rows, diff } = useMemo(() => capturedSummary(fen, capturator), [fen, capturator])
  const pieceColor = capturator === 'w' ? 'b' : 'w'
  const label = rows.length
    ? `Captured: ${rows.map((r) => `${r.count}${r.type}`).join(', ')}`
    : 'No pieces captured yet'
  return (
    <div className={cn('flex min-w-0 items-center', className)} role="img" aria-label={label}>
      {rows.flatMap(({ type, count }) =>
        Array.from({ length: count }, (_, i) => (
          <img
            key={`${type}-${i}`}
            src={`/pieces/${pieceColor}${type.toUpperCase()}.svg`}
            alt=""
            className="piece-img -ml-1.5 h-4 w-4 first:ml-0"
            draggable={false}
          />
        )),
      )}
      {diff > 0 && <span className="ml-1.5 shrink-0 text-[10px] font-bold leading-none text-muted-foreground">+{diff}</span>}
    </div>
  )
}

export function PlayView() {
  const { profile, setProfile, navigate, setReviewPgn, setReviewGameId } = useApp()
  // A "replay from the turning move" request (set by the Analysis view) is
  // consumed at first render: the lobby never flashes, the game just starts.
  const incomingRequest = useApp.getState().playRequest
  // Sidebar sub-tabs deep-link the lobby section (#/play/online, #/play/bots).
  const deepLink = useApp((s) => s.view.lessonId)
  const [tab, setTab] = useState<'online' | 'bots'>(deepLink === 'bots' ? 'bots' : 'online')
  const [phase, setPhase] = useState<Phase>(incomingRequest ? 'playing' : 'lobby')
  const [setup, setSetup] = useState<Setup | null>(() => {
    if (!incomingRequest) return null
    const bot = (incomingRequest.botLevel != null ? botForLevel(incomingRequest.botLevel) : null) ?? BOTS[Math.min(3, BOTS.length - 1)]
    return { bot, playerColor: incomingRequest.color, fen: incomingRequest.fen }
  })
  const [colorChoice, setColorChoice] = useState<'w' | 'b' | 'random'>('random')
  // bumped on every startGame so a rematch against the same bot still gets a
  // fresh GameScreen (the key must change or the old game state sticks around)
  const [matchNo, setMatchNo] = useState(incomingRequest ? 1 : 0)

  // one-shot: clear the request so a later lobby visit does not restart it
  useEffect(() => {
    if (useApp.getState().playRequest) useApp.getState().setPlayRequest(null)
  }, [])

  const startGame = useCallback(
    (bot: Bot, fen?: string, forcedColor?: 'w' | 'b') => {
      const color: 'w' | 'b' = forcedColor ?? (colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorChoice)
      setSetup({ bot, playerColor: color, fen: fen && fen.trim() ? fen.trim() : undefined })
      setMatchNo((n) => n + 1)
      setPhase('playing')
    },
    [colorChoice],
  )

  if (phase === 'playing' && setup) {
    return (
      <GameScreen
        key={`${setup.bot.id}-${matchNo}`}
        setup={setup}
        theme={profile?.theme ?? 'green'}
        onExit={(rematch) => {
          if (rematch) startGame(setup.bot, setup.fen)
          else setPhase('lobby')
        }}
        onReview={(pgn, gameId) => {
          setReviewPgn(pgn)
          setReviewGameId(gameId)
          navigate('analysis')
        }}
        setProfile={setProfile}
        playerName={profile?.name ?? 'You'}
        soundEnabled={profile?.soundEnabled ?? true}
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-5 flex items-center gap-4">
        <button onClick={() => window.history.back()} className="hidden items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground lg:flex">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="font-display text-2xl font-extrabold">Play</h1>
      </div>

      {/* mode tabs, chess.com style */}
      <div className="mb-5 grid grid-cols-2 gap-3">
        <button
          onClick={() => setTab('online')}
          className={cn(
            'group flex items-center gap-3 rounded-xl border-2 bg-card p-4 text-left transition-all duration-150 active:scale-[0.99]',
            tab === 'online' ? 'border-primary shadow-md' : 'border-transparent opacity-75 hover:opacity-100',
          )}
        >
          <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-white', tab === 'online' ? 'bg-primary' : 'bg-muted-foreground/40')}>
            <Globe className="h-6 w-6" />
          </span>
          <span>
            <span className="block font-display text-lg font-extrabold">Online</span>
            <span className="block text-xs text-muted-foreground">Rated games, real opponents, Glicko rating</span>
          </span>
        </button>
        <button
          onClick={() => setTab('bots')}
          className={cn(
            'group flex items-center gap-3 rounded-xl border-2 bg-card p-4 text-left transition-all duration-150 active:scale-[0.99]',
            tab === 'bots' ? 'border-primary shadow-md' : 'border-transparent opacity-75 hover:opacity-100',
          )}
        >
          <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-white', tab === 'bots' ? 'bg-primary' : 'bg-muted-foreground/40')}>
            <BotIcon className="h-6 w-6" />
          </span>
          <span>
            <span className="block font-display text-lg font-extrabold">Bots</span>
            <span className="block text-xs text-muted-foreground">Casual practice, {BOTS.length} characters, est. Elo</span>
          </span>
        </button>
      </div>

      {tab === 'online' ? (
        <OnlineLobby />
      ) : (
        <BotsLobby
          colorChoice={colorChoice}
          setColorChoice={setColorChoice}
          onPlay={startGame}
          botGames={profile?.botGames ?? 0}
          botElo={profile?.botElo ?? 0}
          botEloGames={profile?.botEloGames ?? 0}
        />
      )}
    </div>
  )
}

const TIME_CARDS: { tc: string; label: string; pool: string; top: string }[] = [
  { tc: '1+0', label: 'Bullet', pool: 'bullet', top: '1' },
  { tc: '3+0', label: 'Blitz', pool: 'blitz', top: '3' },
  { tc: '3+2', label: 'Blitz', pool: 'blitz', top: '3 | 2' },
  { tc: '5+0', label: 'Blitz', pool: 'blitz', top: '5' },
  { tc: '10+0', label: 'Rapid', pool: 'rapid', top: '10' },
  { tc: '15+10', label: 'Rapid', pool: 'rapid', top: '15 | 10' },
]

function OnlineLobby() {
  const { ratings, user, setRatings, navigate, setReviewPgn, setReviewGameId } = useApp()
  const [queueTc, setQueueTc] = useState<string | null>(null)
  const [queueError, setQueueError] = useState<string | null>(null)
  const [game, setGame] = useState<OnlineGameView | null>(null)
  const [over, setOver] = useState<GameOverView | null>(null)
  const [connectFail, setConnectFail] = useState(false)
  const elo = overallRating(ratings)

  // one socket per view; server rejoins a live game after refresh
  useEffect(() => {
    let alive = true
    const handlers: [string, (d: never) => void][] = []
    connectGameService()
      .then((sock) => {
        if (!alive) return
        const on = (ev: string, fn: (d: never) => void) => {
          handlers.push([ev, fn])
          sock.on(ev, fn as never)
        }
        on('match:found', (d: unknown) => {
          const { game } = d as { game: OnlineGameView }
          setQueueTc(null)
          setGame(game)
        })
        on('game:over', (d: unknown) => {
          setQueueTc(null)
          setOver(d as GameOverView)
          fetch('/api/auth/me')
            .then((r) => readJson<{ ratings?: PoolRating[] }>(r))
            .then((me) => {
              if (Array.isArray(me.ratings)) setRatings(me.ratings)
            })
            .catch(() => {})
        })
        on('queue:error', (d: unknown) => {
          setQueueTc(null)
          setQueueError((d as { error?: string }).error ?? 'Could not join the queue')
        })
        on('connect_fail', () => setConnectFail(true))
      })
      .catch(() => alive && setConnectFail(true))
    return () => {
      alive = false
      const s = getSocketSafe()
      if (s) {
        s.emit('queue:leave')
        for (const [ev, fn] of handlers) s.off(ev, fn as never)
      }
    }
  }, [setRatings])

  async function joinQueue(tc: string) {
    setQueueError(null)
    const s = await connectGameService().catch(() => null)
    if (!s) {
      setConnectFail(true)
      return
    }
    setQueueTc(tc)
    s.emit('queue:join', { tc })
  }

  function cancelQueue() {
    getSocketSafe()?.emit('queue:leave')
    setQueueTc(null)
  }

  if (game) {
    return (
      <OnlineGameScreen
        game={game}
        onOver={setOver}
        onExit={() => {
          setGame(null)
          setOver(null)
        }}
        onReview={(pgn) => {
          setReviewPgn(pgn)
          setReviewGameId(null)
          navigate('analysis')
        }}
      />
    )
  }

  if (queueTc) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl bg-card py-16 shadow-sm">
        <div className="relative flex h-24 w-24 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" />
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-white">
            <Search className="h-8 w-8" />
          </span>
        </div>
        <p className="mt-6 font-display text-lg font-bold">Looking for an opponent</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {TIME_CARDS.find((c) => c.tc === queueTc)?.label} · {queueTc}
        </p>
        <Button variant="secondary" className="mt-6 px-8" onClick={cancelQueue}>
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4 rounded-lg bg-card px-6 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-white">
            {initials(user?.username ?? 'You')}
          </div>
          <div>
            <div className="text-sm font-bold">{user?.username ?? 'You'}</div>
            <div className="text-xs text-muted-foreground">
              {elo && elo.games > 0 ? `${elo.games} rated ${elo.games === 1 ? 'game' : 'games'}` : 'Only rated online games move it'}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Elo</div>
          <div className="font-display text-2xl font-extrabold leading-6">
            {elo ? (
              <>
                {elo.rating}
                {elo.games < 5 && <span className="text-muted-foreground">?</span>}
              </>
            ) : (
              '-'
            )}
          </div>
          {elo && elo.games > 0 && (
            <div className="text-[10px] text-muted-foreground">
              {elo.wins}W {elo.losses}L {elo.draws}D
            </div>
          )}
        </div>
      </div>

      {connectFail && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          The game service is not reachable right now. Refresh to retry.
        </div>
      )}
      {queueError && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{queueError}</div>
      )}

      <h2 className="mb-3 font-display text-lg font-bold">Pick a time control</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {TIME_CARDS.map((c) => (
          <button
            key={c.tc}
            onClick={() => joinQueue(c.tc)}
            className="pressable group rounded-xl bg-card p-4 text-left shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-3xl font-extrabold">{c.top}</span>
              <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{c.label}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{c.tc}</div>
            <div className="mt-2 text-[10px] font-bold uppercase tracking-wide text-primary/80">Rated</div>
          </button>
        ))}
      </div>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        One Elo for every time control, updated only by rated online games (Glicko). 1000* is the starting value until your first rated game. Quitting a live game counts as a loss.
      </p>
    </div>
  )
}

function OnlineGameScreen({
  game,
  onOver,
  onExit,
  onReview,
}: {
  game: OnlineGameView & { lastMoveOnline?: { from: string; to: string } | null }
  onOver: (d: GameOverView) => void
  onExit: () => void
  onReview: (pgn: string) => void
}) {
  const { profile } = useApp()
  const socket = useMemo(() => getSocketSafe(), [])
  const gameRef = useRef(new Chess(game.fen))
  const [fen, setFen] = useState(game.fen)
  const [moves, setMoves] = useState<string[]>(game.moves)
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(game.lastMoveOnline ?? null)
  const [whiteMs, setWhiteMs] = useState(game.whiteMs ?? game.initialSec * 1000)
  const [blackMs, setBlackMs] = useState(game.blackMs ?? game.initialSec * 1000)
  const [turn, setTurn] = useState<'w' | 'b'>(game.turn ?? 'w')
  const [checkSq, setCheckSq] = useState<string | null>(null)
  const [over, setOver] = useState<GameOverView | null>(null)
  const [drawOffer, setDrawOffer] = useState<'w' | 'b' | null>(game.drawOfferBy ?? null)
  const [oppGone, setOppGone] = useState<number | null>(null)
  const [exited, setExited] = useState(false)
  const soundEnabled = profile?.soundEnabled ?? true
  const myColor = game.color
  const orientation = myColor
  const lastTickRef = useRef(Date.now())

  const applyServerState = useCallback((st: GameStateView) => {
    try {
      const g = new Chess(st.fen)
      gameRef.current = g
    } catch {
      return
    }
    gameRef.current = new Chess(st.fen)
    const hist = gameRef.current.history({ verbose: true })
    const lm = hist.at(-1)
    setLastMove(lm ? { from: lm.from, to: lm.to } : null)
    setFen(st.fen)
    setMoves(st.moves)
    setWhiteMs(st.whiteMs)
    setBlackMs(st.blackMs)
    setTurn(st.turn)
    lastTickRef.current = Date.now()
    setCheckSq(checkSquareOf(st.fen, st.check))
    if (st.check && gameRef.current.turn() === myColor) playSound('check', soundEnabled)
    else if (lm) playSound(lm.captured ? 'capture' : 'move', soundEnabled)
  }, [myColor, soundEnabled])

  useEffect(() => {
    const s = socket
    if (!s) return
    const onState = (st: GameStateView) => {
      applyServerState(st)
    }
    const onOver = (d: GameOverView) => {
      setOver(d)
      onOver(d)
      playSound(d.result === '1/2-1/2' ? 'gameEnd' : (d.color === 'w' ? d.result === '1-0' : d.result === '0-1') ? 'win' : 'lose', soundEnabled)
    }
    const onDrawOffered = (d: { by: 'w' | 'b' }) => setDrawOffer(d.by)
    const onDrawDeclined = () => setDrawOffer(null)
    const onOppGone = (d: { graceMs: number }) => setOppGone(d.graceMs)
    const onOppBack = () => setOppGone(null)
    const onAborted = () => {
      onExit()
    }
    s.on('game:state', onState)
    s.on('game:over', onOver)
    s.on('draw:offered', onDrawOffered)
    s.on('draw:declined', onDrawDeclined)
    s.on('opponent:disconnected', onOppGone)
    s.on('opponent:connected', onOppBack)
    s.on('game:aborted', onAborted)
    return () => {
      s.off('game:state', onState)
      s.off('game:over', onOver)
      s.off('draw:offered', onDrawOffered)
      s.off('draw:declined', onDrawDeclined)
      s.off('opponent:disconnected', onOppGone)
      s.off('opponent:connected', onOppBack)
      s.off('game:aborted', onAborted)
    }
  }, [socket, applyServerState, onOver, onExit, soundEnabled])

  // local clock interpolation between server updates
  useEffect(() => {
    if (over) return
    const iv = setInterval(() => {
      const now = Date.now()
      const dt = now - lastTickRef.current
      lastTickRef.current = now
      if (turn === 'w') setWhiteMs((ms) => Math.max(0, ms - dt))
      else setBlackMs((ms) => Math.max(0, ms - dt))
    }, 200)
    return () => clearInterval(iv)
  }, [turn, over])

  const onPlayerMove = useCallback(
    (from: Square, to: Square, promotion?: string) => {
      if (over || turn !== myColor) return
      const s = socket
      if (!s) return
      s.emit('move:make', { gameId: game.id, from, to, promotion: promotion === 'q' || promotion === 'r' || promotion === 'b' || promotion === 'n' ? promotion : 'q' })
    },
    [over, turn, myColor, socket, game.id],
  )

  const resign = useCallback(() => {
    socket?.emit('resign', { gameId: game.id })
  }, [socket, game.id])

  const offerDraw = useCallback(() => {
    socket?.emit('draw:offer', { gameId: game.id })
  }, [socket, game.id])

  const acceptDraw = useCallback(() => {
    socket?.emit('draw:accept', { gameId: game.id })
  }, [socket, game.id])

  if (exited) return null

  const myClock = myColor === 'w' ? whiteMs : blackMs
  const oppClock = myColor === 'w' ? blackMs : whiteMs
  const myTurn = turn === myColor && !over
  const opp = game.opponent
  const oppColor = myColor === 'w' ? 'b' : 'w'

  return (
    <div className="cockpit-shell mx-auto w-full max-w-6xl px-2 py-3 pb-20 sm:px-3 lg:py-1.5">
      <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1 lg:flex-row lg:gap-4">
        {/* board column: fixed slots top-to-bottom; the board area takes the rest */}
        <div className="board-cockpit mx-auto w-full max-w-[640px] min-w-0 flex-1 lg:max-w-none">
          {/* opponent plate — FIXED slot, always rendered (identity left, mono clock right) */}
          <CockpitPlate
            className="mb-1.5"
            left={
              <>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-extrabold text-secondary-foreground">
                  {initials(opp.username)}
                </div>
                <div className="min-w-0 leading-tight">
                  <div className="truncate text-sm font-bold">
                    {opp.username}{' '}
                    <span className="font-normal text-muted-foreground">
                      ({opp.rating}
                      {opp.provisional ? '?' : ''})
                    </span>
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {oppGone ? 'Disconnected, may claim win' : `${tcLabel(game.initialSec, game.incSec)} · Rated`}
                  </div>
                </div>
              </>
            }
            right={<ClockChip ms={oppClock} active={turn !== myColor && !over} label="Opponent's" />}
          />

          {/* opponent captured slot — FIXED row, renders empty until a capture */}
          <CapturedSlot fen={fen} capturator={oppColor} className="cockpit-captured mb-0.5" />

          <div className="cockpit-board-area">
            <div className="cockpit-board">
              <ChessBoard
                fen={fen}
                orientation={orientation}
                onMove={onPlayerMove}
                movableSide={over ? undefined : myColor}
                interactive={!over}
                lastMove={lastMove}
                checkSquare={checkSq}
                showLegal={myTurn}
                theme={profile?.theme ?? 'green'}
                className="h-full w-full"
              />
            </div>
          </div>

          {/* my captured slot — FIXED row, renders empty until a capture */}
          <CapturedSlot fen={fen} capturator={myColor} className="cockpit-captured mt-0.5" />

          {/* my plate — FIXED slot, always rendered */}
          <CockpitPlate
            className="mt-1.5"
            left={
              <>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-extrabold text-white">
                  {initials(game.color === 'w' ? game.white.username : game.black.username)}
                </div>
                <div className="min-w-0 leading-tight">
                  <div className="truncate text-sm font-bold">You</div>
                  <div className="truncate text-[11px] text-muted-foreground">{myTurn ? 'Your move' : 'Waiting'}</div>
                </div>
              </>
            }
            right={<ClockChip ms={myClock} active={myTurn} label="Your" />}
          />
        </div>

        {/* side panel: fixed width, matched to the board column height, own scroll */}
        <div className="w-full shrink-0 rounded-lg bg-card shadow-sm lg:flex lg:min-h-0 lg:w-80 lg:flex-col">
          <div className="flex flex-none items-center justify-between border-b border-border px-4 py-2.5">
            <span className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">Moves</span>
            <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
              {tcLabel(game.initialSec, game.incSec)} · rated
            </span>
          </div>
          <MoveList moves={moves} maxHeightClass="max-h-72 lg:max-h-none" className="sb-stable min-h-0 flex-1" />
          <div className="flex flex-none gap-2 border-t border-border p-3">
            <Button variant="destructive" className="min-h-11 flex-1 lg:min-h-9" onClick={resign} disabled={Boolean(over)}>
              <Flag className="h-4 w-4" /> Resign
            </Button>
            <Button variant="secondary" className="min-h-11 flex-1 lg:min-h-9" onClick={offerDraw} disabled={Boolean(over)}>
              <Handshake className="h-4 w-4" /> Draw
            </Button>
          </div>
          {drawOffer && drawOffer !== myColor && (
            <div className="mx-3 mb-3 flex items-center justify-between rounded-md border border-border bg-secondary/60 px-3 py-2 text-sm">
              <span className="font-semibold">Opponent offers a draw</span>
              <div className="flex gap-1">
                <Button size="sm" className="h-11 px-3 lg:h-8" onClick={acceptDraw}>
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-11 px-2 lg:h-8"
                  aria-label="Decline draw"
                  onClick={() => {
                    socket?.emit('draw:decline', { gameId: game.id })
                    setDrawOffer(null)
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* end dialog: no close affordance, the two actions below are the way out.
          NOTE: onEscapeKeyDown belongs to DialogContent (Radix), not Dialog root;
          passing it here was silently ignored, so it is simply omitted. */}
      <Dialog open={Boolean(over)}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-extrabold">
              {over ? (over.result === '1/2-1/2' ? 'Draw' : (over.color === 'w') === (over.result === '1-0') ? 'You won' : 'You lost') : ''}
            </DialogTitle>
            <DialogDescription>
              {over ? `By ${over.termination}${over.rated ? ' · rated' : ''}` : ''}
            </DialogDescription>
          </DialogHeader>
          {over?.myDelta != null && (
            <div className="flex items-center justify-center gap-3 rounded-lg bg-secondary/60 py-4">
              <span className="font-display text-3xl font-extrabold">{over.myNewRating}</span>
              <span className={cn('font-display text-xl font-bold', over.myDelta >= 0 ? 'text-primary' : 'text-destructive')}>
                {over.myDelta >= 0 ? '+' : ''}
                {over.myDelta}
              </span>
            </div>
          )}
          {over?.myDelta == null && (
            <p className="text-center text-sm text-muted-foreground">Too short to rate, no rating change.</p>
          )}
          <div className="mt-2 flex flex-col gap-2">
            <Button className="btn-hero w-full py-3" onClick={() => over && onReview(over.pgn)}>
              <Lightbulb className="h-4 w-4" /> Game review
            </Button>
            <Button variant="secondary" className="w-full py-2.5" onClick={onExit}>
              Back to lobby
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function checkSquareOf(fen: string, check: boolean): string | null {
  if (!check) return null
  try {
    const g = new Chess(fen)
    const turn = g.turn()
    for (const row of g.board()) {
      for (const sq of row) {
        if (sq && sq.type === 'k' && sq.color === turn) return sq.square
      }
    }
  } catch {
    /* noop */
  }
  return null
}

function BotsLobby({
  colorChoice,
  setColorChoice,
  onPlay,
  botGames,
  botElo,
  botEloGames,
}: {
  colorChoice: 'w' | 'b' | 'random'
  setColorChoice: (v: 'w' | 'b' | 'random') => void
  onPlay: (bot: Bot, fen?: string) => void
  botGames: number
  botElo: number
  botEloGames: number
}) {
  // Real games from the existing endpoint: the persona cards show the actual
  // W/L record against each bot. Recent window (last 50 recorded games), read
  // once when the lobby opens; a failed load simply hides the badges.
  const [botRows, setBotRows] = useState<BotGameRow[] | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/games?limit=50')
      .then((r) => (r.ok ? readJson<{ games?: BotGameRow[] }>(r) : { games: [] }))
      .then((d) => {
        if (alive) setBotRows((d.games ?? []).filter((g) => g.kind === 'bot'))
      })
      .catch(() => {
        if (alive) setBotRows([])
      })
    return () => {
      alive = false
    }
  }, [])

  const rowsByBot = useMemo(() => {
    const map = new Map<string, SparringGameRow[]>()
    for (const g of botRows ?? []) {
      const list = map.get(g.opponent) ?? []
      list.push(g)
      map.set(g.opponent, list)
    }
    return map
  }, [botRows])
  const nextUp = useMemo(() => nextUpLevel((botRows ?? []).map((g) => ({ result: g.result, botName: g.opponent }))), [botRows])
  const personaOf = useMemo(() => new Map(SPARRING_ROSTER.map((p) => [p.level, p])), [])
  // chess.com-style ladder: the player's estimated Elo card sits in the list
  // exactly where their number falls between the bots
  const you: { key: string; rating: number; el: React.ReactNode; bot?: Bot } = {
    key: 'you',
    rating: botElo || 800,
    el: (
      <div
        key="you"
        className="flex items-center gap-3 rounded-lg border-2 border-primary/60 bg-primary/5 p-4 shadow-sm"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary px-1 text-center text-xs font-extrabold uppercase leading-tight text-white">
          You
        </span>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-bold">You</span>
            <span className="whitespace-nowrap text-sm font-semibold text-primary">
              {botElo ? botElo : 'not rated yet'}
            </span>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {botElo
              ? `Estimated Elo from ${botEloGames} bot game${botEloGames === 1 ? '' : 's'}`
              : 'Play a bot and your estimated Elo starts there'}
          </div>
        </div>
      </div>
    ),
  }
  const ladder = [...BOTS.map((b) => ({ key: `bot-${b.level}`, rating: b.rating, el: null as React.ReactNode, bot: b })), you]
    .sort((a, b) => a.rating - b.rating)

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-card px-6 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-semibold">Side</Label>
          <div className="flex overflow-hidden rounded-md border">
            {(['w', 'random', 'b'] as const).map((c) => (
              <button
                key={c}
                onClick={() => setColorChoice(c)}
                className={cn(
                  'px-3 py-1.5 text-sm font-semibold transition-transform active:scale-95',
                  colorChoice === c ? 'bg-primary text-primary-foreground' : 'bg-secondary',
                )}
              >
                {c === 'w' ? 'White' : c === 'b' ? 'Black' : 'Random'}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Casual games that only move your estimated Elo (K=32){botGames > 0 ? ` · ${botGames} played` : ''}. Online rating stays untouched.
        </p>
      </div>

      <PositionLab onPlay={onPlay} colorChoice={colorChoice} />

      <h2 className="mb-3 font-display text-lg font-bold">Opponents</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ladder.map((row) =>
          row.el ? (
            row.el
          ) : (
            <button
              key={row.key}
              onClick={() => onPlay(row.bot!)}
              className="pressable group flex items-start gap-3 rounded-lg bg-card p-4 text-left shadow-sm transition-shadow hover:shadow-md"
            >
              <BotFace bot={row.bot!} className="h-12 w-12 shrink-0 border border-border/60 bg-secondary" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate font-bold">{row.bot!.name}</span>
                  <span className="whitespace-nowrap text-sm text-muted-foreground">
                    est. {row.bot!.rating}
                  </span>
                  {nextUp === row.bot!.level && (
                    <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-primary-foreground">
                      Next up
                    </span>
                  )}
                </div>
                <div className="truncate text-xs font-medium text-foreground/80">{personaOf.get(row.bot!.level)?.flavor ?? row.bot!.description}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                      STYLE_CHIP[personaForBot(row.bot!).style] ?? 'bg-secondary text-secondary-foreground',
                    )}
                  >
                    {personaForBot(row.bot!).style}
                  </span>
                  {personaForBot(row.bot!).blunderProne && (
                    <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      human-like
                    </span>
                  )}
                  {(() => {
                    const rec = progressFor(row.bot!.level, rowsByBot.get(row.bot!.name) ?? [])
                    return <PersonaRecordBadge wins={rec.wins} losses={rec.losses} draws={rec.draws} played={rec.played} />
                  })()}
                </div>
              </div>
            </button>
          ),
        )}
      </div>
    </div>
  )
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={className}>{children}</span>
}

/* ---------------- sparring persona cards ----------------
 * The ladder order and the "You" card are unchanged. Each bot card becomes a
 * persona: characterful flavor line, play-style tag, a human-like tag for the
 * blunder-prone bottom half of the ladder, and the real W/L record from the
 * player's recorded games (existing /api/games endpoint, no new route). */

interface BotGameRow extends SparringGameRow {
  kind: string
  opponent: string
}

const STYLE_CHIP: Record<string, string> = {
  solid: 'bg-secondary text-secondary-foreground',
  aggressive: 'bg-destructive/10 text-destructive',
  tricky: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  positional: 'bg-teal-600/10 text-teal-700 dark:text-teal-400',
  chaotic: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
}

function PersonaRecordBadge({ wins, losses, draws, played }: { wins: number; losses: number; draws: number; played: number }) {
  if (played <= 0) return null
  const label = `${wins}W · ${losses}L${draws > 0 ? ` · ${draws}D` : ''} in ${played}`
  return (
    <span
      className={cn(
        'shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold',
        wins > losses ? 'bg-primary/15 text-primary' : 'bg-secondary text-secondary-foreground',
      )}
      aria-label={`Your record: ${label}`}
    >
      {label}
    </span>
  )
}

function GameScreen({
  setup,
  theme,
  onExit,
  onReview,
  setProfile,
  playerName,
  soundEnabled,
}: {
  setup: Setup
  theme: string
  onExit: (rematch: boolean) => void
  onReview: (pgn: string, gameId: string | null) => void
  setProfile: (p: import('@/lib/store').ProfileData) => void
  playerName: string
  soundEnabled: boolean
}) {
  const gameRef = useRef(safeChess(setup.fen))
  const [fen, setFen] = useState(gameRef.current.fen())
  const [moves, setMoves] = useState<string[]>([])
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [end, setEnd] = useState<GameEnd | null>(null)
  const [engineThinking, setEngineThinking] = useState(false)
  const [hintArrow, setHintArrow] = useState<Arrow | null>(null)
  const [hintLoading, setHintLoading] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const [recorded, setRecorded] = useState(false)
  const [savedPgn, setSavedPgn] = useState('')
  const [savedGameId, setSavedGameId] = useState<string | null>(null)
  // estimated Elo after this casual game (chess.com-style bot rating)
  const [estAfter, setEstAfter] = useState<{ elo: number; delta: number } | null>(null)
  const [sound, setSound] = useState(soundEnabled)
  // bot personality: speech bubble + material swing tracking
  const [bark, setBark] = useState<string | null>(null)
  const barkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastBarkRef = useRef<string | undefined>(undefined)
  const matBeforeRef = useRef(0)
  const orientation = flipped ? (setup.playerColor === 'w' ? 'b' : 'w') : setup.playerColor

  const sayBark = useCallback(
    (list: string[]) => {
      if (list.length === 0) return
      const line = pickBark(list, lastBarkRef.current)
      lastBarkRef.current = line
      setBark(line)
      if (barkTimer.current) clearTimeout(barkTimer.current)
      barkTimer.current = setTimeout(() => setBark(null), 6000)
    },
    [],
  )

  useEffect(() => () => { if (barkTimer.current) clearTimeout(barkTimer.current) }, [])

  // greet when a new opponent sits down
  useEffect(() => {
    const t = setTimeout(() => sayBark(setup.bot.barks.greet), 800)
    return () => clearTimeout(t)
  }, [setup.bot.id, sayBark, setup.bot.barks.greet])

  const checkSquare = useMemo(() => {
    const g = gameRef.current
    if (g.isCheckmate() || !g.isCheck()) return null
    return g.turn() === 'w' ? (g.board().flat().find((s) => s && s.type === 'k' && s.color === 'w')?.square ?? null) : (g.board().flat().find((s) => s && s.type === 'k' && s.color === 'b')?.square ?? null)
  }, [fen])

  const evaluateEnd = useCallback((g: Chess): GameEnd | null => {
    if (g.isCheckmate()) {
      const matedColor = g.turn()
      return { result: matedColor === setup.playerColor ? 'loss' : 'win', reason: 'checkmate' }
    }
    if (g.isStalemate()) return { result: 'draw', reason: 'stalemate' }
    if (g.isInsufficientMaterial()) return { result: 'draw', reason: 'insufficient material' }
    if (g.isThreefoldRepetition()) return { result: 'draw', reason: 'repetition' }
    if (g.isDraw()) return { result: 'draw', reason: 'fifty-move rule' }
    return null
  }, [setup.playerColor])

  // record the game once when it ends; casual, but it moves the est. Elo
  useEffect(() => {
    if (!end || recorded) return
    setRecorded(true)
    const pgn = buildPgn(gameRef.current, setup, playerName, end)
    setSavedPgn(pgn)
    fetch('/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        color: setup.playerColor,
        botLevel: setup.bot.level,
        botName: setup.bot.name,
        botRating: setup.bot.rating,
        rated: false,
        result: end.result,
        reason: end.reason,
        pgn,
        finalFen: gameRef.current.fen(),
        moveCount: moves.length,
        dayKey: new Date().toLocaleDateString('sv-SE'),
      }),
    })
      .then((r) => readJson<{ profile?: ProfileData | null; record?: { id?: string } | null; estElo?: number | null; estDelta?: number | null }>(r))
      .then((d) => {
        if (d.profile) setProfile(d.profile)
        setSavedGameId(d.record?.id ?? null)
        if (typeof d.estElo === 'number' && typeof d.estDelta === 'number') {
          setEstAfter({ elo: d.estElo, delta: d.estDelta })
        }
      })
      .catch(() => {})
    playSound(end.result === 'win' ? 'win' : end.result === 'loss' ? 'lose' : 'gameEnd', sound)
    sayBark(
      end.result === 'win'
        ? setup.bot.barks.lose
        : end.result === 'loss'
          ? setup.bot.barks.win
          : setup.bot.barks.draw,
    )
  }, [end, recorded, setup, moves.length, playerName, setProfile, sound, sayBark])

  const botBusyRef = useRef(false)
  const botMove = useCallback(async () => {
    if (botBusyRef.current) return
    const g = gameRef.current
    if (g.isGameOver()) return
    botBusyRef.current = true
    setEngineThinking(true)
    try {
      // Server engine core first (native Stockfish 19 with real UCI Skill
      // Level and bot personality); the browser wasm stays as the fallback.
      let uci: string | null = null
      try {
        const res = await fetch('/api/engine/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fen: g.fen(),
            skill: setup.bot.skill,
            depth: setup.bot.depth,
            minTime: setup.bot.minTime,
            blunder: setup.bot.blunder,
            aggression: setup.bot.aggression ?? 0,
          }),
        })
        if (res.ok) {
          const d = (await res.json()) as { uci?: string | null }
          uci = d.uci ?? null
        }
      } catch {
        /* server engine unreachable, use the browser engine below */
      }
      if (!uci) {
        const r = await engine.bestMove({
          fen: g.fen(),
          skill: setup.bot.skill,
          depth: setup.bot.depth,
          minTime: setup.bot.minTime,
          blunder: 0, // the server already rolled personality moves; avoid double-rolling
        })
        uci = r.uci
      }
      if (uci && uci.length >= 4) {
        const mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined })
        if (mv) {
          setFen(g.fen())
          setMoves((m) => [...m, mv.san])
          setLastMove({ from: mv.from, to: mv.to })
          setHintArrow(null)
          playSound(mv.captured ? 'capture' : mv.san.startsWith('O-O') ? 'castle' : 'move', sound)
          if (g.isCheck()) playSound('check', sound)
          setEnd(evaluateEnd(g))
          const delta = materialFor(g.fen(), setup.playerColor) - matBeforeRef.current
          if (delta <= -2 && Math.random() < 0.6) sayBark(setup.bot.barks.playerBlunder)
          else if (delta >= 2 && Math.random() < 0.6) sayBark(setup.bot.barks.playerGood)
        }
      }
    } finally {
      botBusyRef.current = false
      setEngineThinking(false)
    }
  }, [setup.bot, setup.playerColor, evaluateEnd, sound, sayBark])

  // Sole driver of bot moves: whenever it is the bot's turn and the game is
  // live, ask the engine. This covers the player choosing Black (the bot must
  // open the game) as well as replying after every player move. The effect
  // re-runs after each fen change and stops once it is the player's turn; the
  // per-position attempt cap keeps an engine failure from looping forever.
  const botAttemptsRef = useRef(new Map<string, number>())
  useEffect(() => {
    if (end) return
    const g = gameRef.current
    if (g.isGameOver() || g.turn() === setup.playerColor) return
    const key = g.fen()
    const tries = botAttemptsRef.current.get(key) ?? 0
    if (tries >= 2) return
    if (botAttemptsRef.current.size > 32) botAttemptsRef.current.clear()
    botAttemptsRef.current.set(key, tries + 1)
    void botMove()
  }, [fen, end, setup.playerColor, botMove])

  const onPlayerMove = useCallback(
    (from: Square, to: Square, promotion?: string) => {
      const g = gameRef.current
      if (g.isGameOver() || g.turn() !== setup.playerColor) return
      matBeforeRef.current = materialFor(g.fen(), setup.playerColor)
      try {
        const mv = g.move({ from, to, promotion: promotion ?? undefined })
        if (!mv) return
        setFen(g.fen())
        setMoves((m) => [...m, mv.san])
        setLastMove({ from: mv.from, to: mv.to })
        setHintArrow(null)
        playSound(mv.captured ? 'capture' : mv.san.startsWith('O-O') ? 'castle' : mv.promotion ? 'promote' : 'move', sound)
        if (g.isCheck()) playSound('check', sound)
        const ended = evaluateEnd(g)
        if (ended) setEnd(ended)
      } catch {
        /* illegal */
      }
    },
    [setup.playerColor, evaluateEnd, sound],
  )

  const takeback = useCallback(() => {
    const g = gameRef.current
    if (g.isGameOver() || engineThinking) return
    const undoCount = g.turn() === setup.playerColor ? 2 : 1
    for (let i = 0; i < undoCount; i++) {
      const mv = g.undo()
      if (mv) setMoves((m) => m.slice(0, -1))
    }
    setFen(g.fen())
    setLastMove(null)
  }, [engineThinking, setup.playerColor])

  const showHint = useCallback(async () => {
    const g = gameRef.current
    if (g.isGameOver() || g.turn() !== setup.playerColor) return
    setHintLoading(true)
    try {
      const { uci } = await engine.bestMove({ fen: g.fen(), skill: 20, depth: 14 })
      if (uci && uci.length >= 4) {
        setHintArrow({ from: uci.slice(0, 2), to: uci.slice(2, 4), color: 'green' })
        setTimeout(() => setHintArrow(null), 3000)
      }
    } finally {
      setHintLoading(false)
    }
  }, [setup.playerColor])

  const resign = useCallback(() => {
    if (end) return
    setEnd({ result: 'loss', reason: 'resignation' })
  }, [end])

  // After-game flavor line for this exact ending, picked once per end state so
  // re-renders of the dialog never swap the line mid-view.
  const titleCard = useMemo(() => (end ? titleCardFor(end.result, end.reason) : null), [end])

  const playerOnMove = gameRef.current.turn() === setup.playerColor && !end

  return (
    <div className="cockpit-shell mx-auto w-full max-w-6xl px-2 py-3 pb-20 sm:px-3 lg:py-1.5">
      {/* compact fixed-height control bar: status text swaps happen INSIDE this
          row (lg:h-9), so they can never resize or move the board below */}
      <div className="mb-2 flex flex-none flex-wrap items-center justify-between gap-2 lg:h-9 lg:flex-nowrap">
        <div className="flex min-w-0 items-center gap-2">
          <BotFace bot={setup.bot} className="h-7 w-7 border border-border/60 bg-secondary" />
          <p className="truncate text-sm font-semibold" aria-live="polite">
            {engineThinking ? 'Thinking…' : end ? 'Game over' : playerOnMove ? 'Your move' : 'Casual game'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 lg:flex-nowrap">
          <Button
            variant="secondary"
            size="sm"
            className="h-11 px-2.5 lg:h-8 lg:px-3"
            onClick={() => setSound(!sound)}
            aria-label={sound ? 'Mute game sounds' : 'Unmute game sounds'}
            aria-pressed={sound}
          >
            {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
          <Button variant="secondary" size="sm" className="h-11 lg:h-8" onClick={() => setFlipped(!flipped)}>
            Flip
          </Button>
          <Button variant="secondary" size="sm" className="h-11 lg:h-8" onClick={takeback} disabled={!playerOnMove || moves.length < 2}>
            <Undo2 className="h-4 w-4" /> Takeback
          </Button>
          <Button variant="secondary" size="sm" className="h-11 lg:h-8" onClick={showHint} disabled={!playerOnMove || hintLoading}>
            <Lightbulb className="h-4 w-4" /> Hint
            {hintLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          </Button>
          <Button variant="destructive" size="sm" className="h-11 lg:h-8" onClick={resign} disabled={Boolean(end)}>
            <Flag className="h-4 w-4" /> Resign
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1 lg:flex-row lg:gap-4">
        {/* board column: fixed slots top-to-bottom; the board area takes the rest */}
        <div className="board-cockpit mx-auto w-full max-w-[640px] min-w-0 flex-1 lg:max-w-none">
          {/* opponent (bot) plate — FIXED slot, always rendered */}
          <CockpitPlate
            className="mb-1.5"
            left={
              <>
                <BotFace bot={setup.bot} className="h-9 w-9 border border-border/60 bg-secondary" />
                <div className="min-w-0 leading-tight">
                  <div className="truncate text-sm font-bold">
                    {setup.bot.name}{' '}
                    <span className="font-normal text-muted-foreground">est. {setup.bot.rating}</span>
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">{setup.bot.description}</div>
                </div>
              </>
            }
            right={
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Casual
              </span>
            }
          />

          {/* bot captured slot — FIXED row, renders empty until a capture */}
          <CapturedSlot
            fen={fen}
            capturator={setup.playerColor === 'w' ? 'b' : 'w'}
            className="cockpit-captured mb-0.5"
          />

          <div className="cockpit-board-area">
            {/* bot bark: overlays the board (absolute + pointer-events-none) so
                the speech bubble appearing/vanishing has ZERO layout impact */}
            <div aria-live="polite" className="pointer-events-none absolute left-2 top-2 z-30 max-w-[75%]">
              {bark && (
                <div className="rounded-xl rounded-bl-sm border border-border/60 bg-card/95 px-3 py-1.5 text-xs font-semibold shadow-md backdrop-blur-sm">
                  {bark}
                </div>
              )}
            </div>
            <div className="cockpit-board">
              <ChessBoard
                fen={fen}
                orientation={orientation}
                onMove={onPlayerMove}
                movableSide={end ? undefined : setup.playerColor}
                interactive={!end}
                lastMove={lastMove}
                checkSquare={checkSquare}
                arrows={hintArrow ? [hintArrow] : []}
                showLegal={playerOnMove}
                theme={theme}
                className="h-full w-full"
              />
            </div>
          </div>

          {/* my captured slot — FIXED row, renders empty until a capture */}
          <CapturedSlot fen={fen} capturator={setup.playerColor} className="cockpit-captured mt-0.5" />

          {/* my plate — FIXED slot, always rendered */}
          <CockpitPlate
            className="mt-1.5"
            left={
              <>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-white">
                  {playerName.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 leading-tight">
                  <div className="truncate text-sm font-bold">{playerName}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {playerOnMove ? 'Your move' : end ? 'Game over' : 'Waiting'}
                  </div>
                </div>
              </>
            }
            right={
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {setup.playerColor === 'w' ? 'White' : 'Black'}
              </span>
            }
          />
        </div>

        {/* side panel: fixed width, matched to the board column height, own scroll */}
        <div className="w-full shrink-0 rounded-lg bg-card shadow-sm lg:flex lg:min-h-0 lg:w-80 lg:flex-col">
          <div className="flex-none border-b border-border px-4 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Moves
          </div>
          <MoveList moves={moves} maxHeightClass="max-h-72 lg:max-h-none" className="sb-stable min-h-0 flex-1" />
        </div>
      </div>

      {/* end dialog: rematch and lobby below are the only way out */}
      <Dialog open={Boolean(end)}>
        <DialogContent className="sm:max-w-md" onEscapeKeyDown={(e) => e.preventDefault()} showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-extrabold">
              {end?.result === 'win' ? 'You won' : end?.result === 'loss' ? 'You lost' : 'Draw'}
            </DialogTitle>
            <DialogDescription>
              {end?.result === 'win' ? 'Won' : end?.result === 'loss' ? 'Lost' : 'Drawn'} by {end?.reason} against {setup.bot.name}.
            </DialogDescription>
          </DialogHeader>
          {titleCard && (
            <p className="text-center font-display text-base font-bold italic text-foreground/80" aria-live="polite">
              {titleCard}
            </p>
          )}
          <p className="text-sm text-muted-foreground">Casual game, online ratings are untouched.</p>
          {estAfter && (
            <div className="flex flex-col items-center gap-0.5 rounded-lg bg-secondary/60 px-4 py-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Estimated Elo</span>
              <span className="flex items-baseline gap-2">
                <span className="font-display text-2xl font-extrabold">{estAfter.elo}</span>
                <span className={cn('font-display text-lg font-bold', estAfter.delta >= 0 ? 'text-primary' : 'text-destructive')}>
                  {estAfter.delta >= 0 ? '+' : ''}
                  {estAfter.delta}
                </span>
              </span>
            </div>
          )}
          <div className="mt-2 flex flex-col gap-2">
            <Button className="btn-hero w-full py-3" onClick={() => onReview(savedPgn, savedGameId)}>
              <RefreshCw className="h-4 w-4" /> Game review
            </Button>
            <div className="flex gap-2">
              <Button className="btn-hero flex-1 py-2.5" onClick={() => onExit(true)}>
                Rematch
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => onExit(false)}>
                Back to lobby
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Net material balance (pawn units) for one side from a FEN. */
function materialFor(fen: string, color: 'w' | 'b'): number {
  try {
    const g = new Chess(fen)
    let v = 0
    for (const row of g.board()) {
      for (const sq of row) {
        if (!sq || sq.type === 'k') continue
        const val = { p: 1, n: 3, b: 3, r: 5, q: 9 }[sq.type]
        v += sq.color === color ? val : -val
      }
    }
    return v
  } catch {
    return 0
  }
}

function buildPgn(g: Chess, setup: Setup, playerName: string, end: GameEnd): string {
  try {
    const result = end.result === 'win' ? (setup.playerColor === 'w' ? '1-0' : '0-1') : end.result === 'loss' ? (setup.playerColor === 'w' ? '0-1' : '1-0') : '1/2-1/2'
    g.setHeader('Event', 'ChessX Casual')
    g.setHeader('White', setup.playerColor === 'w' ? playerName : `${setup.bot.name} (est. ${setup.bot.rating})`)
    g.setHeader('Black', setup.playerColor === 'b' ? playerName : `${setup.bot.name} (est. ${setup.bot.rating})`)
    g.setHeader('Result', result)
    return g.pgn()
  } catch {
    return ''
  }
}

/* ---------------- start from a position (zeechess-style) ---------------- */

interface SavedPositionRow {
  id: string
  name: string
  fen: string
  createdAt: string
}

/** Quick, legal starting points: endings and drills worth replaying. */
const POSITION_PRESETS: { name: string; fen: string }[] = [
  { name: 'Starting position', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
  { name: 'Queen mate technique', fen: '6k1/8/8/8/8/8/5PPP/4Q1K1 w - - 0 1' },
  { name: 'Rook mate technique', fen: '6k1/8/8/8/8/8/5PPP/4R1K1 w - - 0 1' },
  { name: 'King and pawn: opposition', fen: '8/8/4k3/8/4K3/4P3/8/8 w - - 0 1' },
  { name: 'Back-rank defense', fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 b - - 0 1' },
  { name: 'Knight versus pawns', fen: '8/5k2/8/8/3p4/8/3P4/2N3K1 w - - 0 1' },
]

/** Client-side mirror of the server FEN checks: legal position, game not
 * already over. Returns the error text or null when the FEN is playable. */
function fenProblem(fen: string): string | null {
  const trimmed = fen.trim()
  if (!trimmed) return null
  const parts = trimmed.split(/\s+/)
  if (parts.length < 2) return 'A FEN needs at least the piece placement and the side to move.'
  let g: Chess
  try {
    g = new Chess(trimmed)
  } catch {
    return 'That FEN does not describe a legal position.'
  }
  if (g.isCheckmate() || g.isStalemate() || g.isInsufficientMaterial() || g.isThreefoldRepetition() || g.isDraw()) {
    return 'That position is already decided: the game is over the moment it starts.'
  }
  return null
}

function PositionLab({
  onPlay,
  colorChoice,
}: {
  onPlay: (bot: Bot, fen?: string) => void
  colorChoice: 'w' | 'b' | 'random'
}) {
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState<SavedPositionRow[] | null>(null)
  const [name, setName] = useState('')
  const [fenText, setFenText] = useState('')
  const [botLevel, setBotLevel] = useState(BOTS[Math.min(3, BOTS.length - 1)].level)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const loadSaved = useCallback(() => {
    fetch('/api/positions')
      .then((r) => (r.ok ? readJson<{ positions: SavedPositionRow[] }>(r) : { positions: [] }))
      .then((d) => setSaved(d.positions))
      .catch(() => setSaved([]))
  }, [])

  useEffect(() => {
    if (open) loadSaved()
  }, [open, loadSaved])

  const [setupTab, setSetupTab] = useState<'paste' | 'editor'>('paste')

  const bot = useMemo(() => BOTS.find((b) => b.level === botLevel) ?? BOTS[0], [botLevel])
  const problem = fenProblem(fenText)
  const playable = fenText.trim() !== '' && problem == null

  const playFrom = (fen: string) => {
    if (fenProblem(fen)) return
    onPlay(bot, fen)
  }

  // The board editor mirrors its live FEN here, so the shared controls below
  // the tabs (play / save) act on whatever the editor currently shows.
  const syncEditorFen = useCallback((fen: string) => setFenText(fen), [])

  // Handoff to analysis: the Analysis view reads ?fen= from the URL on mount,
  // so navigating to the #/analysis?fen=… hash pattern lands exactly on the
  // position the editor produced.
  const openInAnalysis = useCallback((fen: string) => {
    const target = `/analysis?fen=${encodeURIComponent(fen)}`
    if (window.location.hash === `#${target}`) {
      // Identical hash: no hashchange event fires — flip the router directly.
      useApp.setState({ view: { name: 'analysis' } })
    } else {
      window.location.hash = target
    }
  }, [])

  const savePosition = async () => {
    if (!playable) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/api/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || 'Saved position', fen: fenText.trim() }),
      })
      const data = await readJson<{ error?: string }>(res)
      if (!res.ok) throw new Error(data.error ?? 'Could not save that position.')
      setName('')
      setFenText('')
      loadSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const removeSaved = async (id: string) => {
    await fetch(`/api/positions?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
    loadSaved()
  }

  return (
    <section className="mb-5 rounded-xl bg-card p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold">Start from a position</h2>
          <p className="text-xs text-muted-foreground">
            Paste a FEN, draw one on the board editor, or pick a drill — keep it on your shelf and play it against any bot from either side.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="min-h-11 shrink-0">
          <SquareStack className="mr-2 h-4 w-4" /> Set up a board
        </Button>
      </div>

      {saved && saved.length > 0 && (
        <ul className="scroll-slim mt-4 max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {saved.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2 transition hover:border-primary/40"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-secondary text-xs font-extrabold uppercase">
                {p.fen.split(' ')[1] === 'b' ? 'B' : 'W'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{p.name}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">{p.fen}</span>
              </span>
              <Button variant="secondary" size="sm" className="h-8 shrink-0 px-2 text-xs" onClick={() => playFrom(p.fen)}>
                <Play className="mr-1 h-3 w-3" /> Play
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 px-2 text-xs"
                onClick={() => removeSaved(p.id)}
                aria-label={`Delete ${p.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] max-w-[calc(100%-0.5rem)] overflow-y-auto p-4 scroll-slim sm:max-w-xl sm:p-6">
          <DialogHeader>
            <DialogTitle>Start from a position</DialogTitle>
            <DialogDescription>
              Paste a FEN, draw one on the board editor, or start from a preset drill. The position joins your shelf, and the game plays against any bot.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label htmlFor="pos-name" className="text-sm font-semibold">Name</label>
              <Input
                id="pos-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Rook ending practice"
                maxLength={60}
                className="mt-1"
              />
            </div>

            <Tabs value={setupTab} onValueChange={(v) => setSetupTab(v as 'paste' | 'editor')}>
              <TabsList className="w-full">
                <TabsTrigger value="paste">
                  <ClipboardPaste className="mr-1.5 h-4 w-4" /> Paste FEN
                </TabsTrigger>
                <TabsTrigger value="editor">
                  <Puzzle className="mr-1.5 h-4 w-4" /> Board editor
                </TabsTrigger>
              </TabsList>

              <TabsContent value="paste" className="mt-3 space-y-3">
                <div>
                  <label htmlFor="pos-fen" className="text-sm font-semibold">FEN</label>
                  <Textarea
                    id="pos-fen"
                    value={fenText}
                    onChange={(e) => setFenText(e.target.value)}
                    placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
                    rows={2}
                    className="mt-1 font-mono text-xs"
                    aria-invalid={Boolean(problem)}
                  />
                  {problem && (
                    <p className="mt-1 text-xs font-semibold text-destructive" role="alert">{problem}</p>
                  )}
                  {playable && (
                    <p className="mt-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      Legal position, {(fenText.trim().split(/\s+/)[1] ?? 'w') === 'b' ? 'black' : 'white'} to move.
                    </p>
                  )}
                </div>

                <div>
                  <span className="text-sm font-semibold">Preset drills</span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {POSITION_PRESETS.map((p) => (
                      <button
                        key={p.name}
                        type="button"
                        onClick={() => setFenText(p.fen)}
                        className="min-h-9 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold transition hover:bg-accent active:scale-95"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="editor" className="mt-3">
                <BoardEditor
                  initialFen={fenText}
                  onPlayVsBot={(fen) => {
                    setFenText(fen)
                    playFrom(fen)
                  }}
                  onAnalyze={openInAnalysis}
                  onFenChange={syncEditorFen}
                />
              </TabsContent>
            </Tabs>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pos-bot" className="text-sm font-semibold">Opponent</label>
                <Select value={String(botLevel)} onValueChange={(v) => setBotLevel(Number(v))}>
                  <SelectTrigger id="pos-bot" className="mt-1">
                    <SelectValue placeholder="Pick a bot" />
                  </SelectTrigger>
                  <SelectContent>
                    {BOTS.map((b) => (
                      <SelectItem key={b.level} value={String(b.level)}>
                        {b.name} · ~{b.rating}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <span className="text-sm font-semibold">Your side</span>
                <div className="mt-1 flex h-10 items-center rounded-md border px-3 text-sm font-semibold">
                  {colorChoice === 'w' ? 'White' : colorChoice === 'b' ? 'Black' : 'Random side'}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">(pick under the Bots tab)</span>
                </div>
              </div>
            </div>

            {err && (
              <p className="text-xs font-semibold text-destructive" role="alert">{err}</p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button disabled={!playable || busy} onClick={() => playFrom(fenText)}>
                <Play className="mr-2 h-4 w-4" /> Play from here
              </Button>
              <Button variant="secondary" disabled={!playable || busy} onClick={savePosition}>
                <SquareStack className="mr-2 h-4 w-4" /> Save to shelf
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
