'use client'

import { useEffect, useState } from 'react'
import { useApp, useHashSync, type ProfileData } from '@/lib/store'
import { Sidebar, MobileNav, AppFooter } from '@/components/shell/app-chrome'
import { Onboarding } from '@/components/shell/onboarding'
import { HomeView } from '@/components/views/home-view'
import { PlayView } from '@/components/views/play-view'
import { LessonsView } from '@/components/views/lessons-view'
import { LessonPlayer } from '@/components/views/lesson-player'
import { PuzzlesView } from '@/components/views/puzzles-view'
import { CoachView } from '@/components/views/coach-view'
import { AnalysisView } from '@/components/views/analysis-view'
import { ProfileView } from '@/components/views/profile-view'
import { SettingsView } from '@/components/views/settings-view'

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
  const { setProfile, profile } = useApp()
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/profile')
      .then((r) => r.json())
      .then((d) => {
        if (alive && d.profile) setProfile(d.profile as ProfileData)
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true))
    return () => {
      alive = false
    }
  }, [setProfile])

  // apply stored dark mode preference
  useEffect(() => {
    if (!profile) return
    const root = document.documentElement
    if (profile.darkMode === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
  }, [profile?.darkMode])

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sidebar">
        { }
        <img src="/logo.svg" alt="Ply" className="h-14 w-14 animate-pulse rounded-xl" />
      </div>
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
