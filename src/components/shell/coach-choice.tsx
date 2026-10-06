'use client'
import { readJson } from '@/lib/api-client'

// Coach selection: nothing in ChessX picks a coach for you. Every surface that
// needs a coach renders a chooser until the player has picked one.

import { useState } from 'react'
import { COACHES, type Coach } from '@/lib/coaches'
import { CharacterFace } from '@/components/chess/characters'
import { useApp } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Check, Loader2 } from 'lucide-react'

const TIER_NAMES: Record<number, string> = {
  1: 'Newbie',
  2: 'Beginner',
  3: 'Intermediate',
  4: 'Advanced',
  5: 'Master',
  6: 'Grandmaster',
}

function tierRange(c: Coach): string {
  const [a, b] = c.tiers
  return a === b ? TIER_NAMES[a] : `${TIER_NAMES[a]} to ${TIER_NAMES[b]}`
}

/** Saves the picked coach to the profile and updates client state. */
export function usePickCoach() {
  const { setProfile } = useApp()
  const [busyId, setBusyId] = useState<string | null>(null)
  async function pick(id: string): Promise<Coach | null> {
    setBusyId(id)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coach: id }),
      })
      const data = await readJson<{ profile?: { id: string } }>(res)
      if (data.profile) setProfile(data.profile)
      return COACHES.find((c) => c.id === id) ?? null
    } finally {
      setBusyId(null)
    }
  }
  return { pick, busyId }
}

/** Presentational card grid. Used by the picker, onboarding and inline prompts. */
export function CoachCards({
  value,
  onChange,
  columns = 2,
  compact = false,
}: {
  value: string | null
  onChange: (id: string) => void
  columns?: 1 | 2
  compact?: boolean
}) {
  return (
    <div role="radiogroup" aria-label="Choose your coach" className={cn('grid gap-2.5', columns === 2 && 'sm:grid-cols-2')}>
      {COACHES.map((c) => {
        const active = value === c.id
        return (
          <button
            key={c.id}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(c.id)}
            className={cn(
              'pressable group flex items-start gap-3 rounded-xl border-2 p-3.5 text-left transition-colors',
              active
                ? 'border-primary bg-primary/10 shadow-sm'
                : 'border-transparent bg-secondary/70 hover:border-primary/30 hover:bg-secondary',
              compact && 'items-center p-2.5',
            )}
          >
            <CharacterFace
              id={c.id}
              label={c.name}
              className={cn(
                'shrink-0 rounded-full border-2 shadow-sm transition-transform duration-200 group-hover:scale-105',
                compact ? 'h-10 w-10' : 'h-14 w-14',
                active ? 'border-primary' : 'border-transparent',
              )}
            />
            {compact ? (
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-display text-sm font-extrabold">{c.name}</span>
                  <span className="truncate text-[10px] font-semibold uppercase tracking-wide" style={{ color: c.color }}>
                    {c.title}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{c.blurb}</p>
              </div>
            ) : (
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-display text-base font-extrabold">{c.name}</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: c.color }}>
                    {c.title}
                  </span>
                  {active && (
                    <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{c.blurb}</p>
                <p className="mt-1 text-xs font-semibold text-muted-foreground/80">Focus: {tierRange(c)}</p>
              </div>
            )}
            {compact && active && (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="h-3.5 w-3.5" />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Full picker with the save built in. Renders wherever a coach is required but missing. */
export function CoachChoice({
  title = 'Choose your coach',
  subtitle = 'They guide your lessons, your games and your reviews. You can switch any time in Settings.',
  onPicked,
  layout = 'page',
}: {
  title?: string
  subtitle?: string
  onPicked?: (c: Coach) => void
  layout?: 'page' | 'panel'
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const { pick, busyId } = usePickCoach()
  const busy = busyId != null

  async function confirm() {
    if (!picked || busy) return
    const c = await pick(picked)
    if (c) onPicked?.(c)
  }

  const body = (
    <>
      <h2 className={cn('font-display font-extrabold', layout === 'page' ? 'text-2xl' : 'text-lg')}>{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      <div className="mt-4">
        <CoachCards value={picked} onChange={setPicked} columns={layout === 'page' ? 2 : 1} />
      </div>
      <Button className="btn-hero mt-4 w-full py-2.5" onClick={confirm} disabled={!picked || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {busy ? 'Setting up…' : picked ? `Train with ${COACHES.find((c) => c.id === picked)?.name}` : 'Pick a coach to continue'}
      </Button>
    </>
  )

  if (layout === 'panel') {
    return <div className="p-1">{body}</div>
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <div className="rounded-2xl border bg-card p-6 shadow-sm">{body}</div>
    </div>
  )
}
