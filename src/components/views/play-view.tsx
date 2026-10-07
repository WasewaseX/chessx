'use client'
import { readJson } from '@/lib/api-client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type Arrow } from '@/components/chess/board'
import { MoveList } from '@/components/chess/move-list'
import { CapturedBar } from '@/components/chess/captured-bar'
import { BOTS, botForLevel, type Bot } from '@/lib/chess/bots'
import { CharacterFace } from '@/components/chess/characters'
import { engine } from '@/lib/chess/engine-client'
import { playSound } from '@/lib/chess/sounds'
import { useApp, overallRating } from '@/lib/store'
import { tcLabel } from '@/lib/rating'
import { Button } from '@/components/ui/button'
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
import { ArrowLeft, Flag, Handshake, Lightbulb, RefreshCw, Search, Undo2, Volume2, VolumeX, X, Globe, Bot as BotIcon, Loader2 } from 'lucide-react'

type Phase = 'lobby' | 'playing' | 'over'

interface Setup {
  bot: Bot
  playerColor: 'w' | 'b'
}

interface GameEnd {
  result: 'win' | 'loss' | 'draw'
  reason: string
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

export function PlayView() {
  const { profile, setProfile, navigate, setReviewPgn, setReviewGameId } = useApp()
  const [tab, setTab] = useState<'online' | 'bots'>('online')
  const [phase, setPhase] = useState<Phase>('lobby')
  const [setup, setSetup] = useState<Setup | null>(null)
  const [colorChoice, setColorChoice] = useState<'w' | 'b' | 'random'>('random')
  // bumped on every startGame so a rematch against the same bot still gets a
  // fresh GameScreen (the key must change or the old game state sticks around)
  const [matchNo, setMatchNo] = useState(0)

  const startGame = useCallback(
    (bot: Bot) => {
      const color: 'w' | 'b' = colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorChoice
      setSetup({ bot, playerColor: color })
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
          if (rematch) startGame(botForLevel(setup.bot.level))
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
            <span className="block text-xs text-muted-foreground">Casual practice, 14 characters, est. Elo</span>
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
  const { ratings, user, setRatings } = useApp()
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
            .then((r) => readJson<unknown>(r))
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

  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-4">
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="mx-auto w-full max-w-[640px] flex-1">
          {/* opponent plate + clock */}
          <div className="mb-2 flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-extrabold text-secondary-foreground">
                {initials(opp.username)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">
                  {opp.username} <span className="font-normal text-muted-foreground">({opp.rating}{opp.provisional ? '?' : ''})</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {oppGone ? 'Disconnected, may claim win' : `${tcLabel(game.initialSec, game.incSec)} · Rated`}
                </div>
              </div>
            </div>
            <div
              className={cn(
                'rounded-lg px-4 py-1.5 font-mono text-2xl font-bold tabular-nums transition-colors',
                turn !== myColor && !over ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground',
                (turn !== myColor ? oppClock : myClock) < 10_000 && 'text-destructive',
              )}
            >
              {formatClock(turn !== myColor ? oppClock : myClock)}
            </div>
          </div>

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
          />

          {/* my plate + clock */}
          <div className="mt-2 flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-extrabold text-white">
                {initials(game.color === 'w' ? game.white.username : game.black.username)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">You</div>
                <div className="text-xs text-muted-foreground">{myTurn ? 'Your move' : 'Waiting'}</div>
              </div>
            </div>
            <div
              className={cn(
                'rounded-lg px-4 py-1.5 font-mono text-2xl font-bold tabular-nums transition-colors',
                myTurn ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground',
                myClock < 10_000 && myTurn && 'text-destructive',
              )}
            >
              {formatClock(myClock)}
            </div>
          </div>
          <div className="mt-1 flex justify-end">
            <CapturedBar fen={fen} />
          </div>
        </div>

        {/* side panel */}
        <div className="w-full rounded-lg bg-card shadow-sm lg:w-80">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">Moves</span>
            <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
              {tcLabel(game.initialSec, game.incSec)} · rated
            </span>
          </div>
          <MoveList moves={moves} maxHeightClass="max-h-[380px]" />
          <div className="flex gap-2 border-t border-border p-3">
            <Button variant="destructive" className="flex-1" onClick={resign} disabled={Boolean(over)}>
              <Flag className="h-4 w-4" /> Resign
            </Button>
            <Button variant="secondary" className="flex-1" onClick={offerDraw} disabled={Boolean(over)}>
              <Handshake className="h-4 w-4" /> Draw
            </Button>
          </div>
          {drawOffer && drawOffer !== myColor && (
            <div className="mx-3 mb-3 flex items-center justify-between rounded-md border border-border bg-secondary/60 px-3 py-2 text-sm">
              <span className="font-semibold">Opponent offers a draw</span>
              <div className="flex gap-1">
                <Button size="sm" className="h-7 px-3" onClick={acceptDraw}>
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
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

      {/* end dialog: no close affordance, the two actions below are the way out */}
      <Dialog open={Boolean(over)} onEscapeKeyDown={(e) => e.preventDefault()}>
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
  onPlay: (bot: Bot) => void
  botGames: number
  botElo: number
  botEloGames: number
}) {
  // chess.com-style ladder: the player's estimated Elo card sits in the list
  // exactly where their number falls between the bots
  const you: { key: string; rating: number; el: React.ReactNode } = {
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

      <h2 className="mb-3 font-display text-lg font-bold">Opponents</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ladder.map((row) =>
          row.el ? (
            row.el
          ) : (
            <button
              key={row.key}
              onClick={() => onPlay(row.bot!)}
              className="pressable group flex items-center gap-3 rounded-lg bg-card p-4 text-left shadow-sm transition-shadow hover:shadow-md"
            >
              <BotFace bot={row.bot!} className="h-12 w-12 shrink-0 border border-border/60 bg-secondary" />
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="truncate font-bold">{row.bot!.name}</span>
                  <span className="whitespace-nowrap text-sm text-muted-foreground">
                    est. {row.bot!.rating}
                  </span>
                </div>
                <div className="truncate text-xs text-muted-foreground">{row.bot!.description}</div>
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
  const gameRef = useRef(new Chess())
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
      .then((r) => readJson<unknown>(r))
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
      const { uci } = await engine.bestMove({
        fen: g.fen(),
        skill: setup.bot.skill,
        depth: setup.bot.depth,
        minTime: setup.bot.minTime,
        blunder: setup.bot.blunder,
      })
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

  const playerOnMove = gameRef.current.turn() === setup.playerColor && !end

  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-4">
      {/* top bar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BotFace bot={setup.bot} className="h-9 w-9 border border-border/60 bg-secondary" />
          <div>
            <div className="text-sm font-bold leading-4">{setup.bot.name} <span className="font-normal text-muted-foreground">est. {setup.bot.rating}</span></div>
            <div className="text-xs text-muted-foreground">
              {engineThinking ? 'Thinking…' : end ? 'Game over' : playerOnMove ? 'Your move' : 'Casual game'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setSound(!sound)} aria-label="Toggle sound">
            {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setFlipped(!flipped)}>Flip</Button>
          <Button variant="secondary" size="sm" onClick={takeback} disabled={!playerOnMove || moves.length < 2}>
            <Undo2 className="h-4 w-4" /> Takeback
          </Button>
          <Button variant="secondary" size="sm" onClick={showHint} disabled={!playerOnMove || hintLoading}>
            <Lightbulb className="h-4 w-4" /> {hintLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Hint'}
          </Button>
          <Button variant="destructive" size="sm" onClick={resign} disabled={Boolean(end)}>
            <Flag className="h-4 w-4" /> Resign
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="mx-auto w-full max-w-[640px] flex-1">
          <div className="mb-2 flex items-center gap-2">
            <BotFace bot={setup.bot} className="h-8 w-8 border border-border/60 bg-secondary" />
            <span className="text-sm font-semibold">
              {setup.bot.name} <span className="font-normal text-muted-foreground">est. {setup.bot.rating}</span>
            </span>
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">Casual</span>
          </div>
          {bark && (
            <div className="mb-2 flex items-center gap-2">
              <div className="relative rounded-xl rounded-bl-sm border border-border/60 bg-card px-3 py-1.5 text-xs font-semibold shadow-sm">
                {bark}
              </div>
            </div>
          )}
          <ChessBoard
            fen={fen}
            orientation={orientation}
            onMove={onPlayerMove}
            movableSide={end ? undefined : setup.playerColor}
            interactive={!end}
            lastMove={lastMove}
            checkSquare={checkSquare}
            arrows={hintArrow ? [hintArrow] : []}
            showLegal={(playerOnMove)}
            theme={theme}
          />
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-white">
                {playerName.slice(0, 1).toUpperCase()}
              </div>
              <span className="text-sm font-semibold">{playerName}</span>
            </div>
            <CapturedBar fen={fen} />
          </div>
        </div>

        {/* side panel */}
        <div className="w-full rounded-lg bg-card shadow-sm lg:w-80">
          <div className="border-b border-border px-4 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Moves
          </div>
          <MoveList moves={moves} maxHeightClass="max-h-[420px]" />
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
