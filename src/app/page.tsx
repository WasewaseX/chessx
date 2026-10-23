'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'

// Harden every client fetch (timeout + one silent retry) before anything
// else in the app talks to the API.
if (typeof window !== 'undefined') installFetchHardening()
import { useTheme } from 'next-themes'
import { useApp, useHashSync, type ProfileData, type PoolRating } from '@/lib/store'
import { consumeSessionFragment, clearSessionToken } from '@/lib/session'
import { Sidebar, MobileNav, AppFooter } from '@/components/shell/app-chrome'
import { Onboarding } from '@/components/shell/onboarding'
import { useActivityHeartbeat } from '@/lib/use-activity-heartbeat'
import { installFetchHardening } from '@/lib/fetch-retry'

// Every view is code-split: the first paint only ships the chrome plus the
// view actually open, so the bundle stays small even as features grow. Each
// chunk shows the same minimal loader so switches never flash blank.
function viewLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" aria-label="Loading" />
    </div>
  )
}
const AuthScreen = dynamic(() => import('@/components/views/auth-view').then(m => ({ default: m.AuthScreen })), { loading: viewLoader })
const HomeView = dynamic(() => import('@/components/views/home-view').then(m => ({ default: m.HomeView })), { loading: viewLoader })
const PlayView = dynamic(() => import('@/components/views/play-view').then(m => ({ default: m.PlayView })), { loading: viewLoader })
const LessonsView = dynamic(() => import('@/components/views/lessons-view').then(m => ({ default: m.LessonsView })), { loading: viewLoader })
const LessonPlayer = dynamic(() => import('@/components/views/lesson-player').then(m => ({ default: m.LessonPlayer })), { loading: viewLoader })
const PuzzlesView = dynamic(() => import('@/components/views/puzzles-view').then(m => ({ default: m.PuzzlesView })), { loading: viewLoader })
const ReviewView = dynamic(() => import('@/components/views/review-view').then(m => ({ default: m.ReviewView })), { loading: viewLoader })
const CoachView = dynamic(() => import('@/components/views/coach-view').then(m => ({ default: m.CoachView })), { loading: viewLoader })
const AnalysisView = dynamic(() => import('@/components/views/analysis-view').then(m => ({ default: m.AnalysisView })), { loading: viewLoader })
const ProfileView = dynamic(() => import('@/components/views/profile-view').then(m => ({ default: m.ProfileView })), { loading: viewLoader })
const SettingsView = dynamic(() => import('@/components/views/settings-view').then(m => ({ default: m.SettingsView })), { loading: viewLoader })
const ToolsView = dynamic(() => import('@/components/views/tools-view').then(m => ({ default: m.ToolsView })), { loading: viewLoader })
const WhatsNewView = dynamic(() => import('@/components/views/whatsnew-view').then(m => ({ default: m.WhatsNewView })), { loading: viewLoader })
const CoachGameView = dynamic(() => import('@/components/views/coach-game-view').then(m => ({ default: m.CoachGameView })), { loading: viewLoader })
const EyeTrainingPanel = dynamic(() => import('@/components/views/eye-training-view').then(m => ({ default: m.EyeTrainingPanel })), { loading: viewLoader })
const BrainGamesPanel = dynamic(() => import('@/components/views/brain-games-view').then(m => ({ default: m.BrainGamesView })), { loading: viewLoader })
const OpeningsView = dynamic(() => import('@/components/views/openings-view').then(m => ({ default: m.OpeningsView })), { loading: viewLoader })
const SharedDnaOverlay = dynamic(() => import('@/components/views/shared-dna-overlay').then(m => ({ default: m.SharedDnaOverlay })), { loading: viewLoader })

function ViewRouter() {
  const { view } = useApp()
  switch (view.name) {
    case 'play':
      return <PlayView />
    case 'lessons':
      return <LessonsView />
    case 'lesson':
      // key remounts the player per lesson so its state resets cleanly
      return view.lessonId ? <LessonPlayer key={view.lessonId} lessonId={view.lessonId} /> : <LessonsView />
    case 'puzzles':
      return <PuzzlesView />
    case 'review':
      return <ReviewView />
    case 'coach':
      return <CoachView />
    case 'coachgame':
      return <CoachGameView />
    case 'analysis':
      return <AnalysisView />
    case 'eyetraining':
      return <EyeTrainingPanel />
    case 'braingames':
      return <BrainGamesPanel />
    case 'openings':
      return <OpeningsView />
    case 'profile':
      return <ProfileView />
    case 'settings':
      return <SettingsView />
    case 'tools':
      return <ToolsView />
    case 'whatsnew':
      return <WhatsNewView />
    default:
      return <HomeView />
  }
}

export default function Page() {
  useHashSync()
  const { setProfile, setUser, setRatings, profile } = useApp()
  const { setTheme } = useTheme()
  const [loaded, setLoaded] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  // Shared DNA links (?dna=<token>) work signed-out: the overlay renders
  // above the auth gate and closes back to whatever the visitor would see.
  const [shareToken, setShareToken] = useState<string | null>(null)

  useActivityHeartbeat(Boolean(profile?.onboarded))

  const loadSession = useCallback(async () => {
    try {
      // OAuth callbacks deliver the token in the URL fragment when cookies
      // are blocked; consume it before the first /api call.
      consumeSessionFragment()
      const res = await fetch('/api/auth/me', { cache: 'no-store' })
      if (!res.ok) {
        // A stored token that no longer resolves is dead weight; drop it so
        // the next attempt is clean.
        if (res.status === 401) clearSessionToken()
        setSignedIn(false)
        setLoaded(true)
        return
      }
      const d = await res.json()
      setUser(d.user)
      setSignedIn(true)
      if (d.profile) setProfile(d.profile as ProfileData)
      if (Array.isArray(d.ratings)) setRatings(d.ratings as PoolRating[])
      setLoaded(true)
    } catch {
      setSignedIn(false)
      setLoaded(true)
    }
  }, [setProfile, setRatings, setUser])

  useEffect(() => {
    let alive = true
    // /api/auth/me returns user, profile and pool ratings in one call
    Promise.resolve().then(() => {
      if (alive) void loadSession()
    })
    return () => {
      alive = false
    }
  }, [loadSession])

  // apply the stored theme preference: light, dark, or system. next-themes
  // owns the class on the document element (and resolves system mode), so no
  // manual class fiddling here — it would fight system mode.
  useEffect(() => {
    if (!profile) return
    setTheme(profile.darkMode === 'dark' || profile.darkMode === 'light' ? profile.darkMode : 'system')
  }, [profile?.darkMode, setTheme])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const t = new URLSearchParams(window.location.search).get('dna')
    if (!t || !/^[A-Za-z0-9_-]{16,64}$/.test(t)) return
    // Defer the state write out of the effect body so the first commit stays
    // clean (react-hooks/set-state-in-effect).
    const id = window.setTimeout(() => setShareToken(t), 0)
    return () => window.clearTimeout(id)
  }, [])

  const closeShare = useCallback(() => {
    setShareToken(null)
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <img src="/brand.svg" alt="ChessX" className="h-14 w-14 animate-pulse rounded-xl motion-reduce:animate-none" />
      </div>
    )
  }

  if (!signedIn) {
    return (
      <AuthScreen
        onAuthed={() => {
          void loadSession()
        }}
      />
    )
  }

  if (profile && !profile.onboarded) {
    return <Onboarding />
  }

  const chrome = (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <main className="flex-1 pb-16 lg:pb-0">{<ViewRouter />}</main>
        <AppFooter />
      </div>
      <MobileNav />
    </div>
  )

  if (shareToken) {
    return (
      <>
        <SharedDnaOverlay token={shareToken} onClose={closeShare} />
      </>
    )
  }

  return chrome
}
