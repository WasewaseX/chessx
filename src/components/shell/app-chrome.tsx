'use client'

import { useState } from 'react'
import { useApp, type ViewName } from '@/lib/store'
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
  History,
  LayoutGrid,
} from 'lucide-react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'

const NAV: { name: ViewName; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { name: 'lessons', label: 'Learn', icon: GraduationCap },
  { name: 'play', label: 'Play', icon: Swords },
  { name: 'coach', label: 'Coach', icon: MessageSquareText },
  { name: 'puzzles', label: 'Puzzles', icon: Puzzle },
]

const NAV_EXTRA: { name: ViewName; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { name: 'home', label: 'Home', icon: Home },
  { name: 'review', label: 'Review', icon: History },
  { name: 'analysis', label: 'Analysis', icon: LineChart },
  { name: 'profile', label: 'Profile', icon: UserRound },
  { name: 'settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const { view, navigate, profile, ratings, user } = useApp()
  const blitz = ratings.find((r) => r.pool === 'blitz')
  return (
    <aside className="hidden w-56 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:flex lg:h-dvh lg:self-start">
      <button
        className="flex items-center gap-3 px-5 pb-2 pt-5 text-left"
        onClick={() => navigate('home')}
        aria-label="ChessX home"
      >
        <img src="/brand.svg" alt="ChessX" className="h-9 w-9 rounded-lg transition-transform duration-200 active:scale-90" />
        <div>
          <div className="font-display text-xl font-extrabold tracking-tight">ChessX</div>
        </div>
      </button>

      <nav className="mt-3 flex-1 px-3" aria-label="Main">
        {[...NAV, ...NAV_EXTRA].map(({ name, label, icon: Icon }) => (
          <button
            key={name}
            onClick={() => navigate(name)}
            aria-current={view.name === name ? 'page' : undefined}
            className={cn(
              'mb-0.5 flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition-all duration-150 hover:bg-sidebar-accent/60 active:scale-[0.98]',
              view.name === name ? 'bg-sidebar-accent text-white' : 'text-sidebar-foreground/80 hover:text-white',
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
      </nav>

      <div className="border-t border-sidebar-border px-5 py-4 text-xs text-sidebar-foreground/70">
        {profile ? (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-bold text-sidebar-foreground">{user?.username ?? profile.name}</div>
              <div className="mt-0.5">
                {blitz ? `Blitz ${blitz.rating}` : 'No rated games yet'}
              </div>
            </div>
            <button
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' })
                window.location.reload()
              }}
              className="rounded px-2 py-1 text-[11px] font-semibold text-sidebar-foreground/60 transition-colors hover:bg-white/5 hover:text-white"
              aria-label="Sign out"
            >
              Sign out
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
        {NAV.map(({ name, label, icon: Icon }) => (
          <button
            key={name}
            onClick={() => navigate(name)}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition-transform duration-150 active:scale-90',
              view.name === name ? 'text-[#a3d160]' : 'text-sidebar-foreground/70',
            )}
            aria-current={view.name === name ? 'page' : undefined}
          >
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className={cn(
            'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition-transform duration-150 active:scale-90',
            extrasActive ? 'text-[#a3d160]' : 'text-sidebar-foreground/70',
          )}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
        >
          <LayoutGrid className="h-5 w-5" />
          More
        </button>
      </nav>
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" aria-describedby={undefined} className="bg-sidebar text-sidebar-foreground border-sidebar-border">
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
                  'flex items-center gap-3 rounded-md px-3 py-3 text-sm font-semibold transition-all duration-150 active:scale-[0.98]',
                  view.name === name
                    ? 'bg-sidebar-accent text-white'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white',
                )}
              >
                <Icon className="h-5 w-5" />
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
