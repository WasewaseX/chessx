// Client-side app state: view routing (single-page app on /), profile cache.
import { create } from 'zustand'
import { useEffect } from 'react'

export type ViewName =
  | 'home'
  | 'play'
  | 'lessons'
  | 'lesson'
  | 'puzzles'
  | 'coach'
  | 'analysis'
  | 'profile'
  | 'settings'

export interface ViewState {
  name: ViewName
  lessonId?: string
}

export interface ProfileData {
  name: string
  skillLevel: string
  coach: string
  onboarded: boolean
  theme: string
  darkMode: string
  soundEnabled: boolean
  showCoords: boolean
  showLegal: boolean
  autoPromote: boolean
  xp: number
  puzzleRating: number | null
  puzzleCount: number
  puzzleStreak: number
  bestPuzzleStreak: number
  puzzleSolved: number
  puzzleFailed: number
  dailyDoneDate: string | null
  ladderRating: number | null
  ladderCount: number
  aiProvider: string
  aiBaseUrl: string | null
  aiModel: string | null
  hasApiKey?: boolean
}

interface AppState {
  view: ViewState
  navigate: (name: ViewName, lessonId?: string) => void
  profile: ProfileData | null
  setProfile: (p: ProfileData) => void
  patchProfile: (p: Partial<ProfileData>) => void
  /** PGN awaiting review in the Analysis view (set after a game ends). */
  reviewPgn: string | null
  setReviewPgn: (pgn: string | null) => void
}

function viewFromHash(): ViewState {
  const h = window.location.hash.replace(/^#\/?/, '')
  const [name, lessonId] = h.split('/')
  const valid: ViewName[] = ['home', 'play', 'lessons', 'lesson', 'puzzles', 'coach', 'analysis', 'profile', 'settings']
  if (valid.includes(name as ViewName)) {
    return { name: name as ViewName, lessonId: lessonId || undefined }
  }
  return { name: 'home' }
}

export const useApp = create<AppState>((set) => ({
  view: { name: 'home' },
  navigate: (name, lessonId) => {
    window.location.hash = lessonId ? `/${name}/${lessonId}` : `/${name}`
    set({ view: { name, lessonId } })
  },
  profile: null,
  setProfile: (p) => set({ profile: p }),
  patchProfile: (p) =>
    set((s) => ({ profile: s.profile ? { ...s.profile, ...p } : s.profile })),
  reviewPgn: null,
  setReviewPgn: (pgn) => set({ reviewPgn: pgn }),
}))

/** Keeps the hash and the store in sync (deep links, back button). */
export function useHashSync() {
  useEffect(() => {
    const onHash = () => set_viewFromHash()
    const set_viewFromHash = () => {
      const v = viewFromHash()
      useApp.setState({ view: v })
    }
    window.addEventListener('hashchange', onHash)
    if (window.location.hash) set_viewFromHash()
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
}
