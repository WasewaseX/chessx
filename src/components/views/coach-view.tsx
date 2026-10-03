'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard } from '@/components/chess/board'
import { useApp } from '@/lib/store'
import { PROVIDERS } from '@/lib/ai-providers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SpeakButton } from '@/components/chess/speak-button'
import { coachById } from '@/lib/coaches'
import { cn } from '@/lib/utils'
import {
  ArrowLeftRight,
  RotateCcw,
  Copy,
  Check,
  Send,
  Trash2,
  Undo2,
  Swords,
  GraduationCap,
  ListChecks,
  ClipboardCheck,
} from 'lucide-react'

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

interface SendCtx {
  fen?: string
  moves?: string
  pgn?: string
}

const SUGGESTIONS = [
  "What's the plan for the side to move?",
  'Find the tactics in this position.',
  'What would you play here, and why?',
  'Give me a training task based on this position.',
]

function sanLine(sans: string[]): string {
  let s = ''
  for (let i = 0; i < sans.length; i++) {
    s += i % 2 === 0 ? `${i / 2 + 1}. ${sans[i]} ` : `${sans[i]} `
  }
  return s.trim()
}

export function CoachView() {
  const { profile, navigate } = useApp()
  const coach = coachById(profile?.coach ?? 'nina')
  const gameRef = useRef(new Chess())
  const [fen, setFen] = useState(gameRef.current.fen())
  const [sans, setSans] = useState<string[]>([])
  const [history, setHistory] = useState<string[]>([gameRef.current.fen()])
  const [orientation, setOrientation] = useState<'w' | 'b'>('w')
  const [fenInput, setFenInput] = useState('')
  const [fenError, setFenError] = useState(false)
  const [copied, setCopied] = useState(false)

  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastAttempt = useRef<Msg[] | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [mobileTab, setMobileTab] = useState<'board' | 'chat'>('chat')

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, busy])

  const provider = profile?.aiProvider ?? 'builtin'
  const providerLabel =
    provider === 'builtin' ? 'ChessX AI · built-in' : `${PROVIDERS[provider]?.label ?? provider} · your key`

  const onMove = useCallback(
    (from: Square, to: Square, promotion?: string) => {
      const g = gameRef.current
      const mv = g.move({ from, to, promotion: promotion ?? 'q' })
      if (!mv) return
      setSans((s) => [...s, mv.san])
      setHistory((h) => [...h, g.fen()])
      setFen(g.fen())
      setFenError(false)
    },
    [],
  )

  const undo = useCallback(() => {
    const g = gameRef.current
    if (history.length < 2) return
    g.undo()
    setHistory((h) => h.slice(0, -1))
    setSans((s) => s.slice(0, -1))
    setFen(g.fen())
  }, [history.length])

  const reset = useCallback(() => {
    gameRef.current = new Chess()
    setFen(gameRef.current.fen())
    setHistory([gameRef.current.fen()])
    setSans([])
    setFenInput('')
    setFenError(false)
  }, [])

  const applyFen = useCallback(() => {
    const value = fenInput.trim()
    if (!value) return
    try {
      const g = new Chess(value)
      gameRef.current = g
      setFen(g.fen())
      setHistory([g.fen()])
      setSans([])
      setFenError(false)
    } catch {
      setFenError(true)
    }
  }, [fenInput])

  const copyFen = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fen)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard unavailable */
    }
  }, [fen])

  const send = useCallback(
    async (text: string, ctx?: SendCtx, base?: Msg[]) => {
      const trimmed = text.trim()
      if (!trimmed || busy) return
      const baseMessages = base ?? messages
      const next: Msg[] = [...baseMessages, { role: 'user', content: trimmed }]
      lastAttempt.current = next
      setMessages(next)
      setInput('')
      setError(null)
      setBusy(true)
      setMobileTab('chat')
      const context: SendCtx = ctx ?? { fen, moves: sanLine(sans) || undefined }
      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: next.slice(-16),
            context: { ...context, skillLevel: profile?.skillLevel ?? 'beginner', coach: coach.id },
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'The coach could not answer. Try again.')
        setMessages((m) => [...m, { role: 'assistant', content: data.content }])
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [busy, messages, fen, sans, profile?.skillLevel],
  )

  const retry = useCallback(() => {
    const attempt = lastAttempt.current
    if (!attempt || busy) return
    const base = attempt.slice(0, -1)
    const last = attempt[attempt.length - 1]
    setMessages(base)
    void send(last.content, undefined, base)
  }, [busy, send])

  const reviewLastGame = useCallback(async () => {
    try {
      const res = await fetch('/api/games?limit=1')
      const data = await res.json()
      const g = data.games?.[0] as { pgn?: string; finalFen?: string; botName?: string } | undefined
      if (!g?.pgn) {
        setError('No games to review yet. Play one against a bot first.')
        return
      }
      if (g.finalFen) {
        try {
          const check = new Chess(g.finalFen)
          gameRef.current = check
          setFen(check.fen())
          setHistory([check.fen()])
          setSans([])
        } catch {
          /* keep current board */
        }
      }
      void send(
        `Review my game against ${g.botName ?? 'the bot'}. Where did it turn, what were the key mistakes, and what should I work on?`,
        { pgn: g.pgn, fen: g.finalFen },
      )
    } catch {
      setError('Could not load your games.')
    }
  }, [send])

  const quizMe = useCallback(() => {
    void send(
      'Quiz me on the current position. Ask one question at a time and wait for my answer before moving on.',
    )
  }, [send])

  const clearChat = useCallback(() => {
    setMessages([])
    setError(null)
    lastAttempt.current = null
  }, [])

  // re-computed on every render; fen state changes guarantee freshness after each move
  const lastMove = (() => {
    const hist = gameRef.current.history({ verbose: true })
    const last = hist[hist.length - 1]
    return last ? { from: last.from, to: last.to } : null
  })()

  const boardPanel = (
    <div className="rounded-lg bg-card p-4 shadow-sm">
      <div className="mx-auto max-w-[520px]">
        <ChessBoard
          fen={fen}
          orientation={orientation}
          onMove={onMove}
          movableSide="both"
          lastMove={lastMove}
        />
      </div>

      <div className="mx-auto mt-3 flex max-w-[520px] flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={reset}>
          <RotateCcw className="h-4 w-4" /> Reset
        </Button>
        <Button variant="secondary" size="sm" onClick={undo} disabled={history.length < 2}>
          <Undo2 className="h-4 w-4" /> Undo
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))}
        >
          <ArrowLeftRight className="h-4 w-4" /> Flip
        </Button>
        <Button variant="secondary" size="sm" onClick={copyFen}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} FEN
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          <Input
            value={fenInput}
            onChange={(e) => {
              setFenInput(e.target.value)
              setFenError(false)
            }}
            onKeyDown={(e) => e.key === 'Enter' && applyFen()}
            placeholder="Paste FEN"
            className="h-8 w-40 text-xs sm:w-52"
            aria-label="Paste a FEN to set up the board"
          />
          <Button size="sm" onClick={applyFen} disabled={!fenInput.trim()}>
            Set
          </Button>
        </div>
      </div>
      {fenError && <p className="mx-auto mt-2 max-w-[520px] text-xs text-destructive">That FEN did not parse. Check it and try again.</p>}

      {sans.length > 0 && (
        <div className="mx-auto mt-3 max-w-[520px] rounded-md bg-secondary/60 px-3 py-2 text-sm leading-relaxed">
          <span className="font-semibold text-muted-foreground">Line: </span>
          <span className="font-medium">{sanLine(sans)}</span>
        </div>
      )}

      <p className="mx-auto mt-3 max-w-[520px] text-xs text-muted-foreground">
        Move pieces for either side. Every question you ask includes the position on this board, so set it up first and then ask.
      </p>
    </div>
  )

  const chatPanel = (
    <div className="flex h-[560px] flex-col overflow-hidden rounded-lg bg-card shadow-sm lg:h-[640px]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <img src={coach.face} alt={coach.name} className="h-9 w-9 rounded-full border border-primary/50 object-cover object-top" />
          <div>
            <div className="text-sm font-bold leading-4">{coach.name}</div>
            <div className="text-[11px] text-muted-foreground">{coach.title}</div>
            <button
              className="text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => navigate('settings')}
              title="Change AI provider in Settings"
            >
              {providerLabel}
            </button>
          </div>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearChat}>
            <Trash2 className="h-4 w-4" /> Clear
          </Button>
        )}
      </div>

      <div ref={scrollRef} className="scroll-slim min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && !busy && (
          <div>
            <div className="rounded-md bg-secondary p-3 text-sm leading-relaxed text-muted-foreground">
              Set up any position on the board, then ask. Plans, tactics, openings, endgames, or what went wrong in a game, the coach sees whatever is on the board. For a full move-by-move review, play a game first and use{' '}
              <button className="font-semibold text-primary hover:underline" onClick={() => navigate('analysis')}>
                Game review
              </button>
              .
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="rounded-md border border-border px-3 py-2 text-left text-sm font-medium transition hover:border-primary/50 hover:bg-secondary"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            {m.role === 'assistant' && (
              <img src={coach.face} alt="" className="mr-2 mt-1 h-7 w-7 shrink-0 rounded-full object-cover object-top" />
            )}
            <div
              className={cn(
                'max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed',
                m.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground',
              )}
            >
              {m.content}
            </div>
            {m.role === 'assistant' && <SpeakButton text={m.content} voice={coach.voice} speed={coach.speed} className="ml-1 mt-0.5" />}
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:120ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:240ms]" />
            </span>
            Coach is thinking
          </div>
        )}

        {error && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <span className="min-w-0 flex-1">{error}</span>
            {lastAttempt.current && (
              <Button variant="outline" size="sm" className="h-7" onClick={retry}>
                Try again
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-border">
        <div className="flex gap-2 overflow-x-auto px-3 pt-2 pb-1 [scrollbar-width:none]">
          <button
            onClick={() => void reviewLastGame()}
            disabled={busy}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold transition hover:bg-accent disabled:opacity-50"
          >
            <Swords className="h-3.5 w-3.5" /> Review my last game
          </button>
          <button
            onClick={quizMe}
            disabled={busy}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold transition hover:bg-accent disabled:opacity-50"
          >
            <GraduationCap className="h-3.5 w-3.5" /> Quiz me
          </button>
          <button
            onClick={() => void send('What should I focus on in this position to improve?')}
            disabled={busy}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold transition hover:bg-accent disabled:opacity-50"
          >
            <ListChecks className="h-3.5 w-3.5" /> Improvement plan
          </button>
          <button
            onClick={() => void send('Summarize the position: material, king safety, and the best plan for both sides.')}
            disabled={busy}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold transition hover:bg-accent disabled:opacity-50"
          >
            <ClipboardCheck className="h-3.5 w-3.5" /> Summarize position
          </button>
        </div>
        <form
          className="flex gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault()
            void send(input)
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the coach…"
            disabled={busy}
            aria-label="Message the coach"
          />
          <Button type="submit" className="btn-hero px-4" disabled={busy || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  )

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-extrabold">Coach</h1>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground">
          {providerLabel}
        </span>
      </div>

      {/* mobile tabs */}
      <div className="mb-3 flex overflow-hidden rounded-md border lg:hidden">
        {(['board', 'chat'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setMobileTab(t)}
            className={cn(
              'flex-1 px-4 py-2 text-sm font-semibold capitalize',
              mobileTab === t ? 'bg-primary text-primary-foreground' : 'bg-secondary',
            )}
          >
            {t === 'board' ? 'Board' : 'Chat'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <div className={mobileTab === 'board' ? '' : 'hidden lg:block'}>{boardPanel}</div>
        <div className={mobileTab === 'chat' ? '' : 'hidden lg:block'}>{chatPanel}</div>
      </div>
    </div>
  )
}
