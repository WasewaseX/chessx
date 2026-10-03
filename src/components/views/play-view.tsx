'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard, type Arrow } from '@/components/chess/board'
import { MoveList } from '@/components/chess/move-list'
import { CapturedBar } from '@/components/chess/captured-bar'
import { BOTS, botForLevel, botForRating, type Bot } from '@/lib/chess/bots'
import { engine } from '@/lib/chess/engine-client'
import { playSound } from '@/lib/chess/sounds'
import { seedForSkill } from '@/lib/rating'
import { useApp } from '@/lib/store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { ArrowLeft, Lightbulb, Undo2, Flag, RefreshCw, LineChart, Volume2, VolumeX } from 'lucide-react'

type Phase = 'lobby' | 'playing' | 'over'

interface Setup {
  bot: Bot
  playerColor: 'w' | 'b'
  rated: boolean
}

interface GameEnd {
  result: 'win' | 'loss' | 'draw'
  reason: string
}

export function PlayView() {
  const { profile, setProfile, navigate, setReviewPgn } = useApp()
  const [phase, setPhase] = useState<Phase>('lobby')
  const [setup, setSetup] = useState<Setup | null>(null)
  const [colorChoice, setColorChoice] = useState<'w' | 'b' | 'random'>('w')
  const [rated, setRated] = useState(false)

  const startGame = useCallback(
    (bot: Bot, forceRated?: boolean) => {
      const isRated = forceRated ?? rated
      const color: 'w' | 'b' = colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorChoice
      setSetup({ bot, playerColor: color, rated: isRated })
      setPhase('playing')
    },
    [colorChoice, rated],
  )

  const startLadder = useCallback(() => {
    if (!profile) return
    const rating = profile.ladderRating ?? seedForSkill(profile.skillLevel)
    startGame(botForRating(rating), true)
  }, [profile, startGame])

  if (phase === 'lobby' || !setup) {
    return (
      <Lobby
        rated={rated}
        setRated={setRated}
        colorChoice={colorChoice}
        setColorChoice={setColorChoice}
        onPlay={startGame}
        onLadder={startLadder}
        ladderRating={profile?.ladderRating ?? null}
      />
    )
  }

  return (
    <GameScreen
      setup={setup}
      onExit={(rematch) => {
        if (rematch) {
          startGame(botForLevel(setup.bot.level), setup.rated)
        } else {
          setPhase('lobby')
        }
      }}
      onReview={(pgn) => {
        setReviewPgn(pgn)
        navigate('analysis')
      }}
      setProfile={setProfile}
      skillLevel={profile?.skillLevel ?? 'beginner'}
      playerName={profile?.name ?? 'You'}
      soundEnabled={profile?.soundEnabled ?? true}
    />
  )
}

function Lobby({
  rated,
  setRated,
  colorChoice,
  setColorChoice,
  onPlay,
  onLadder,
  ladderRating,
}: {
  rated: boolean
  setRated: (v: boolean) => void
  colorChoice: 'w' | 'b' | 'random'
  setColorChoice: (v: 'w' | 'b' | 'random') => void
  onPlay: (bot: Bot) => void
  onLadder: () => void
  ladderRating: number | null
}) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <button onClick={() => window.history.back()} className="mb-4 hidden items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground lg:flex">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {/* Ladder */}
      <div className="mb-6 flex flex-col items-start justify-between gap-4 rounded-lg bg-card p-5 shadow-sm sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-xl font-extrabold">Bot ladder</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One rated game at a time against the bot nearest your level.
            {ladderRating ? ` Current rating: ${ladderRating}.` : ' Your first game sets your rating — provisional for 10 games.'}
          </p>
        </div>
        <Button className="btn-hero px-8 py-3 text-base" onClick={onLadder}>
          Play rated
        </Button>
      </div>

      {/* Casual settings */}
      <div className="mb-4 flex flex-wrap items-center gap-6 rounded-lg bg-card px-5 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <Label htmlFor="rated-casual" className="text-sm font-semibold">
            Rated
          </Label>
          <Switch id="rated-casual" checked={rated} onCheckedChange={setRated} />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm font-semibold">Side</Label>
          <div className="flex overflow-hidden rounded-md border">
            {(['w', 'random', 'b'] as const).map((c) => (
              <button
                key={c}
                onClick={() => setColorChoice(c)}
                className={cn('px-3 py-1.5 text-sm font-semibold', colorChoice === c ? 'bg-primary text-primary-foreground' : 'bg-secondary')}
              >
                {c === 'w' ? 'White' : c === 'b' ? 'Black' : 'Random'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bots */}
      <h2 className="mb-3 font-display text-lg font-bold">Opponents</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {BOTS.map((bot) => (
          <button
            key={bot.level}
            onClick={() => onPlay(bot)}
            className="group flex items-center gap-3 rounded-lg bg-card p-4 text-left shadow-sm transition hover:shadow-md"
          >
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-display text-xl font-extrabold text-white"
              style={{ background: bot.color }}
            >
              {bot.avatar}
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="truncate font-bold">{bot.name}</span>
                <span className="text-sm text-muted-foreground">{bot.rating}</span>
              </div>
              <div className="truncate text-xs text-muted-foreground">{bot.description}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function GameScreen({
  setup,
  onExit,
  onReview,
  setProfile,
  skillLevel,
  playerName,
  soundEnabled,
}: {
  setup: Setup
  onExit: (rematch: boolean) => void
  onReview: (pgn: string) => void
  setProfile: (p: import('@/lib/store').ProfileData) => void
  skillLevel: string
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
  const [ratingDelta, setRatingDelta] = useState<number | null>(null)
  const [newRatingValue, setNewRatingValue] = useState<number | null>(null)
  const [savedPgn, setSavedPgn] = useState('')
  const [sound, setSound] = useState(soundEnabled)
  const orientation = flipped ? (setup.playerColor === 'w' ? 'b' : 'w') : setup.playerColor

  const checkSquare = useMemo(() => {
    const g = gameRef.current
    if (g.isCheckmate() || !g.isCheck()) return null
    return g.turn() === 'w' ? (g.board().flat().find((s) => s && s.type === 'k' && s.color === 'w')?.square ?? null) : (g.board().flat().find((s) => s && s.type === 'k' && s.color === 'b')?.square ?? null)
  }, [fen])

  const evaluateEnd = useCallback((g: Chess): GameEnd | null => {
    if (g.isCheckmate()) {
      // last move was by the previous side; if the side to move is mated...
      const matedColor = g.turn()
      return { result: matedColor === setup.playerColor ? 'loss' : 'win', reason: 'checkmate' }
    }
    if (g.isStalemate()) return { result: 'draw', reason: 'stalemate' }
    if (g.isInsufficientMaterial()) return { result: 'draw', reason: 'insufficient material' }
    if (g.isThreefoldRepetition()) return { result: 'draw', reason: 'repetition' }
    if (g.isDraw()) return { result: 'draw', reason: 'fifty-move rule' }
    return null
  }, [setup.playerColor])

  // record the game once when it ends
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
        rated: setup.rated,
        result: end.result,
        reason: end.reason,
        pgn,
        finalFen: gameRef.current.fen(),
        moveCount: moves.length,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.profile) setProfile(d.profile)
        setRatingDelta(d.record?.ratingDelta ?? null)
        setNewRatingValue(d.profile?.ladderRating ?? null)
      })
      .catch(() => {})
    playSound(end.result === 'win' ? 'win' : end.result === 'loss' ? 'lose' : 'gameEnd', sound)
  }, [end, recorded, setup, moves.length, playerName, setProfile, sound])

  const botMove = useCallback(async () => {
    const g = gameRef.current
    if (g.isGameOver()) return
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
        }
      }
    } finally {
      setEngineThinking(false)
    }
  }, [setup.bot, evaluateEnd, sound])

  const onPlayerMove = useCallback(
    (from: Square, to: Square, promotion?: string) => {
      const g = gameRef.current
      if (g.isGameOver() || g.turn() !== setup.playerColor) return
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
        if (ended) {
          setEnd(ended)
        } else {
          void botMove()
        }
      } catch {
        /* illegal */
      }
    },
    [setup.playerColor, evaluateEnd, botMove, sound],
  )

  const takeback = useCallback(() => {
    const g = gameRef.current
    if (g.isGameOver() || engineThinking) return
    // undo bot reply + player move (or just one if bot hasn't replied)
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
          <div className="flex h-9 w-9 items-center justify-center rounded-full font-display font-extrabold text-white" style={{ background: setup.bot.color }}>
            {setup.bot.avatar}
          </div>
          <div>
            <div className="text-sm font-bold leading-4">{setup.bot.name} · {setup.bot.rating}</div>
            <div className="text-xs text-muted-foreground">
              {engineThinking ? 'Thinking…' : end ? 'Game over' : playerOnMove ? 'Your move' : setup.rated ? 'Rated ladder game' : 'Casual game'}
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
            <Lightbulb className="h-4 w-4" /> {hintLoading ? '…' : 'Hint'}
          </Button>
          <Button variant="destructive" size="sm" onClick={resign} disabled={Boolean(end)}>
            <Flag className="h-4 w-4" /> Resign
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="mx-auto w-full max-w-[640px] flex-1">
          {/* opponent plate */}
          <div className="mb-2 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-extrabold text-white" style={{ background: setup.bot.color }}>
              {setup.bot.avatar}
            </div>
            <span className="text-sm font-semibold">
              {setup.bot.name} <span className="text-muted-foreground">({setup.bot.rating})</span>
            </span>
            {setup.rated && <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">Rated</span>}
          </div>
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
            theme="green"
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

      {/* end dialog */}
      <Dialog open={Boolean(end)}>
        <DialogContent className="sm:max-w-md" onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-extrabold">
              {end?.result === 'win' ? 'You won' : end?.result === 'loss' ? 'You lost' : 'Draw'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {end?.result === 'win' ? 'Won' : end?.result === 'loss' ? 'Lost' : 'Drawn'} by {end?.reason} against {setup.bot.name}.
            {setup.rated && ratingDelta != null && (
              <>
                {' '}Ladder rating {newRatingValue ?? ''} ({ratingDelta >= 0 ? '+' : ''}
                {ratingDelta}).
              </>
            )}
          </p>
          <div className="mt-2 flex flex-col gap-2">
            <Button className="btn-hero w-full py-3" onClick={() => onReview(savedPgn)}>
              <LineChart className="h-4 w-4" /> Game review
            </Button>
            <div className="flex gap-2">
              <Button className="btn-hero flex-1 py-2.5" onClick={() => onExit(true)}>
                <RefreshCw className="h-4 w-4" /> Rematch
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

function buildPgn(g: Chess, setup: Setup, playerName: string, end: GameEnd): string {
  try {
    const result = end.result === 'win' ? (setup.playerColor === 'w' ? '1-0' : '0-1') : end.result === 'loss' ? (setup.playerColor === 'w' ? '0-1' : '1-0') : '1/2-1/2'
    g.setHeader('Event', setup.rated ? 'Ply Bot Ladder' : 'Ply Casual')
    g.setHeader('White', setup.playerColor === 'w' ? playerName : `${setup.bot.name} (${setup.bot.rating})`)
    g.setHeader('Black', setup.playerColor === 'b' ? playerName : `${setup.bot.name} (${setup.bot.rating})`)
    g.setHeader('Result', result)
    return g.pgn()
  } catch {
    return ''
  }
}
