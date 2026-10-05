'use client'

import { useEffect, useRef, useState } from 'react'
import { useApp } from '@/lib/store'
import { readJson } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SpeakButton } from '@/components/chess/speak-button'
import { CharacterFace } from '@/components/chess/characters'
import { coachMaybe } from '@/lib/coaches'
import { CoachChoice } from '@/components/shell/coach-choice'
import { cn } from '@/lib/utils'
import { Send, X } from 'lucide-react'

export interface CoachContext {
  fen?: string
  lessonTitle?: string
  stepHint?: string
  pgn?: string
  moves?: string
  skillLevel?: string
  greeting?: string
}

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

export function CoachDrawer({
  open,
  onOpenChange,
  context,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  context: CoachContext
}) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { profile } = useApp()
  const coach = coachMaybe(profile?.coach)

  // fresh thread per open
  useEffect(() => {
    if (open) {
      setMessages([])
      setError(null)
    }
  }, [open, context.lessonTitle, context.fen])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, busy])

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    if (!coach) {
      setError('Pick a coach first. They answer here and in your lessons.')
      return
    }
    setInput('')
    setError(null)
    const next: Msg[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setBusy(true)
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next,
          context: { ...context, skillLevel: context.skillLevel ?? profile?.skillLevel ?? 'beginner', coach: coach.id },
        }),
      })
      const data = await readJson<{ content?: string; error?: string }>(res)
      if (!res.ok || !data.content) throw new Error(data.error ?? 'The coach could not answer. Try again.')
      setMessages((m) => [...m, { role: 'assistant', content: data.content }])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn(
        'fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-sidebar-border bg-card shadow-2xl transition-transform duration-200',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
      role="dialog"
      aria-label="Coach"
      aria-hidden={!open}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          {coach ? (
            <>
              <CharacterFace id={coach.id} label={coach.name} className="h-9 w-9 shrink-0 rounded-full border border-primary/50" />
              <div>
                <div className="text-sm font-bold leading-4">{coach.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {profile?.aiProvider && profile.aiProvider !== 'builtin' ? 'Your own API key' : 'ChessX AI'}
                </div>
              </div>
            </>
          ) : (
            <div className="text-sm font-bold leading-4">Coach</div>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="Close coach">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div ref={scrollRef} className="scroll-slim flex-1 space-y-3 overflow-y-auto p-4">
        {!coach ? (
          <CoachChoice layout="panel" title="Pick your coach" subtitle="They answer here and in your lessons. You can switch any time in Settings." />
        ) : messages.length === 0 && (
          <div className="rounded-md bg-secondary p-3 text-sm text-muted-foreground">
            {context.lessonTitle
              ? `You're in "${context.lessonTitle}". Ask about the current position, the idea behind a move, or anything from the lesson.`
              : 'Ask about a position, a plan, or your games.'}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            {m.role === 'assistant' && coach && (
              <CharacterFace id={coach.id} className="mr-2 mt-1 h-7 w-7 shrink-0 rounded-full" />
            )}
            <div
              className={cn(
                'max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed',
                m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground',
              )}
            >
              {m.content}
            </div>
            {m.role === 'assistant' && coach && <SpeakButton text={m.content} voice={coach.voice} speed={coach.speed} className="ml-1 mt-0.5" />}
          </div>
        ))}
        {busy && <div className="text-sm text-muted-foreground">Thinking…</div>}
        {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      </div>

      <form
        className="flex gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
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
  )
}
