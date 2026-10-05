'use client'

// Duolingo-style winding lesson path on the chess.com dark panel.
// One node per level, sinusoidal left/center/right offsets, scattered
// decorative chess glyphs, and a tier header row between every 20 levels.
// Pure presentation: progress states arrive as props, navigation via onSelect.

import { motion, useReducedMotion } from 'framer-motion'
import type { Level, Tier } from '@/content/schema'
import { cn } from '@/lib/utils'
import {
  Activity,
  ArrowDownUp,
  ArrowLeftRight,
  BookOpen,
  Brain,
  Castle,
  Check,
  ChevronsUp,
  Coins,
  Crosshair,
  Crown,
  Eye,
  EyeOff,
  Flag,
  Flame,
  Footprints,
  GitFork,
  GraduationCap,
  Hammer,
  Hourglass,
  Layers,
  Lock,
  MapPin,
  Network,
  Pin,
  Repeat,
  Rocket,
  Route,
  Scale,
  Shield,
  ShieldCheck,
  ShieldOff,
  Sprout,
  Swords,
  Timer,
  Trophy,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'

/* ---------- layout constants ---------- */

const ROW_H = 104
const NODE = 68
const MAX_OFFSET = 92

/* chess.com palette: green done, warm orange current, charcoal locked */
const GREEN = '#81b64c'
const GREEN_EDGE = '#5d8534'
const ORANGE = '#e8a33d'
const ORANGE_EDGE = '#b3761f'
const LOCKED_BG = '#3d3a36'
const LOCKED_EDGE = '#2a2825'

type NodeState = 'done' | 'current' | 'locked'

/* sinusoidal zigzag: offsets repeat 0, +, +, 0, -, - every six rows */
function nodeOffset(i: number): number {
  return Math.round(Math.sin((i * Math.PI) / 3) * MAX_OFFSET)
}

/* ---------- icons: real level concepts map to lucide icons ---------- */

const CONCEPT_ICON: Record<string, LucideIcon> = {
  mate: Crown,
  fork: GitFork,
  pin: Pin,
  skewer: ArrowDownUp,
  discoveredAttack: Eye,
  doubleAttack: Zap,
  removingDefender: ShieldOff,
  promotion: ChevronsUp,
  endgame: Flag,
  winningMaterial: Coins,
  sacrifice: Flame,
  defense: Shield,
  famousGame: BookOpen,
  development: Sprout,
  center: Crosshair,
  castlingSafety: Castle,
  kingSafety: ShieldCheck,
  pawnStructure: Layers,
  openFiles: Route,
  pieceActivity: Activity,
  kingActivity: Footprints,
  opposition: Scale,
  outposts: MapPin,
  zugzwang: Hourglass,
  calculation: Brain,
  prophylaxis: EyeOff,
  coordination: Network,
  pawnBreaks: Hammer,
  bishopPair: Repeat,
  initiative: Rocket,
  technique: Wrench,
  tempo: Timer,
  tradeDecisions: ArrowLeftRight,
}

/* consistent per-tier fallback when a level ships without concepts */
const TIER_FALLBACK_ICON: LucideIcon[] = [GraduationCap, Swords, Zap, Brain, Crown, Trophy]

/* module-level wrapper so the lint rule never sees a component being
   produced by a plain call inside another component's render */
function LevelIcon({
  tierN,
  level,
  className,
  strokeWidth,
}: {
  tierN: number
  level: Level
  className?: string
  strokeWidth?: number
}) {
  let Cmp: LucideIcon = TIER_FALLBACK_ICON[(tierN - 1) % TIER_FALLBACK_ICON.length]
  for (const c of level.concepts ?? []) {
    const found = CONCEPT_ICON[c]
    if (found) {
      Cmp = found
      break
    }
  }
  return <Cmp className={className} strokeWidth={strokeWidth} aria-hidden="true" />
}

/* ---------- decorative scattered pieces ---------- */

const TIER_GLYPH: Record<number, string> = {
  1: '\u265F',
  2: '\u265E',
  3: '\u265D',
  4: '\u265C',
  5: '\u265B',
  6: '\u265A',
}

function DecorPiece({ tierN, i, y }: { tierN: number; i: number; y: number }) {
  const ox = nodeOffset(i)
  const x = ox === 0 ? MAX_OFFSET + 4 : -Math.sign(ox) * (MAX_OFFSET + 4)
  const rot = ((i * 37) % 23) - 11
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute select-none text-[26px] leading-none text-white/40"
      style={{
        left: `calc(50% + ${x}px)`,
        top: y,
        transform: `translate(-50%, -50%) rotate(${rot}deg)`,
        textShadow: '0 3px 6px rgba(0, 0, 0, 0.5)',
        fontFamily: '"Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", serif',
      }}
    >
      {TIER_GLYPH[tierN] ?? '\u265F'}
    </span>
  )
}

/* ---------- single node ---------- */

function nodeAriaLabel(level: Level, tierTitle: string, state: NodeState): string {
  const base = `Level ${level.n} in ${tierTitle}: ${level.title}`
  if (state === 'done') return `${base}. Completed. Select to replay.`
  if (state === 'current') return `${base}. Current lesson.`
  return `${base}. Locked. Finish the earlier levels first.`
}

interface PathNodeProps {
  level: Level
  tierN: number
  tierTitle: string
  offset: number
  state: NodeState
  onSelect: (levelId: string) => void
}

function PathNode({ level, tierN, tierTitle, offset, state, onSelect }: PathNodeProps) {
  const reduce = useReducedMotion()
  const locked = state === 'locked'
  const done = state === 'done'
  const current = state === 'current'

  const tooltip = (
    <span className="relative block rounded-lg bg-white px-3 py-1.5 text-xs font-extrabold text-[#312e2b] shadow-lg">
      Next
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-full h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-white"
      />
    </span>
  )

  /* the zigzag offset lives on a plain wrapper: framer-motion owns the
     transform of the button itself (hover/tap scale) and would wipe it */
  return (
    <div className="flex items-center justify-center" style={{ height: ROW_H }}>
      <div style={{ transform: `translateX(${offset}px)` }}>
        <motion.button
          type="button"
          id={current ? 'current-lesson-node' : undefined}
          onClick={() => {
            if (!locked) onSelect(level.id)
          }}
          aria-label={nodeAriaLabel(level, tierTitle, state)}
          aria-disabled={locked || undefined}
          aria-current={current ? 'step' : undefined}
          whileHover={locked ? undefined : { scale: 1.06 }}
          whileTap={locked ? undefined : { scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 17 }}
          className={cn(
            'relative grid place-items-center rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-white/90',
            locked ? 'cursor-not-allowed' : 'cursor-pointer',
          )}
          style={{
            width: NODE,
            height: NODE,
            background: done ? GREEN : current ? ORANGE : LOCKED_BG,
            boxShadow: done
              ? `inset 0 -4px 0 rgba(0, 0, 0, 0.14), 0 5px 0 ${GREEN_EDGE}`
              : current
                ? `inset 0 -4px 0 rgba(0, 0, 0, 0.14), 0 5px 0 ${ORANGE_EDGE}`
                : `inset 0 -4px 0 rgba(0, 0, 0, 0.22), 0 5px 0 ${LOCKED_EDGE}`,
          }}
        >
          {/* expanding glow ring on the current node */}
          {current && (
            <motion.span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-2xl"
              animate={
                reduce
                  ? { boxShadow: '0 0 0 3px rgba(232, 163, 61, 0.45)' }
                  : { boxShadow: ['0 0 0 0px rgba(232, 163, 61, 0.55)', '0 0 0 16px rgba(232, 163, 61, 0)'] }
              }
              transition={reduce ? undefined : { duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
            />
          )}

          {done && <Check className="h-8 w-8 text-white" strokeWidth={3.2} />}
          {current && <LevelIcon tierN={tierN} level={level} className="h-7 w-7 text-white" strokeWidth={2.4} />}
          {locked && <Lock className="h-6 w-6 text-white/35" aria-hidden="true" />}

          {/* floating Next tooltip above the current node */}
          {current &&
            (reduce ? (
              <span className="absolute bottom-full left-1/2 z-10 mb-2.5 -translate-x-1/2">{tooltip}</span>
            ) : (
              <motion.span
                className="absolute bottom-full left-1/2 z-10 mb-2.5"
                style={{ x: '-50%' }}
                animate={{ y: [0, -4, 0] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              >
                {tooltip}
              </motion.span>
            ))}
        </motion.button>
      </div>
    </div>
  )
}

/* ---------- tier section: header row + winding column ---------- */

interface TierSectionProps {
  tier: Tier
  done: Set<string>
  nextId: string | null
  onSelect: (levelId: string) => void
  first?: boolean
}

function TierSection({ tier, done, nextId, onSelect, first = false }: TierSectionProps) {
  const tierDone = tier.levels.filter((l) => done.has(l.id)).length

  return (
    <section aria-labelledby={`tier-heading-${tier.id}`} className="animate-in fade-in slide-in-from-bottom-2 duration-500">
      <header
        id={`tier-anchor-${tier.id}`}
        className={cn('flex scroll-mt-4 items-center gap-2.5 px-1', first ? 'pb-3 pt-1' : 'pb-3 pt-7')}
      >
        <span aria-hidden="true" className="h-px flex-1 bg-sidebar-border" />
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md font-display text-xs font-extrabold text-white shadow-sm"
          style={{ background: tier.color }}
        >
          {tier.n}
        </span>
        <h3 id={`tier-heading-${tier.id}`} className="font-display text-sm font-extrabold uppercase tracking-wider text-white">
          {tier.title}
        </h3>
        <span className="shrink-0 text-xs font-bold tabular-nums text-sidebar-foreground/50">
          {tierDone}/{tier.levels.length}
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-sidebar-border" />
      </header>

      <div className="relative mx-auto w-[340px] max-w-full">
        {tier.levels.map((level, i) => {
          const state: NodeState = done.has(level.id) ? 'done' : level.id === nextId ? 'current' : 'locked'
          return (
            <div key={level.id}>
              {i % 3 === 1 && i < tier.levels.length - 1 && (
                <DecorPiece tierN={tier.n} i={i} y={(i + 0.5) * ROW_H} />
              )}
              <PathNode
                level={level}
                tierN={tier.n}
                tierTitle={tier.title}
                offset={nodeOffset(i)}
                state={state}
                onSelect={onSelect}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* ---------- public component ---------- */

export function LessonMap({
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
    <nav aria-label="Lesson path" className="pb-6">
      {tiers.map((tier, ti) => (
        <TierSection key={tier.id} tier={tier} done={done} nextId={nextId} onSelect={onSelect} first={ti === 0} />
      ))}
    </nav>
  )
}
