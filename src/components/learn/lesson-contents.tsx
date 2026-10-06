'use client'

// The Study: course contents. A workbook table of contents instead of a
// game-map path. Each tier is a chapter with an ink-stamped numeral and a
// tagline; each level is a ledger row on a threaded spine, the way a printed
// chess book lists its exercises. The current lesson carries an amber margin
// marker. Pure presentation: progress states arrive as props, navigation via
// onSelect.

import { motion, useReducedMotion } from 'framer-motion'
import type { Level, Tier } from '@/content/schema'
import { cn } from '@/lib/utils'
import { Check, Play } from 'lucide-react'

type RowState = 'done' | 'current' | 'locked'

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']

function rowState(level: Level, done: Set<string>, nextId: string | null): RowState {
  if (done.has(level.id)) return 'done'
  if (level.id === nextId) return 'current'
  return 'locked'
}

/* ---------- one level row ---------- */

function rowAria(level: Level, tierTitle: string, state: RowState): string {
  const base = `Level ${level.n} in ${tierTitle}: ${level.title}`
  if (state === 'done') return `${base}. Completed. Select to replay.`
  if (state === 'current') return `${base}. Current lesson.`
  return `${base}. Locked. Finish the earlier levels first.`
}

function LevelRow({
  level,
  tierTitle,
  state,
  onSelect,
}: {
  level: Level
  tierTitle: string
  state: RowState
  onSelect: (levelId: string) => void
}) {
  const reduce = useReducedMotion()
  const locked = state === 'locked'
  const current = state === 'current'

  const mark = (
    <span
      aria-hidden="true"
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors',
        state === 'done' && 'border-[#81b64c] bg-[#81b64c] text-white',
        current && 'border-[#c07f1d] bg-[#f4f1e8] text-[#c07f1d]',
        locked && 'border-[#262421]/15 bg-transparent text-transparent',
      )}
    >
      {state === 'done' && <Check className="h-3.5 w-3.5" strokeWidth={3.2} />}
      {current && <Play className="h-3 w-3 fill-current" />}
    </span>
  )

  const inner = (
    <>
      {mark}
      <span className="w-6 shrink-0 text-right font-display text-xs font-extrabold tabular-nums text-[#262421]/40">
        {level.n}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              'truncate font-display text-[15px] font-bold',
              locked ? 'text-[#262421]/45' : 'text-[#262421]',
            )}
          >
            {level.title}
          </span>
          {/* dotted leader, the workbook signature */}
          <span
            aria-hidden="true"
            className="mb-1 hidden h-px flex-1 border-b border-dotted border-[#262421]/25 sm:block"
          />
          <span className="hidden shrink-0 text-[11px] font-bold tabular-nums text-[#262421]/40 sm:inline">
            {level.minutes} min
          </span>
        </span>
        <span className={cn('block truncate text-xs leading-snug', locked ? 'text-[#262421]/30' : 'text-[#262421]/50')}>
          {level.subtitle}
        </span>
      </span>
    </>
  )

  const rowCls = cn(
    'flex min-h-[56px] w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors sm:px-3',
    current && 'bg-[#c07f1d]/10 ring-1 ring-[#c07f1d]/35',
  )

  if (locked) {
    return (
      <li className="relative pl-5 sm:pl-7">
        <div
          aria-disabled="true"
          aria-label={rowAria(level, tierTitle, state)}
          className={cn(rowCls, 'opacity-80')}
        >
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
        className={cn(rowCls, 'hover:bg-[#262421]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#262421]/40')}
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
}: {
  tier: Tier
  done: Set<string>
  nextId: string | null
  onSelect: (levelId: string) => void
  first: boolean
}) {
  const d = tier.levels.filter((l) => done.has(l.id)).length

  return (
    <section aria-labelledby={`tier-heading-${tier.id}`} className="scroll-mt-6">
      <header id={`tier-anchor-${tier.id}`} className={cn('scroll-mt-24', first ? 'pb-3' : 'pb-3')}>
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md font-display text-sm font-extrabold text-[#262421] shadow-[inset_0_-2px_0_rgba(0,0,0,0.15)]"
            style={{ background: tier.color }}
          >
            {ROMAN[tier.n - 1] ?? tier.n}
          </span>
          <div className="min-w-0 flex-1">
            <h3 id={`tier-heading-${tier.id}`} className="font-book text-lg font-semibold leading-tight text-[#262421]">
              {tier.title}
            </h3>
            <p className="truncate text-xs text-[#262421]/50">{tier.tagline}</p>
          </div>
          <span className="shrink-0 rounded-md bg-[#262421]/8 px-2 py-1 text-[11px] font-extrabold tabular-nums text-[#262421]/60">
            {d}/{tier.levels.length}
          </span>
        </div>
        <div aria-hidden="true" className="mt-3 h-px w-full bg-[#262421]/12" />
      </header>

      {/* the spine threads every row's status mark, like stitches in a binding */}
      <ol className="relative space-y-1">
        <span
          aria-hidden="true"
          className="absolute bottom-3 left-[11px] top-3 w-px bg-[#262421]/12 sm:left-[15px]"
        />
        {tier.levels.map((level) => (
          <LevelRow
            key={level.id}
            level={level}
            tierTitle={tier.title}
            state={rowState(level, done, nextId)}
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
}: {
  tiers: Tier[]
  done: Set<string>
  nextId: string | null
  onSelect: (levelId: string) => void
}) {
  return (
    <nav aria-label="Course contents" className="space-y-8">
      {tiers.map((tier, ti) => (
        <Chapter key={tier.id} tier={tier} done={done} nextId={nextId} onSelect={onSelect} first={ti === 0} />
      ))}
    </nav>
  )
}
