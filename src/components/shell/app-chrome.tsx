'use client'

/**
 * Chess.com-style chrome: a dark left rail whose top-level tabs (Play, Learn,
 * Puzzles, Tools, More) each open a sub-tab list inside the rail — the same
 * two-level pattern chess.com uses. Sub-rows deep-link into the exact section
 * of a view (#/puzzles/rush, #/play/online, ...) which the views already parse.
 * The mobile bottom bar mirrors the same groups.
 */

import { useEffect, useState } from 'react'
import { useApp, overallRating, type ViewName } from '@/lib/store'
import { clearSessionToken } from '@/lib/session'
import { cn } from '@/lib/utils'
import {
  Home,
  Swords,
  Puzzle,
  Wrench,
  Ellipsis,
  Globe,
  Bot,
  BookOpen,
  MessagesSquare,
  History,
  LineChart,
  CalendarClock,
  Zap,
  Eye,
  Bird,
  MessageSquareText,
  Upload,
  Sparkles,
  UserRound,
  Settings,
  ChevronRight,
  ArrowLeft,
  LogOut,
  LayoutGrid,
} from 'lucide-react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { ThemeToggle } from '@/components/shell/theme-toggle'

type NavIcon = React.ComponentType<{ className?: string }>

export interface NavChild {
  /** ViewName to navigate to. */
  name: ViewName
  /** Optional deep-link segment placed in the hash (#/view/segment). */
  segment?: string
  label: string
  icon: NavIcon
  /** Draws the new-feature dot until the row is first used. */
  highlight?: boolean
}

export interface NavGroup {
  key: string
  label: string
  icon: NavIcon
  /** Direct navigation target when the group has no children (Home). */
  to?: ViewName
  children?: NavChild[]
}

/** The full tab tree. Every tab except Home carries multiple sub-tabs. */
export const NAV_GROUPS: NavGroup[] = [
  { key: 'home', label: 'Home', icon: Home, to: 'home' },
  {
    key: 'play',
    label: 'Play',
    icon: Swords,
    children: [
      { name: 'play', segment: 'online', label: 'Play Online', icon: Globe },
      { name: 'play', segment: 'bots', label: 'Sparring Bots', icon: Bot },
    ],
  },
  {
    key: 'learn',
    label: 'Learn',
    icon: BookOpen,
    children: [
      { name: 'lessons', label: 'Lessons', icon: GraduationCapIcon },
      { name: 'coachgame', label: 'Play with Coach', icon: MessagesSquare, highlight: true },
      { name: 'review', label: 'Game Review', icon: History },
      { name: 'analysis', label: 'Analysis', icon: LineChart },
    ],
  },
  {
    key: 'puzzles',
    label: 'Puzzles',
    icon: Puzzle,
    children: [
      { name: 'puzzles', label: 'Rated Puzzles', icon: Puzzle },
      { name: 'puzzles', segment: 'daily', label: 'Daily Puzzle', icon: CalendarClock },
      { name: 'puzzles', segment: 'rush', label: 'Puzzle Rush', icon: Zap },
      { name: 'puzzles', segment: 'battle', label: 'Puzzle Battle', icon: Swords },
      { name: 'puzzles', segment: 'vision', label: 'Vision', icon: Eye },
      { name: 'puzzles', segment: 'woodpecker', label: 'Woodpecker', icon: Bird },
    ],
  },
  {
    key: 'tools',
    label: 'Tools',
    icon: Wrench,
    children: [
      { name: 'coach', label: 'Coach Chat', icon: MessageSquareText },
      { name: 'tools', label: 'Import & Records', icon: Upload },
      { name: 'whatsnew', label: "What's New", icon: Sparkles },
    ],
  },
  {
    key: 'more',
    label: 'More',
    icon: Ellipsis,
    children: [
      { name: 'profile', label: 'Profile', icon: UserRound },
      { name: 'settings', label: 'Settings', icon: Settings },
    ],
  },
]

// Small local icon so the tree above stays declarative.
function GraduationCapIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" />
      <path d="M22 10v6" />
      <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" />
    </svg>
  )
}

function childActive(child: NavChild, viewName: ViewName, segment: string | undefined): boolean {
  if (viewName !== child.name) return false
  if (child.segment) return segment === child.segment
  // A bare child is active when no sibling segment is targeted.
  return true
}

function groupActive(group: NavGroup, viewName: ViewName, segment: string | undefined): boolean {
  if (group.to) return viewName === group.to
  if (!group.children) return false
  return group.children.some((c) => childActive(c, viewName, segment))
}

/* ------------------------------- desktop rail ------------------------------ */

export function Sidebar() {
  const { navigate, view, profile, ratings, user } = useApp()
  const segment = view.lessonId
  const [openKey, setOpenKey] = useState<string | null>(() => {
    // Boot with the group that owns the current view already open.
    const g = NAV_GROUPS.find((x) => groupActive(x, view.name, segment))
    return g && g.children ? g.key : null
  })

  const elo = overallRating(ratings)
  const displayName = user?.username ?? profile?.name ?? ''
  const initial = displayName.trim().charAt(0).toUpperCase() || '?'
  const eloText = elo
    ? elo.games < 5
      ? `Elo ${elo.rating} · provisional`
      : `Elo ${elo.rating}`
    : 'Elo pending'

  const openGroup = NAV_GROUPS.find((g) => g.key === openKey && g.children) ?? null

  function go(child: NavChild) {
    navigate(child.name, child.segment)
  }

  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:flex lg:h-dvh lg:self-start">
      <button
        className="flex items-center gap-3 px-5 pb-1 pt-5 text-left"
        onClick={() => {
          setOpenKey(null)
          navigate('home')
        }}
        aria-label="ChessX home"
      >
        <img
          src="/brand.svg"
          alt="ChessX"
          className="h-9 w-9 rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.4)] transition-transform duration-200 active:scale-90"
        />
        <div className="font-display text-xl font-extrabold tracking-tight text-white">ChessX</div>
      </button>

      <nav className="mt-2 flex-1 overflow-y-auto px-3 pb-3 scroll-slim" aria-label="Main">
        {!openGroup ? (
          <div className="space-y-0.5">
            {NAV_GROUPS.map((group) => {
              const Icon = group.icon
              const active = groupActive(group, view.name, segment)
              const hasKids = Boolean(group.children?.length)
              return (
                <button
                  key={group.key}
                  onClick={() => {
                    if (hasKids) setOpenKey(group.key)
                    else if (group.to) navigate(group.to)
                  }}
                  aria-current={active ? 'page' : undefined}
                  aria-expanded={hasKids ? openKey === group.key : undefined}
                  className={cn(
                    'group relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[15px] font-bold transition-colors duration-150 active:scale-[0.98]',
                    active ? 'text-white' : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-white',
                  )}
                >
                  {active && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary-light" aria-hidden="true" />}
                  <Icon
                    className={cn(
                      'h-5 w-5 shrink-0 transition-colors',
                      active ? 'text-primary-light' : 'text-sidebar-foreground/55 group-hover:text-sidebar-foreground',
                    )}
                  />
                  <span className="min-w-0 flex-1 text-left">{group.label}</span>
                  {hasKids && (
                    <ChevronRight className="h-4 w-4 shrink-0 text-sidebar-foreground/40 transition-transform group-hover:translate-x-0.5" />
                  )}
                </button>
              )
            })}
          </div>
        ) : (
          <div className="space-y-0.5">
            <button
              onClick={() => setOpenKey(null)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[13px] font-bold text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/50 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              All tabs
            </button>
            {openGroup.children!.map((child) => {
              const Icon = child.icon
              const active = childActive(child, view.name, segment)
              return (
                <button
                  key={`${child.name}:${child.segment ?? ''}`}
                  onClick={() => go(child)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-bold transition-colors duration-150 active:scale-[0.98]',
                    active ? 'text-white' : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-white',
                  )}
                >
                  {active && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary-light" aria-hidden="true" />}
                  <Icon
                    className={cn(
                      'h-[18px] w-[18px] shrink-0 transition-colors',
                      active ? 'text-primary-light' : 'text-sidebar-foreground/55 group-hover:text-sidebar-foreground',
                    )}
                  />
                  <span className="min-w-0 flex-1 text-left">{child.label}</span>
                  {child.highlight && !active && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-light" aria-label="New" />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        {profile ? (
          <div className="flex items-center gap-2.5">
            <div
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary font-display text-sm font-extrabold uppercase text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.15)]"
              aria-hidden="true"
            >
              {initial}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-bold text-white" title={displayName}>
                {displayName}
              </div>
              <div
                className={cn('truncate text-[11px] font-semibold', elo ? 'text-primary-light' : 'text-sidebar-foreground/50')}
                title={elo ? `${elo.rating} Elo · ${elo.games} rated games` : 'Play a rated game to get an Elo'}
              >
                {eloText}
              </div>
            </div>
            <ThemeToggle />
            <button
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' })
                clearSessionToken()
                window.location.reload()
              }}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-sidebar-foreground/50 transition-all duration-150 hover:bg-sidebar-accent hover:text-white active:scale-90"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  )
}

/* ------------------------------- mobile bars ------------------------------- */

const MOBILE_GROUPS = ['home', 'play', 'learn', 'puzzles'] as const

export function MobileNav() {
  const { view, navigate } = useApp()
  const segment = view.lessonId
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive =
    groupActive(NAV_GROUPS.find((g) => g.key === 'tools')!, view.name, segment) ||
    groupActive(NAV_GROUPS.find((g) => g.key === 'more')!, view.name, segment)

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-sidebar-border bg-sidebar text-sidebar-foreground lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Main mobile"
      >
        {MOBILE_GROUPS.map((key) => {
          const group = NAV_GROUPS.find((g) => g.key === key)!
          const Icon = group.icon
          const active = groupActive(group, view.name, segment)
          return (
            <button
              key={key}
              onClick={() => {
                if (group.to) navigate(group.to)
                else if (group.children) navigate(group.children[0].name, group.children[0].segment)
              }}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-bold transition-transform duration-150 active:scale-90',
                active ? 'text-primary-light' : 'text-sidebar-foreground/70',
              )}
              aria-current={active ? 'page' : undefined}
            >
              <Icon className="h-5 w-5" />
              {group.label}
            </button>
          )
        })}
        <button
          onClick={() => setMoreOpen(true)}
          className={cn(
            'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-bold transition-transform duration-150 active:scale-90',
            moreActive ? 'text-primary-light' : 'text-sidebar-foreground/70',
          )}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
        >
          <LayoutGrid className="h-5 w-5" />
          More
        </button>
      </nav>
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          className="bg-sidebar text-sidebar-foreground border-sidebar-border lg:hidden"
        >
          <SheetTitle className="text-sm font-semibold uppercase tracking-wide text-sidebar-foreground/60">
            All tabs
          </SheetTitle>
          <div className="max-h-[70vh] space-y-3 overflow-y-auto pb-2 scroll-slim">
            {NAV_GROUPS.filter((g) => g.children).map((group) => (
              <div key={group.key}>
                <div className="px-1 pb-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-sidebar-foreground/40">
                  {group.label}
                </div>
                <div className="grid gap-0.5">
                  {group.children!.map((child) => {
                    const Icon = child.icon
                    const active = childActive(child, view.name, segment)
                    return (
                      <button
                        key={`${child.name}:${child.segment ?? ''}`}
                        onClick={() => {
                          setMoreOpen(false)
                          navigate(child.name, child.segment)
                        }}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-bold transition-all duration-150 active:scale-[0.98]',
                          active
                            ? 'bg-sidebar-accent text-white'
                            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white',
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-4 w-4',
                            active ? 'text-primary-light' : 'text-sidebar-foreground/60',
                          )}
                        />
                        {child.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

export function AppFooter() {
  // Deployment freshness stamp: shows exactly which build (or, in dev, which
  // server boot) the instance is serving. The owner's deployment was stuck on
  // Oct 18 with no way to see that — this makes staleness visible at a glance.
  const [stamp, setStamp] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/build-info', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { buildId?: string | null; dev?: boolean; bootIso?: string | null } | null) => {
        if (!alive || !d) return
        if (d.buildId) {
          setStamp(`build ${d.buildId}`)
        } else if (d.bootIso) {
          setStamp(`dev boot ${d.bootIso.slice(0, 16).replace('T', ' ')} UTC`)
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return (
    <footer className="mt-auto border-t border-border px-4 py-3 text-center text-[11px] text-muted-foreground">
      ChessX v0.3.0{stamp ? <> · {stamp}</> : null} · Not affiliated with chess.com or Lichess. Piece set: cburnett
      (CC BY-SA 3.0). Engine: Stockfish.
    </footer>
  )
}
