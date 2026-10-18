'use client'
// What's new — the published changelog feed plus the public feature-suggestion
// board ("Roadmap & ideas"). Everything shown comes from the server: reaction
// counts and votes are real writes with optimistic updates and rollback, the
// suggestion cap and validation errors are surfaced honestly, and signed-out
// visitors get the whole board read-only with a sign-in hint.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { ChevronUp, Lightbulb, Loader2, Pin, RefreshCw, Sparkles } from 'lucide-react'
import { useApp } from '@/lib/store'
import { readJson } from '@/lib/api-client'
import { cn } from '@/lib/utils'

type Tag = 'update' | 'feature' | 'fix' | 'benchmark'
type ReactionEmoji = '🎉' | '❤️' | '🧠' | '🐸'

const REACTION_EMOJIS: ReactionEmoji[] = ['🎉', '❤️', '🧠', '🐸']

interface ChangelogEntry {
  id: string
  title: string
  body: string
  tag: string
  version: string | null
  pinned: boolean
  createdAt: string
  reactions: Record<ReactionEmoji, number>
  mine: ReactionEmoji[]
}

interface Suggestion {
  id: string
  title: string
  detail: string
  status: string
  votes: number
  authorName: string
  createdAt: string
  viewerVoted: boolean
}

type StatusTab = 'open' | 'planned' | 'in_progress' | 'shipped'

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'shipped', label: 'Shipped' },
]

// tag + status color accents — Tailwind palette only, no blue/indigo
const TAG_STYLES: Record<string, string> = {
  feature: 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300',
  update: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  fix: 'border-border bg-secondary text-secondary-foreground',
  benchmark: 'border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-300',
}

const TAG_LABELS: Record<string, string> = {
  feature: 'Feature',
  update: 'Update',
  fix: 'Fix',
  benchmark: 'Benchmark',
}

const STATUS_STYLES: Record<string, string> = {
  open: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  planned: 'border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-300',
  in_progress: 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300',
  shipped: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  planned: 'Planned',
  in_progress: 'In progress',
  shipped: 'Shipped',
}

const TITLE_MIN = 8
const TITLE_MAX = 90
const DETAIL_MIN = 10
const DETAIL_MAX = 500

/** Relative date, computed in the browser ("2 days ago"). */
function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function WhatsNewView() {
  const { user } = useApp()
  const { toast } = useToast()

  // changelog state
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null)
  const [entriesError, setEntriesError] = useState<string | null>(null)

  // suggestion board state
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null)
  const [statusTab, setStatusTab] = useState<StatusTab>('open')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadEntries = useCallback(async () => {
    setEntriesError(null)
    try {
      const res = await fetch('/api/changelog', { cache: 'no-store' })
      const d = await readJson<{ entries?: ChangelogEntry[]; error?: string }>(res)
      if (!res.ok) {
        setEntriesError(d?.error ?? 'The changelog could not be loaded.')
        return
      }
      setEntries(d.entries ?? [])
    } catch {
      setEntriesError('The changelog could not be loaded.')
    }
  }, [])

  const loadSuggestions = useCallback(async () => {
    setSuggestionsError(null)
    try {
      const res = await fetch('/api/changelog/suggestions', { cache: 'no-store' })
      const d = await readJson<{ suggestions?: Suggestion[]; error?: string }>(res)
      if (!res.ok) {
        setSuggestionsError(d?.error ?? 'The idea board could not be loaded.')
        return
      }
      setSuggestions(d.suggestions ?? [])
    } catch {
      setSuggestionsError('The idea board could not be loaded.')
    }
  }, [])

  useEffect(() => {
    void loadEntries()
    void loadSuggestions()
  }, [loadEntries, loadSuggestions])

  // ---- reactions -----------------------------------------------------------

  const toggleReaction = useCallback(
    async (entryId: string, emoji: ReactionEmoji) => {
      if (!user) return // read-only when signed out
      const before = entries
      // optimistic: flip the viewer's emoji and move the counts with it
      setEntries((list) =>
        (list ?? []).map((e) => {
          if (e.id !== entryId) return e
          const had = e.mine.includes(emoji)
          const mine = had ? e.mine.filter((m) => m !== emoji) : [...e.mine, emoji]
          const reactions = { ...e.reactions }
          // one reaction per viewer per entry: a switch moves the old count back
          for (const m of e.mine) if (m !== emoji) reactions[m] = Math.max(0, reactions[m] - 1)
          reactions[emoji] = Math.max(0, reactions[emoji] + (had ? -1 : 1))
          return { ...e, mine, reactions }
        }),
      )
      setBusyId(entryId)
      try {
        const res = await fetch('/api/changelog/react', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entryId, emoji }),
        })
        const d = await readJson<{ reactions?: Record<ReactionEmoji, number>; mine?: ReactionEmoji[]; error?: string }>(res)
        if (!res.ok || !d.reactions) {
          setEntries(before)
          toast({ title: d?.error ?? 'That reaction could not be saved.', variant: 'destructive' })
          return
        }
        setEntries((list) =>
          (list ?? []).map((e) =>
            e.id === entryId ? { ...e, reactions: d.reactions!, mine: d.mine ?? [] } : e,
          ),
        )
      } catch {
        setEntries(before)
        toast({ title: 'That reaction could not be saved.', variant: 'destructive' })
      } finally {
        setBusyId(null)
      }
    },
    [entries, toast, user],
  )

  // ---- votes ---------------------------------------------------------------

  const toggleVote = useCallback(
    async (suggestionId: string) => {
      if (!user) return
      const before = suggestions
      setSuggestions((list) =>
        (list ?? []).map((s) =>
          s.id === suggestionId
            ? {
                ...s,
                votes: Math.max(0, s.votes + (s.viewerVoted ? -1 : 1)),
                viewerVoted: !s.viewerVoted,
              }
            : s,
        ),
      )
      setBusyId(suggestionId)
      try {
        const res = await fetch('/api/changelog/vote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ suggestionId }),
        })
        const d = await readJson<{ votes?: number; viewerVoted?: boolean; error?: string }>(res)
        if (!res.ok || typeof d.votes !== 'number') {
          setSuggestions(before)
          toast({ title: d?.error ?? 'That vote could not be saved.', variant: 'destructive' })
          return
        }
        setSuggestions((list) =>
          (list ?? []).map((s) =>
            s.id === suggestionId ? { ...s, votes: d.votes!, viewerVoted: Boolean(d.viewerVoted) } : s,
          ),
        )
      } catch {
        setSuggestions(before)
        toast({ title: 'That vote could not be saved.', variant: 'destructive' })
      } finally {
        setBusyId(null)
      }
    },
    [suggestions, toast, user],
  )

  const shown = useMemo(
    () => (suggestions ?? []).filter((s) => s.status === statusTab),
    [suggestions, statusTab],
  )
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const s of suggestions ?? []) counts[s.status] = (counts[s.status] ?? 0) + 1
    return counts
  }, [suggestions])

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl font-extrabold leading-tight">What&apos;s new</h1>
          <p className="text-sm text-muted-foreground">
            Ship notes from the workshop, and the board where ideas become the roadmap.
          </p>
        </div>
      </div>

      {/* ---------------- changelog feed ---------------- */}
      <section aria-label="Changelog" className="mb-8">
        {entriesError ? (
          <ErrorNote message={entriesError} onRetry={() => void loadEntries()} />
        ) : entries === null ? (
          <div className="space-y-3" aria-label="Loading changelog">
            <FeedSkeleton />
          </div>
        ) : entries.length === 0 ? (
          <EmptyNote>Nothing here yet. The first ship notes will land on this page.</EmptyNote>
        ) : (
          <ul className="scroll-slim max-h-96 space-y-3 overflow-y-auto pr-1">
            {entries.map((e) => (
              <li key={e.id}>
                <article className="rounded-xl border border-border/60 bg-card p-4 shadow-sm sm:p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={cn('font-semibold', TAG_STYLES[e.tag] ?? TAG_STYLES.update)}>
                      {TAG_LABELS[e.tag] ?? 'Update'}
                    </Badge>
                    {e.version ? (
                      <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[11px] font-semibold text-secondary-foreground">
                        v{e.version.replace(/^v/, '')}
                      </span>
                    ) : null}
                    {e.pinned ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        <Pin className="h-3 w-3" aria-hidden /> Pinned
                      </span>
                    ) : null}
                    <time dateTime={e.createdAt} className="ml-auto text-xs text-muted-foreground">
                      {timeAgo(e.createdAt)}
                    </time>
                  </div>
                  <h2 className="mt-2 font-display text-base font-bold leading-snug">{e.title}</h2>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{e.body}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Reactions">
                    {REACTION_EMOJIS.map((emoji) => {
                      const active = e.mine.includes(emoji)
                      return (
                        <button
                          key={emoji}
                          type="button"
                          disabled={!user || busyId === e.id}
                          onClick={() => void toggleReaction(e.id, emoji)}
                          aria-pressed={active}
                          aria-label={`React ${emoji}`}
                          title={user ? (active ? 'Remove your reaction' : 'React') : 'Sign in to react'}
                          className={cn(
                            'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-all duration-150 active:scale-95',
                            active
                              ? 'border-primary/60 bg-primary/10 text-primary'
                              : 'border-border/70 bg-secondary/40 text-secondary-foreground hover:bg-secondary',
                            !user && 'cursor-not-allowed opacity-60',
                          )}
                        >
                          <span aria-hidden>{emoji}</span>
                          <span className="tabular-nums">{e.reactions[emoji] ?? 0}</span>
                        </button>
                      )
                    })}
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------- roadmap & ideas ---------------- */}
      <section aria-label="Roadmap and ideas">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-extrabold">Roadmap &amp; ideas</h2>
          {user ? (
            <SuggestDialog
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              onCreated={(s) => {
                setSuggestions((list) => [s, ...(list ?? [])])
                setStatusTab('open')
                void loadSuggestions()
              }}
            />
          ) : (
            <p className="text-xs font-semibold text-muted-foreground">Sign in to vote and suggest features.</p>
          )}
        </div>

        <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as StatusTab)} className="mb-3">
          <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
            {STATUS_TABS.map(({ value, label }) => (
              <TabsTrigger key={value} value={value} className="min-h-9 px-3">
                {label}
                {statusCounts[value] ? (
                  <span className="ml-1.5 rounded-full bg-secondary px-1.5 text-[10px] font-bold tabular-nums text-secondary-foreground">
                    {statusCounts[value]}
                  </span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {suggestionsError ? (
          <ErrorNote message={suggestionsError} onRetry={() => void loadSuggestions()} />
        ) : suggestions === null ? (
          <div className="space-y-3" aria-label="Loading ideas">
            <FeedSkeleton />
          </div>
        ) : shown.length === 0 ? (
          <EmptyNote>
            Nothing here yet.
            {user ? ' Suggest the first idea and it starts with your vote.' : ''}
          </EmptyNote>
        ) : (
          <ul className="scroll-slim max-h-96 space-y-3 overflow-y-auto pr-1">
            {shown.map((s) => (
              <li key={s.id}>
                <article className="flex gap-3 rounded-xl border border-border/60 bg-card p-4 shadow-sm sm:p-5">
                  <button
                    type="button"
                    disabled={!user || busyId === s.id}
                    onClick={() => void toggleVote(s.id)}
                    aria-pressed={s.viewerVoted}
                    aria-label={s.viewerVoted ? 'Remove your vote' : 'Upvote this suggestion'}
                    title={user ? (s.viewerVoted ? 'Remove your vote' : 'Add your vote') : 'Sign in to vote'}
                    className={cn(
                      'flex h-12 w-11 shrink-0 flex-col items-center justify-center rounded-lg border text-sm font-bold transition-all duration-150 active:scale-95',
                      s.viewerVoted
                        ? 'border-primary bg-primary text-primary-foreground shadow-[inset_0_-2px_0_rgba(0,0,0,0.15)]'
                        : 'border-border/70 bg-secondary/40 text-secondary-foreground hover:bg-secondary',
                      !user && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <ChevronUp className="h-4 w-4" aria-hidden />
                    <span className="tabular-nums">{s.votes}</span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="min-w-0 flex-1 font-display text-sm font-bold leading-snug">{s.title}</h3>
                      <Badge variant="outline" className={cn('font-semibold', STATUS_STYLES[s.status] ?? '')}>
                        {STATUS_LABELS[s.status] ?? s.status}
                      </Badge>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{s.detail}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {s.authorName} · {timeAgo(s.createdAt)}
                    </p>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// ---------------- suggest-a-feature dialog ---------------------------------

function SuggestDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (s: Suggestion) => void
}) {
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const titleOk = title.trim().length >= TITLE_MIN && title.trim().length <= TITLE_MAX
  const detailOk = detail.trim().length >= DETAIL_MIN && detail.trim().length <= DETAIL_MAX

  const submit = useCallback(async () => {
    // honest client-side checks first; the server repeats them
    if (!titleOk) {
      setError(`Title must be ${TITLE_MIN}-${TITLE_MAX} characters.`)
      return
    }
    if (!detailOk) {
      setError(`Details must be ${DETAIL_MIN}-${DETAIL_MAX} characters.`)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/changelog/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), detail: detail.trim() }),
      })
      const d = await readJson<{ suggestion?: Suggestion; error?: string }>(res)
      if (!res.ok || !d.suggestion) {
        setError(d?.error ?? 'The suggestion could not be saved.')
        return
      }
      onCreated(d.suggestion)
      onOpenChange(false)
      setTitle('')
      setDetail('')
    } catch {
      setError('The suggestion could not be saved. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }, [detail, detailOk, onCreated, onOpenChange, title, titleOk])

  return (
    <>
      <Button type="button" onClick={() => onOpenChange(true)} className="min-h-9">
        <Lightbulb className="h-4 w-4" aria-hidden /> Suggest a feature
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setError(null)
          onOpenChange(next)
        }}
      >
        <DialogContent className="scroll-slim max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Suggest a feature</DialogTitle>
          <DialogDescription>
            Tell us what to build. Your idea lands on the open board and starts with your vote.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="suggestion-title">Title</Label>
            <Input
              id="suggestion-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="A short, specific summary"
              maxLength={TITLE_MAX + 20}
              aria-describedby="suggestion-title-hint"
            />
            <p id="suggestion-title-hint" className="text-xs text-muted-foreground">
              {TITLE_MIN}-{TITLE_MAX} characters · {title.trim().length}/{TITLE_MAX}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="suggestion-detail">Details</Label>
            <Textarea
              id="suggestion-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="What should happen, and what problem does it solve for your training?"
              rows={5}
              maxLength={DETAIL_MAX + 20}
              aria-describedby="suggestion-detail-hint"
            />
            <p id="suggestion-detail-hint" className="text-xs text-muted-foreground">
              {DETAIL_MIN}-{DETAIL_MAX} characters · {detail.trim().length}/{DETAIL_MAX}
            </p>
          </div>
          {error ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !titleOk || !detailOk}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Post suggestion
            </Button>
          </DialogFooter>
        </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------- shared small pieces --------------------------------------

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function ErrorNote({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3">
      <p className="text-sm font-semibold text-destructive">{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry} className="min-h-9">
        <RefreshCw className="h-4 w-4" aria-hidden /> Retry
      </Button>
    </div>
  )
}

function FeedSkeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-border/60 bg-card p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
          <Skeleton className="mt-3 h-5 w-2/3" />
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="mt-1.5 h-4 w-4/5" />
          <div className="mt-3 flex gap-1.5">
            <Skeleton className="h-9 w-16 rounded-full" />
            <Skeleton className="h-9 w-16 rounded-full" />
            <Skeleton className="h-9 w-16 rounded-full" />
          </div>
        </div>
      ))}
    </>
  )
}
