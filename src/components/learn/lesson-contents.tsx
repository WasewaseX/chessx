'use client'

// The Study: course contents. A workbook table of contents instead of a
// game-map path. Each tier is a chapter with an ink-stamped numeral and a
// tagline; each level is a ledger row on a threaded spine, the way a printed
// chess book lists its exercises. The current lesson carries an amber margin
// marker. Pure presentation: progress states arrive as props, navigation via
// onSelect.

import { motion, useReducedMotion } from 'framer-motion'
import type { Level, Tier } from '@/content/schema'
import { isLevelUnlocked, unlockRequirement } from '@/lib/unlock'
import { cn } from '@/lib/utils'
import { Check, Lock, Play } from 'lucide-react'

type RowState = 'done' | 'current' | 'open' | 'locked'

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']

function rowState(level: Level, done: Set<string>, nextId: string | null, role?: string | null): RowState {
  if (done.has(level.id)) return 'done'
  // The recommended level gets the amber marker even when it is a chapter
  // opener, so the eye always lands on one row first.
  if (level.id === nextId) return 'current'
  // Unlock chains inside a chapter (previous level done opens the next), and
  // the opening level of every chapter stays unlocked: someone who already
  // plays chess can start at Beginner without replaying Newbie.
  if (isLevelUnlocked(level.id, done, role)) return 'open'
  return 'locked'
}

/* ---------- one level row ---------- */

function rowAria(level: Level, tierTitle: string, state: RowState): string {
  const base = `Level ${level.n} in ${tierTitle}: ${level.title}`
  if (state === 'done') return `${base}. Completed. Select to replay.`
  if (state === 'current') return `${base}. Current lesson.`
  if (state === 'open') return `${base}. Open. Start it any time.`
  const req = unlockRequirement(level.id)
  return `${base}. Locked. ${req ? req + ' first.' : 'Finish the earlier levels first.'}`
}

function LevelRow({
  level,
  tierTitle,
  state,
  oneWinAway,
  onSelect,
}: {
  level: Level
  tierTitle: string
  state: RowState
  oneWinAway: boolean
  onSelect: (levelId: string) => void
}) {
  const reduce = useReducedMotion()
  const locked = state === 'locked'
  const current = state === 'current'
  const open = state === 'open'

  const mark = (
    <span
      aria-hidden="true"
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors',
        state === 'done' && 'border-[#81b64c] bg-[#81b64c] text-white',
        current && 'border-[#c07f1d] bg-paper-card text-[#c07f1d] dark:text-[#f2b95c]',
        state === 'open' && 'border-[#81b64c]/60 bg-[#81b64c]/10 text-paper-green-ink',
        locked && 'border-paper-line bg-paper-card text-paper-faint',
      )}
    >
      {state === 'done' && <Check className="h-3.5 w-3.5" strokeWidth={3.2} />}
      {current && <Play className="h-3 w-3 fill-current" />}
      {state === 'open' && <Play className="h-3 w-3 fill-current" />}
      {locked && <Lock className="h-2.5 w-2.5" strokeWidth={2.5} />}
    </span>
  )

  const inner = (
    <>
      {mark}
      <span className="w-6 shrink-0 text-right font-display text-xs font-extrabold tabular-nums text-paper-faint">
        {level.n}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              'truncate font-display text-[15px] font-bold',
              locked ? 'text-paper-muted' : 'text-paper-ink',
            )}
          >
            {level.title}
          </span>
          {/* dotted leader, the workbook signature */}
          <span
            aria-hidden="true"
            className="mb-1 hidden h-px flex-1 border-b border-dotted border-paper-faint sm:block"
          />
          <span className="hidden shrink-0 text-[11px] font-bold tabular-nums text-paper-faint sm:inline">
            {level.minutes} min
          </span>
        </span>
        <span className="block truncate text-xs leading-snug text-paper-faint">
          {level.subtitle}
        </span>
        {open && (
          <span className="mt-0.5 block text-[10px] font-extrabold uppercase tracking-widest text-paper-green-ink">
            Open, start here
          </span>
        )}
        {locked && (
          <span className="mt-0.5 block text-[11px] font-bold leading-snug text-paper-muted">
            <span className="sr-only">Locked. </span>
            {oneWinAway ? 'One win away' : `Unlocks after ${unlockRequirement(level.id)?.replace(/^Finish /, '')}`}
          </span>
        )}
      </span>
    </>
  )

  const rowCls = cn(
    'flex min-h-[56px] w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors sm:px-3',
    current && 'bg-[#c07f1d]/10 ring-1 ring-[#c07f1d]/35',
    open && 'ring-1 ring-[#81b64c]/30',
  )

  if (locked) {
    return (
      <li className="relative pl-5 sm:pl-7">
        <div className={rowCls}>
          {inner}
        </div>
      </li>
    )
  }

  return (
    <li className="relative pl-5 sm:pl-7">
      {current && !reduce && (
        <motion.span
          aria-hidden="true"
          className="absolute -left-0.5 top-1/2 h-8 w-1.5 -translate-y-1/2 rounded-full bg-[#c07f1d]"
          animate={{ opacity: [1, 0.55, 1] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      {current && reduce && (
        <span aria-hidden="true" className="absolute -left-0.5 top-1/2 h-8 w-1.5 -translate-y-1/2 rounded-full bg-[#c07f1d]" />
      )}
      <button
        type="button"
        id={current ? 'current-lesson-node' : undefined}
        onClick={() => onSelect(level.id)}
        aria-label={rowAria(level, tierTitle, state)}
        aria-current={current ? 'step' : undefined}
        className={cn(rowCls, 'hover:bg-paper-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-faint')}
      >
        {inner}
      </button>
    </li>
  )
}

/* ---------- one chapter ---------- */

function Chapter({
  tier,
  done,
  nextId,
  onSelect,
  first,
  role,
}: {
  tier: Tier
  done: Set<string>
  nextId: string | null
  onSelect: (levelId: string) => void
  first: boolean
  role?: string | null
}) {
  const d = tier.levels.filter((l) => done.has(l.id)).length

  return (
    <section aria-labelledby={`tier-heading-${tier.id}`} className="scroll-mt-6">
      <header id={`tier-anchor-${tier.id}`} className={cn('scroll-mt-24', first ? 'pb-3' : 'pb-3')}>
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md font-display text-sm font-extrabold text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.25)]"
            style={{ background: tier.color }}
          >
            {ROMAN[tier.n - 1] ?? tier.n}
          </span>
          <div className="min-w-0 flex-1">
            <h3 id={`tier-heading-${tier.id}`} className="font-book text-lg font-semibold leading-tight text-paper-ink">
              {tier.title}
            </h3>
            <p className="truncate text-xs text-paper-muted">{tier.tagline}</p>
          </div>
          <span className="shrink-0 rounded-md bg-paper-hover px-2 py-1 text-[11px] font-extrabold tabular-nums text-paper-muted">
            {d}/{tier.levels.length}
          </span>
        </div>
        <div aria-hidden="true" className="mt-3 h-px w-full bg-paper-line" />
      </header>

      {/* the spine threads every row's status mark, like stitches in a binding */}
      <ol className="relative space-y-1">
        <span
          aria-hidden="true"
          className="absolute bottom-3 left-[41px] top-3 w-px bg-paper-line sm:left-[51px]"
        />
        {tier.levels.map((level) => (
          <LevelRow
            key={level.id}
            level={level}
            tierTitle={tier.title}
            state={rowState(level, done, nextId, role)}
            oneWinAway={level.n > 1 && nextId === tier.levels[level.n - 2].id}
            onSelect={onSelect}
          />
        ))}
      </ol>
    </section>
  )
}

/* ---------- public component ---------- */

export function LessonContents({
  tiers,
  done,
  nextId,
  onSelect,
  role,
}: {
  tiers: Tier[]
  done: Set<string>
  nextId: string | null
  onSelect: (levelId: string) => void
  /** Signed-in role: 'admin' opens every row. */
  role?: string | null
}) {
  return (
    <nav aria-label="Course contents" className="space-y-8">
      {tiers.map((tier, ti) => (
        <Chapter
          key={tier.id}
          tier={tier}
          done={done}
          nextId={nextId}
          onSelect={onSelect}
          first={ti === 0}
          role={role}
        />
      ))}
    </nav>
  )
}
