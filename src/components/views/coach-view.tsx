'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { ChessBoard } from '@/components/chess/board'
import { useApp } from '@/lib/store'
import { readJson } from '@/lib/api-client'
import { PROVIDERS } from '@/lib/ai-providers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SpeakButton } from '@/components/chess/speak-button'
import { CharacterFace } from '@/components/chess/characters'
import { coachMaybe } from '@/lib/coaches'
import { CoachChoice } from '@/components/shell/coach-choice'
import { ArtifactCard } from '@/components/coach/artifact-card'
import { CoachDrillsShelf } from '@/components/coach/drills-shelf'
import type { ArtifactView } from '@/lib/coach-artifacts'
import { nextUnlockedId } from '@/lib/unlock'
import { findLevel } from '@/content/levels'
import type { ViewName } from '@/lib/store'
import type { CoachAction } from '@/lib/coach-commands-catalog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CommandPalette, buildCommandList, commandNeedsArgs } from '@/components/coach/command-palette'
import type { CommandDef } from '@/lib/coach-commands-catalog'
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
  Puzzle,
  Target,
  Brain,
  Crown,
  Castle,
  SlashSquare,
} from 'lucide-react'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  /** Coach skill output rendered under the bubble. */
  artifact?: ArtifactView
  /** Extra artifacts (the daily challenge ships a puzzle AND a quiz). */
  artifacts?: ArtifactView[]
}

interface SendCtx {
  fen?: string
  moves?: string
  pgn?: string
  gameId?: string
}

type SkillButton = 'level_puzzle' | 'position_drill' | 'level_quiz' | 'mate_hunt' | 'endgame_drill'

const VALID_VIEWS: ViewName[] = ['home', 'play', 'lessons', 'lesson', 'puzzles', 'review', 'coach', 'analysis', 'profile', 'settings']

const SKILL_RUNNING = 'Crafting, verifying every move with the engine. This can take half a minute.'

const SUGGESTIONS = [
  'Generate a puzzle for my level.',
  "What's the plan for the side to move?",
  'What can you do?',
  'Build me a drill from this position.',
]

function sanLine(sans: string[]): string {
  let s = ''
  for (let i = 0; i < sans.length; i++) {
    s += i % 2 === 0 ? `${i / 2 + 1}. ${sans[i]} ` : `${sans[i]} `
  }
  return s.trim()
}

export function CoachView() {
  const { profile, navigate, patchProfile } = useApp()
  const coach = coachMaybe(profile?.coach)
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

  // Coach skills: the tutor can generate level-calibrated puzzles, drills
  // and quizzes; generated material is verified server-side before it lands.
  const [busySkill, setBusySkill] = useState<SkillButton | null>(null)
  const [skillNote, setSkillNote] = useState<string | null>(null)
  const [courseRef, setCourseRef] = useState<{ tier: string; level: number; label: string | null } | null>(null)
  const [drills, setDrills] = useState<ArtifactView[]>([])
  const [drillOpen, setDrillOpen] = useState<ArtifactView | null>(null)

  // The / command palette: browse every coach skill while typing.
  const [paletteDismissed, setPaletteDismissed] = useState(false)
  const [paletteIndex, setPaletteIndex] = useState(0)
  const paletteList = useMemo(() => (input.startsWith('/') ? buildCommandList(input) : []), [input])
  const paletteVisible = input.startsWith('/') && !paletteDismissed && paletteList.length > 0 && !busy

  // The level anchor: first unlocked, unfinished level in course order.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/progress')
        const data = await readJson<{ progress?: Array<{ lessonId: string; completed: boolean }> }>(res)
        if (cancelled) return
        const done = new Set((data.progress ?? []).filter((p) => p.completed).map((p) => p.lessonId))
        const nextId = nextUnlockedId(done)
        if (!nextId) {
          setCourseRef(null)
          return
        }
        const ref = findLevel(nextId)
        if (ref) {
          setCourseRef({ tier: ref.tier.id, level: ref.level.n, label: `${ref.tier.title} · Level ${ref.level.n}` })
        }
      } catch {
        /* the skills still work without the anchor: the server falls back */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const refreshDrills = useCallback(async () => {
    try {
      const res = await fetch('/api/coach/artifacts?limit=24')
      const data = await readJson<{ artifacts?: ArtifactView[] }>(res)
      setDrills(data.artifacts ?? [])
    } catch {
      /* shelf stays as-is on a failed refresh */
    }
  }, [])

  useEffect(() => {
    void refreshDrills()
  }, [refreshDrills])

  const runSkill = useCallback(
    async (skill: SkillButton) => {
      if (busySkill || busy) return
      setBusySkill(skill)
      setSkillNote(SKILL_RUNNING)
      setError(null)
      setMobileTab('chat')
      try {
        const res = await fetch('/api/ai/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skill,
            tier: courseRef?.tier,
            level: courseRef?.level,
            ...(skill === 'position_drill' ? { fen } : {}),
          }),
        })
        const data = await readJson<{ artifact?: ArtifactView; error?: string }>(res)
        if (!res.ok || !data.artifact) throw new Error(data.error ?? 'The coach could not generate that right now.')
        const a = data.artifact
        const lead =
          a.kind === 'quiz'
            ? 'Fresh quiz, made for your level:'
            : a.kind === 'drill'
              ? 'Drill built from your position:'
              : skill === 'mate_hunt'
                ? 'A forced mate, engine-checked. Your move:'
                : skill === 'endgame_drill'
                  ? 'Endgame technique, verified move by move:'
                  : 'Fresh puzzle, calibrated to your level:'
        setMessages((m) => [...m, { role: 'assistant', content: `${lead} ${a.title}.`, artifact: a }])
        void refreshDrills()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusySkill(null)
        setSkillNote(null)
      }
    },
    [busySkill, busy, courseRef, fen, refreshDrills],
  )

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, busy])

  // A game handed over from the Game review tab: walk through it here, with
  // the stored engine report facts attached server-side via gameId.
  // The flag is read inside the effect on purpose: clearing it re-renders the
  // component, and a dep change here would cancel the in-flight handoff.
  useEffect(() => {
    const pendingGame = useApp.getState().pendingCoachGame
    if (!pendingGame) return
    useApp.getState().setPendingCoachGame(null)
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/games?limit=50')
        const data = await readJson<{ games?: Array<{ id: string; pgn?: string; finalFen?: string; botName?: string }> }>(res)
        const g = data.games?.find(
          (x) => x.id === pendingGame,
        )
        if (cancelled) return
        if (!g) {
          setError('Could not load that game.')
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
            /* keep the current board */
          }
        }
        void send(
          `Walk me through this game. Where did it turn, what were the key moments, and what should I work on?`,
          { pgn: g.pgn, fen: g.finalFen, gameId: g.id },
        )
      } catch {
        if (!cancelled) setError('Could not load your games.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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

  // App-control actions the coach executes directly: flip or reset the board,
  // navigate, switch coach, flip dark mode or sound. Profile bits persist
  // through the same PATCH endpoint the settings screen uses.
  const applyAction = useCallback(
    (action: CoachAction) => {
      switch (action.type) {
        case 'flip_board':
          setOrientation((o) => (o === 'w' ? 'b' : 'w'))
          break
        case 'reset_board':
          reset()
          break
        case 'goto':
          if (VALID_VIEWS.includes(action.view as ViewName)) navigate(action.view as ViewName)
          break
        case 'toggle_dark':
        case 'toggle_sound': {
          if (!profile) break
          const patch =
            action.type === 'toggle_dark'
              ? { darkMode: profile.darkMode === 'dark' ? 'light' : 'dark' }
              : { soundEnabled: !profile.soundEnabled }
          patchProfile(patch)
          void fetch('/api/profile', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          }).catch(() => {
            /* the optimistic toggle stands; settings can fix it */
          })
          break
        }
        case 'switch_coach': {
          if (!profile || action.coachId === profile.coach) break
          patchProfile({ coach: action.coachId })
          void fetch('/api/profile', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ coach: action.coachId }),
          })
            .then(async (res) => {
              const d = await readJson<{ profile?: typeof profile }>(res)
              if (d.profile) patchProfile(d.profile)
            })
            .catch(() => {
              /* keep the optimistic switch */
            })
          break
        }
      }
    },
    [profile, reset, navigate, patchProfile],
  )

  const send = useCallback(
    async (text: string, ctx?: SendCtx, base?: Msg[]) => {
      const trimmed = text.trim()
      if (!trimmed || busy) return
      const baseMessages = base ?? messages
      const next: Msg[] = [...baseMessages, { role: 'user', content: trimmed }]
      lastAttempt.current = next
      setMessages(next)
      setInput('')
      setPaletteDismissed(false)
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
            context: {
              ...context,
              skillLevel: profile?.skillLevel ?? 'beginner',
              coach: coach.id,
              ...(courseRef ? { tier: courseRef.tier, level: courseRef.level } : {}),
            },
          }),
        })
        const data = await readJson<{
          content?: string
          error?: string
          artifact?: ArtifactView
          artifacts?: ArtifactView[]
          action?: CoachAction
        }>(res)
        if (!res.ok || !data.content) throw new Error(data.error ?? 'The coach could not answer. Try again.')
        const artifacts = data.artifacts?.length ? data.artifacts : data.artifact ? [data.artifact] : []
        setMessages((m) => [
          ...m,
          { role: 'assistant', content: data.content!, ...(artifacts.length ? { artifacts } : {}) },
        ])
        if (artifacts.length) void refreshDrills()
        if (data.action) applyAction(data.action)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [busy, messages, fen, sans, profile?.skillLevel, courseRef, refreshDrills, applyAction],
  )

  // Palette pick: fill the input for commands that take arguments, execute
  // ready ones immediately.
  const pickCommand = useCallback(
    (def: CommandDef) => {
      if (commandNeedsArgs(def, input)) {
        setInput(`${def.cmd} `)
        setPaletteDismissed(false)
        return
      }
      void send(def.cmd)
    },
    [input, send],
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
      const res = await fetch('/api/games?limit=5')
      const data = await readJson<{ games?: Array<{ id: string; pgn?: string; opponent?: string; botName?: string; finalFen?: string }> }>(res)
      const g = data.games?.[0]
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
        `Review my game against ${g.opponent ?? g.botName ?? 'my opponent'}. Where did it turn, what were the key mistakes, and what should I work on?`,
        { pgn: g.pgn, fen: g.finalFen, gameId: g.id },
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
    <div className="space-y-4">
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
        Move pieces for either side. Every question you ask includes the position on this board, so set it up first and then ask. "Drill from this position" turns whatever stands here into a training task.
      </p>
      </div>

      <CoachDrillsShelf
        drills={drills}
        onOpen={setDrillOpen}
        onNavigateLessons={() => navigate('lessons')}
        courseLabel={courseRef?.label ?? null}
      />
    </div>
  )

  const chatPanel = coach ? (
    <div className="flex h-[560px] flex-col overflow-hidden rounded-lg bg-card shadow-sm lg:h-[640px]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <CharacterFace id={coach.id} label={coach.name} className="h-9 w-9 shrink-0 rounded-full border border-primary/50" />
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
              Talk to me like a person: ask about the position on the board, a plan, an opening, or what went wrong in a game. I can build training for you, every move verified by the engine before you see it, and I can drive the app itself: flip the board, open a section, switch the coach. Type{' '}
              <button
                className="font-mono font-semibold text-primary hover:underline"
                onClick={() => setInput('/')}
                aria-label="Open the command palette"
              >
                /
              </button>{' '}
              to browse all 30 skills, or{' '}
              <button className="font-semibold text-primary hover:underline" onClick={() => void send('/help')}>
                /help
              </button>{' '}
              for the list. For a full move-by-move review, play a game first and use{' '}
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
          <div key={i} className="space-y-2">
            <div className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              {m.role === 'assistant' && (
                <CharacterFace id={coach.id} className="mr-2 mt-1 h-7 w-7 shrink-0 rounded-full" />
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
            {(m.artifact || m.artifacts?.length) && (
              <div className="space-y-2 pl-9">
                {[...(m.artifacts ?? []), ...(m.artifact ? [m.artifact] : [])].map((a) => (
                  <ArtifactCard key={a.id} artifact={a} onRecorded={() => void refreshDrills()} />
                ))}
              </div>
            )}
          </div>
        ))}

        {(busy || busySkill) && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:120ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:240ms]" />
            </span>
            {busySkill ? 'Generating and verifying' : 'Coach is thinking'}
          </div>
        )}
        {skillNote && busySkill && <p className="text-[11px] text-muted-foreground">{skillNote}</p>}

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

      <div className="relative border-t border-border">
        <div className="flex gap-2 overflow-x-auto px-3 pt-2 pb-1 [scrollbar-width:none]">
          <button
            onClick={() => void runSkill('level_puzzle')}
            disabled={busy || busySkill != null}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-50"
          >
            <Puzzle className="h-3.5 w-3.5" /> Puzzle for my level{courseRef?.label ? ` (${courseRef.level})` : ''}
          </button>
          <button
            onClick={() => void runSkill('position_drill')}
            disabled={busy || busySkill != null}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-50"
          >
            <Target className="h-3.5 w-3.5" /> Drill from this position
          </button>
          <button
            onClick={() => void runSkill('level_quiz')}
            disabled={busy || busySkill != null}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-50"
          >
            <Brain className="h-3.5 w-3.5" /> Level quiz
          </button>
          <button
            onClick={() => void runSkill('mate_hunt')}
            disabled={busy || busySkill != null}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-50"
          >
            <Crown className="h-3.5 w-3.5" /> Mate hunt
          </button>
          <button
            onClick={() => void runSkill('endgame_drill')}
            disabled={busy || busySkill != null}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-50"
          >
            <Castle className="h-3.5 w-3.5" /> Endgame drill
          </button>
          <button
            onClick={() => void send('/trap')}
            disabled={busy || busySkill != null}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold transition hover:bg-accent disabled:opacity-50"
          >
            <SlashSquare className="h-3.5 w-3.5" /> Opening trap
          </button>
          <button
            onClick={() => void send('/famous')}
            disabled={busy || busySkill != null}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold transition hover:bg-accent disabled:opacity-50"
          >
            <Swords className="h-3.5 w-3.5" /> Famous game
          </button>
          <button
            onClick={() => void send('/help')}
            disabled={busy || busySkill != null}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold transition hover:bg-accent disabled:opacity-50"
          >
            <ListChecks className="h-3.5 w-3.5" /> All skills (/help)
          </button>
          <button
            onClick={() => void reviewLastGame()}
            disabled={busy || busySkill != null}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold transition hover:bg-accent disabled:opacity-50"
          >
            <Swords className="h-3.5 w-3.5" /> Review my last game
          </button>
          <button
            onClick={quizMe}
            disabled={busy || busySkill != null}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold transition hover:bg-accent disabled:opacity-50"
          >
            <GraduationCap className="h-3.5 w-3.5" /> Quiz me
          </button>
          <button
            onClick={() => void send('What should I focus on in this position to improve?')}
            disabled={busy || busySkill != null}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold transition hover:bg-accent disabled:opacity-50"
          >
            <ListChecks className="h-3.5 w-3.5" /> Improvement plan
          </button>
          <button
            onClick={() => void send('Summarize the position: material, king safety, and the best plan for both sides.')}
            disabled={busy || busySkill != null}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold transition hover:bg-accent disabled:opacity-50"
          >
            <ClipboardCheck className="h-3.5 w-3.5" /> Summarize position
          </button>
        </div>
        <form
          className="flex gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault()
            // Incomplete command word with the palette open: complete it
            // instead of sending a half-typed slash to the server.
            if (paletteVisible && !/\s/.test(input.trim())) {
              const def = paletteList[Math.min(paletteIndex, paletteList.length - 1)]
              if (def && def.cmd !== input.trim()) {
                e.preventDefault()
                pickCommand(def)
                return
              }
            }
            void send(input)
          }}
        >
          <Input
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setPaletteDismissed(false)
            }}
            onKeyDown={(e) => {
              if (!paletteVisible) return
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setPaletteIndex((i) => (i + 1) % paletteList.length)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setPaletteIndex((i) => (i - 1 + paletteList.length) % paletteList.length)
              } else if (e.key === 'Tab') {
                e.preventDefault()
                const def = paletteList[Math.min(paletteIndex, paletteList.length - 1)]
                if (def) setInput(commandNeedsArgs(def, input) ? `${def.cmd} ` : def.cmd)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setPaletteDismissed(true)
              }
            }}
            placeholder="Ask the coach… or type / for skills"
            disabled={busy}
            aria-label="Message the coach"
            autoComplete="off"
          />
          <Button type="submit" className="btn-hero px-4" disabled={busy || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
          {paletteVisible && (
            <CommandPalette
              list={paletteList}
              highlight={Math.min(paletteIndex, paletteList.length - 1)}
              onHighlight={setPaletteIndex}
              onPick={pickCommand}
              onClose={() => setPaletteDismissed(true)}
              className="left-3 right-3"
            />
          )}
        </form>
      </div>
    </div>
  ) : null

  if (!coach) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <h1 className="font-display text-2xl font-extrabold">Coach</h1>
        <p className="mb-2 mt-1 text-sm text-muted-foreground">Your coach guides every chat, lesson and review. Pick who fits you, switch any time.</p>
        <CoachChoice />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-extrabold">Coach</h1>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground">
          {providerLabel}
        </span>
        {courseRef?.label && (
          <button
            onClick={() => navigate('lessons')}
            className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary transition hover:bg-primary/20"
            title="Your current course level, used to calibrate generated material"
          >
            {courseRef.label}
          </button>
        )}
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

      <Dialog open={drillOpen != null} onOpenChange={(o) => !o && setDrillOpen(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{drillOpen?.title ?? 'Drill'}</DialogTitle>
          </DialogHeader>
          {drillOpen && (
            <ArtifactCard
              artifact={drillOpen}
              onRemove={() => {
                const id = drillOpen.id
                setDrills((d) => d.filter((x) => x.id !== id))
                setDrillOpen(null)
                void fetch(`/api/coach/artifacts?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
