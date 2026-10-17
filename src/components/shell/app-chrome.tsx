'use client'

import { useState } from 'react'
import { useApp, overallRating, type ViewName } from '@/lib/store'
import { clearSessionToken } from '@/lib/session'
import { cn } from '@/lib/utils'
import {
  Home,
  Swords,
  GraduationCap,
  Puzzle,
  MessageSquareText,
  LineChart,
  UserRound,
  Settings,
  Wrench,
  History,
  LogOut,
  LayoutGrid,
} from 'lucide-react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { ThemeToggle } from '@/components/shell/theme-toggle'

type NavIcon = React.ComponentType<{ className?: string }>

/** Primary destinations, always visible. */
const NAV_MAIN: { name: ViewName; label: string; icon: NavIcon }[] = [
  { name: 'home', label: 'Home', icon: Home },
  { name: 'play', label: 'Play', icon: Swords },
]

/** chess.com groups its rail with tiny uppercase section labels. */
const NAV_SECTIONS: { label: string; items: { name: ViewName; label: string; icon: NavIcon }[] }[] = [
  {
    label: 'Learn',
    items: [
      { name: 'lessons', label: 'Lessons', icon: GraduationCap },
      { name: 'puzzles', label: 'Puzzles', icon: Puzzle },
    ],
  },
  {
    label: 'Tools',
    items: [
      { name: 'coach', label: 'Coach', icon: MessageSquareText },
      { name: 'review', label: 'Review', icon: History },
      { name: 'analysis', label: 'Analysis', icon: LineChart },
    ],
  },
  {
    label: 'Account',
    items: [
      { name: 'profile', label: 'Profile', icon: UserRound },
      { name: 'tools', label: 'Tools', icon: Wrench },
      { name: 'settings', label: 'Settings', icon: Settings },
    ],
  },
]

const NAV_EXTRA = NAV_SECTIONS.flatMap((s) => s.items)

function NavButton({
  name,
  label,
  icon: Icon,
  onNavigate,
}: {
  name: ViewName
  label: string
  icon: NavIcon
  onNavigate?: () => void
}) {
  const { view, navigate } = useApp()
  const active = view.name === name
  return (
    <button
      onClick={() => {
        navigate(name)
        onNavigate?.()
      }}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-bold transition-colors duration-150 active:scale-[0.98]',
        active
          ? 'bg-sidebar-accent text-white'
          : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-white',
      )}
    >
      <Icon
        className={cn(
          'h-[18px] w-[18px] shrink-0 transition-colors',
          active ? 'text-primary-light' : 'text-sidebar-foreground/55 group-hover:text-sidebar-foreground',
        )}
      />
      {label}
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-3 text-[10px] font-extrabold uppercase tracking-[0.14em] text-sidebar-foreground/40">
      {children}
    </div>
  )
}

export function Sidebar() {
  const { navigate, profile, ratings, user } = useApp()
  const elo = overallRating(ratings)
  const displayName = user?.username ?? profile?.name ?? ''
  const initial = displayName.trim().charAt(0).toUpperCase() || '?'
  const eloText = elo
    ? elo.games < 5
      ? `Elo ${elo.rating} · provisional`
      : `Elo ${elo.rating}`
    : 'Elo pending'

  return (
    <aside className="hidden w-56 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:flex lg:h-dvh lg:self-start">
      <button
        className="flex items-center gap-3 px-5 pb-1 pt-5 text-left"
        onClick={() => navigate('home')}
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
        <div className="space-y-0.5">
          {NAV_MAIN.map(({ name, label, icon }) => (
            <NavButton key={name} name={name} label={label} icon={icon} />
          ))}
        </div>
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <SectionLabel>{section.label}</SectionLabel>
            <div className="space-y-0.5">
              {section.items.map(({ name, label, icon }) => (
                <NavButton key={name} name={name} label={label} icon={icon} />
              ))}
            </div>
          </div>
        ))}
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

export function MobileNav() {
  const { view, navigate } = useApp()
  const [moreOpen, setMoreOpen] = useState(false)
  const extrasActive = NAV_EXTRA.some((n) => n.name === view.name)
  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-sidebar-border bg-sidebar text-sidebar-foreground lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Main mobile"
      >
        {NAV_MAIN.slice(0, 2)
          .concat(NAV_SECTIONS[0].items.slice(0, 2))
          .map(({ name, label, icon: Icon }) => {
            const active = view.name === name
            return (
              <button
                key={name}
                onClick={() => navigate(name)}
                className={cn(
                  'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-bold transition-transform duration-150 active:scale-90',
                  active ? 'text-primary-light' : 'text-sidebar-foreground/70',
                )}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            )
          })}
        <button
          onClick={() => setMoreOpen(true)}
          className={cn(
            'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-bold transition-transform duration-150 active:scale-90',
            extrasActive ? 'text-primary-light' : 'text-sidebar-foreground/70',
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
            More
          </SheetTitle>
          <div className="grid gap-1 pb-2">
            {NAV_EXTRA.map(({ name, label, icon: Icon }) => (
              <button
                key={name}
                onClick={() => {
                  setMoreOpen(false)
                  navigate(name)
                }}
                aria-current={view.name === name ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-3 text-sm font-bold transition-all duration-150 active:scale-[0.98]',
                  view.name === name
                    ? 'bg-sidebar-accent text-white'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white',
                )}
              >
                <Icon
                  className={cn(
                    'h-5 w-5',
                    view.name === name ? 'text-primary-light' : 'text-sidebar-foreground/60',
                  )}
                />
                {label}
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

export function AppFooter() {
  return (
    <footer className="mt-auto border-t border-border px-4 py-3 text-center text-[11px] text-muted-foreground">
      ChessX v0.3.0 · Not affiliated with chess.com or Lichess. Piece set: cburnett (CC BY-SA 3.0). Engine: Stockfish.
    </footer>
  )
}
