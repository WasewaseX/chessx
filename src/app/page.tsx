'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { useApp, useHashSync, type ProfileData, type PoolRating } from '@/lib/store'
import { consumeSessionFragment, clearSessionToken } from '@/lib/session'
import { Sidebar, MobileNav, AppFooter } from '@/components/shell/app-chrome'
import { Onboarding } from '@/components/shell/onboarding'
import { AuthScreen } from '@/components/views/auth-view'
import { HomeView } from '@/components/views/home-view'
import { PlayView } from '@/components/views/play-view'
import { LessonsView } from '@/components/views/lessons-view'
import { LessonPlayer } from '@/components/views/lesson-player'
import { PuzzlesView } from '@/components/views/puzzles-view'
import { ReviewView } from '@/components/views/review-view'
import { CoachView } from '@/components/views/coach-view'
import { AnalysisView } from '@/components/views/analysis-view'
import { ProfileView } from '@/components/views/profile-view'
import { SettingsView } from '@/components/views/settings-view'
import { useActivityHeartbeat } from '@/lib/use-activity-heartbeat'

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
    case 'analysis':
      return <AnalysisView />
    case 'profile':
      return <ProfileView />
    case 'settings':
      return <SettingsView />
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

  // apply stored dark mode preference: next-themes owns the class on the
  // document element so color-scheme and every themed surface stay in sync
  useEffect(() => {
    if (!profile) return
    const root = document.documentElement
    const dark = profile.darkMode === 'dark'
    setTheme(dark ? 'dark' : 'light')
    if (dark) root.classList.add('dark')
    else root.classList.remove('dark')
  }, [profile?.darkMode, setTheme])

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

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <main className="flex-1 pb-16 lg:pb-0">{<ViewRouter />}</main>
        <AppFooter />
      </div>
      <MobileNav />
    </div>
  )
}
