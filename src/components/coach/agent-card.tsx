'use client'

// Live mission card: renders an agent task with its step checklist, streams
// progress over SSE, shows the final report and opens the verified artifacts
// the mission produced. Works even if the stream dies: it polls the snapshot
// endpoint as a fallback while the task is still running.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentEvent, AgentTaskView } from '@/lib/agent-types'
import type { ArtifactView } from '@/lib/coach-artifacts'
import { displayTitle } from '@/lib/coach-artifacts'
import type { CoachAction } from '@/lib/coach-commands-catalog'
import { readJson } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Bot,
  BookOpen,
  CalendarCheck,
  Check,
  Crown,
  Dumbbell,
  FlaskConical,
  Loader2,
  Microscope,
  Minus,
  Radar,
  Sparkles,
  Sunrise,
  Swords,
  Wrench,
  X,
  XCircle,
} from 'lucide-react'

const ICONS: Record<string, typeof Bot> = {
  plan: CalendarCheck,
  autopsy: Microscope,
  bootcamp: Dumbbell,
  radar: Radar,
  repertoire: BookOpen,
  lab: FlaskConical,
  gauntlet: Swords,
  masterclass: Crown,
  regimen: Sunrise,
  sparring: Bot,
  agent: Sparkles,
  fixit: Wrench,
}

const STATUS_BADGE: Record<AgentTaskView['status'], { label: string; cls: string }> = {
  running: { label: 'Running', cls: 'bg-primary/10 text-primary' },
  done: { label: 'Complete', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  failed: { label: 'Stopped', cls: 'bg-destructive/10 text-destructive' },
  cancelled: { label: 'Cancelled', cls: 'bg-secondary text-muted-foreground' },
}

interface Props {
  taskId: string
  /** Called when new artifacts land (refresh the drills shelf). */
  onArtifactsChanged?: () => void
  /** App actions queued by the mission (open the play screen, etc). */
  onAction?: (a: CoachAction) => void
  /** Open an artifact in the drill dialog. */
  onOpenArtifact?: (a: ArtifactView) => void
}

export function AgentTaskCard({ taskId, onArtifactsChanged, onAction, onOpenArtifact }: Props) {
  const [task, setTask] = useState<AgentTaskView | null>(null)
  const [notFound, setNotFound] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const notifiedDone = useRef(false)

  const handleDone = useCallback(
    (t: AgentTaskView) => {
      if (notifiedDone.current) return
      notifiedDone.current = true
      if (t.artifacts.length) onArtifactsChanged?.()
      for (const a of t.actions) onAction?.(a)
    },
    [onArtifactsChanged, onAction],
  )

  useEffect(() => {
    let cancelled = false
    notifiedDone.current = false

    const applyEvent = (e: AgentEvent) => {
      if (cancelled) return
      if (e.type === 'snapshot' || e.type === 'done') {
        setTask(e.task)
        if (e.task.status !== 'running') {
          handleDone(e.task)
          esRef.current?.close()
        }
        return
      }
      setTask((t) => {
        if (!t) return t
        if (e.type === 'steps') {
          // The agent grew the checklist mid-mission (planning step ran).
          return { ...t, steps: e.steps }
        }
        if (e.type === 'step') {
          const steps = [...t.steps]
          steps[e.index] = e.step
          return { ...t, steps }
        }
        if (e.type === 'log') {
          const steps = [...t.steps]
          const cur = steps[e.index]
          if (cur) steps[e.index] = { ...cur, log: e.text }
          return { ...t, steps }
        }
        if (e.type === 'artifact') {
          if (t.artifacts.some((a) => a.id === e.artifact.id)) return t
          return { ...t, artifacts: [...t.artifacts, e.artifact] }
        }
        if (e.type === 'status') return { ...t, status: e.status }
        return t
      })
    }

    let pollTimer: ReturnType<typeof setInterval> | null = null

    ;(async () => {
      try {
        const res = await fetch(`/api/agent/task?id=${encodeURIComponent(taskId)}`)
        if (res.status === 404) {
          setNotFound(true)
          return
        }
        const data = await readJson<{ task?: AgentTaskView }>(res)
        if (cancelled) return
        if (data.task) {
          setTask(data.task)
          if (data.task.status !== 'running') {
            handleDone(data.task)
            return
          }
        }
        // Live channel
        const es = new EventSource(`/api/agent/stream?id=${encodeURIComponent(taskId)}`)
        esRef.current = es
        es.onmessage = (ev) => {
          try {
            const parsed = JSON.parse(ev.data) as AgentEvent
            applyEvent(parsed)
          } catch {
            /* a malformed frame is skipped */
          }
        }
        es.onerror = () => {
          // The task may still be running with a flaky stream: fall back to
          // polling until the snapshot says otherwise.
          es.close()
          if (cancelled || pollTimer) return
          pollTimer = setInterval(async () => {
            try {
              const r = await fetch(`/api/agent/task?id=${encodeURIComponent(taskId)}`)
              if (r.status === 404) {
                setNotFound(true)
                if (pollTimer) clearInterval(pollTimer)
                return
              }
              const d = await readJson<{ task?: AgentTaskView }>(r)
              if (d.task) {
                setTask(d.task)
                if (d.task.status !== 'running') {
                  handleDone(d.task)
                  if (pollTimer) clearInterval(pollTimer)
                }
              }
            } catch {
              /* keep polling */
            }
          }, 2500)
        }
      } catch {
        if (!cancelled) setNotFound(true)
      }
    })()

    return () => {
      cancelled = true
      esRef.current?.close()
      if (pollTimer) clearInterval(pollTimer)
    }
  }, [taskId, handleDone])

  const cancel = useCallback(async () => {
    try {
      await fetch('/api/agent/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId }),
      })
    } catch {
      /* the card keeps polling; the mission finishes on its own */
    }
  }, [taskId])

  if (notFound) {
    return (
      <div className="rounded-lg border border-border/70 bg-card/60 p-3 text-sm text-muted-foreground">
        This mission has finished and left the room. Its report and material live in the chat above and on the drills shelf.
      </div>
    )
  }
  if (!task) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/60 p-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Preparing the mission…
      </div>
    )
  }

  const Icon = ICONS[task.skill] ?? Sparkles
  const badge = STATUS_BADGE[task.status]
  const doneCount = task.steps.filter((s) => s.status === 'done' || s.status === 'failed' || s.status === 'skipped').length
  const progress = task.steps.length ? Math.round((doneCount / task.steps.length) * 100) : 0

  return (
    <div className="overflow-hidden rounded-lg border border-primary/25 bg-card shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-border/60 bg-secondary/40 px-3 py-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-bold">{task.title}</span>
            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', badge.cls)}>
              {task.status === 'running' && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
              {badge.label}
            </span>
          </div>
          <div className="truncate text-[11px] text-muted-foreground">{task.goal}</div>
        </div>
        {task.status === 'running' && (
          <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 text-xs" onClick={() => void cancel()}>
            <XCircle className="h-3.5 w-3.5" /> Cancel
          </Button>
        )}
      </div>

      <div className="h-1 w-full bg-secondary">
        <div
          className={cn('h-1 transition-all duration-500', task.status === 'failed' ? 'bg-destructive' : 'bg-primary')}
          style={{ width: `${progress}%` }}
        />
      </div>

      <ol className="space-y-1 px-3 py-2.5">
        {task.steps.map((s, i) => (
          <li key={s.id} className="flex items-start gap-2 py-0.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
              {s.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              {s.status === 'done' && <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
              {s.status === 'failed' && <X className="h-4 w-4 text-destructive" />}
              {s.status === 'skipped' && <Minus className="h-4 w-4 text-muted-foreground/60" />}
              {s.status === 'queued' && <span className="h-2 w-2 rounded-full border border-muted-foreground/50" />}
            </span>
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  'text-[13px] font-medium leading-5',
                  s.status === 'queued' && 'text-muted-foreground',
                  s.status === 'failed' && 'text-destructive',
                )}
              >
                {i + 1}. {s.title}
              </div>
              {s.status === 'running' && s.log && (
                <div className="truncate text-[11px] italic text-primary/80">{s.log}</div>
              )}
              {s.detail && (s.status === 'done' || s.status === 'failed') && (
                <div className={cn('text-[11px] leading-4', s.status === 'failed' ? 'text-destructive/80' : 'text-muted-foreground')}>
                  {s.detail}
                </div>
              )}
              {s.status === 'skipped' && s.detail && <div className="text-[11px] text-muted-foreground/70">{s.detail}</div>}
            </div>
          </li>
        ))}
      </ol>

      {task.artifacts.length > 0 && (
        <div className="border-t border-border/60 px-3 py-2">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Verified material ({task.artifacts.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {task.artifacts.map((a) => (
              <button
                key={a.id}
                onClick={() => onOpenArtifact?.(a)}
                className="max-w-full truncate rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold transition hover:bg-accent"
                title={a.solved === true || a.kind === 'quiz' || a.kind === 'line' ? `Open "${a.title}"` : 'Open: the headline is revealed when it is solved'}
              >
                {a.kind === 'quiz' ? 'Quiz' : a.kind === 'line' ? 'Walkthrough' : a.kind === 'drill' ? 'Drill' : 'Puzzle'}: {displayTitle(a)}
              </button>
            ))}
          </div>
        </div>
      )}

      {task.report && task.status !== 'running' && (
        <div className="border-t border-border/60 px-3 py-2.5">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Mission report</div>
          <div className="scroll-slim max-h-96 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed">{task.report}</div>
        </div>
      )}
    </div>
  )
}
