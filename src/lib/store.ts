// Client-side app state: view routing (single-page app on /), profile cache.
import { create } from 'zustand'
import { useEffect } from 'react'

export type ViewName =
  | 'home'
  | 'play'
  | 'lessons'
  | 'lesson'
  | 'puzzles'
  | 'review'
  | 'coach'
  | 'analysis'
  | 'profile'
  | 'settings'

export interface ViewState {
  name: ViewName
  lessonId?: string
}

export interface PoolRating {
  pool: string // 'overall' (one Elo, updated only by rated online games)
  rating: number
  rd: number
  games: number
  wins: number
  losses: number
  draws: number
}

/** The single account Elo. Null while the account has no rated games yet. */
export function overallRating(rows: PoolRating[] | undefined | null): PoolRating | null {
  return rows?.find((r) => r.pool === 'overall') ?? null
}

export interface AuthUser {
  id: string
  email: string
  username: string
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
  botGames: number
  botElo: number
  botEloGames: number
  goalMinutes: number
  rushBest3m: number
  rushBestSurvival: number
  streakFreezes: number
  aiProvider: string
  aiBaseUrl: string | null
  aiModel: string | null
  hasApiKey?: boolean
}

interface AppState {
  view: ViewState
  navigate: (name: ViewName, lessonId?: string) => void
  user: AuthUser | null
  setUser: (u: AuthUser | null) => void
  ratings: PoolRating[]
  setRatings: (r: PoolRating[]) => void
  profile: ProfileData | null
  setProfile: (p: ProfileData) => void
  patchProfile: (p: Partial<ProfileData>) => void
  /** PGN awaiting review in the Analysis view (set after a game ends). */
  reviewPgn: string | null
  setReviewPgn: (pgn: string | null) => void
  /** Saved game id that belongs to reviewPgn, so the report can land in Insights. */
  reviewGameId: string | null
  setReviewGameId: (id: string | null) => void
  /** A spaced-repetition item launched from the Review view. */
  pendingReview: { itemId: string; kind: 'puzzle' | 'lesson'; refId: string } | null
  setPendingReview: (item: AppState['pendingReview']) => void
  /** Saved game id waiting for the coach to walk through it (set by Analysis). */
  pendingCoachGame: string | null
  setPendingCoachGame: (id: string | null) => void
}

function viewFromHash(): ViewState {
  const h = window.location.hash.replace(/^#\/?/, '')
  const [name, lessonId] = h.split('/')
  const valid: ViewName[] = ['home', 'play', 'lessons', 'lesson', 'puzzles', 'review', 'coach', 'analysis', 'profile', 'settings']
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
  user: null,
  setUser: (u) => set({ user: u }),
  ratings: [],
  setRatings: (r) => set({ ratings: r }),
  profile: null,
  setProfile: (p) => set({ profile: p }),
  patchProfile: (p) =>
    set((s) => ({ profile: s.profile ? { ...s.profile, ...p } : s.profile })),
  reviewPgn: null,
  setReviewPgn: (pgn) => set({ reviewPgn: pgn }),
  reviewGameId: null,
  setReviewGameId: (id) => set({ reviewGameId: id }),
  pendingReview: null,
  setPendingReview: (item) => set({ pendingReview: item }),
  pendingCoachGame: null,
  setPendingCoachGame: (id) => set({ pendingCoachGame: id }),
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
