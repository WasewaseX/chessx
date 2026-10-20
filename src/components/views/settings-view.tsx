'use client'

import { useState } from 'react'
import { useApp } from '@/lib/store'
import { BOARD_THEMES } from '@/lib/chess/board-themes'
import { PROVIDERS } from '@/lib/ai-providers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { COACHES } from '@/lib/coaches'
import { readJson } from '@/lib/api-client'
import { toast } from '@/hooks/use-toast'
import { CharacterFace } from '@/components/chess/characters'
import { cn } from '@/lib/utils'
import { Loader2, CheckCircle2, XCircle, Sun, Moon, Monitor, ShieldCheck } from 'lucide-react'
import { SystemStatusCard } from '@/components/views/system-status-card'

// Decorative pieces on the 4x4 theme preview boards (key = grid cell, row-major).
// White pieces use the solid glyph filled white, black pieces filled black; the
// drop shadows keep both readable on light and dark squares of every theme.
const MINI_PIECES: Record<number, { glyph: string; white: boolean }> = {
  2: { glyph: '♚', white: true },
  9: { glyph: '♞', white: false },
  13: { glyph: '♟', white: true },
}

export function SettingsView() {
  const { profile, patchProfile } = useApp()
  const [name, setName] = useState(profile?.name ?? '')
  const [provider, setProvider] = useState(profile?.aiProvider ?? 'builtin')
  const [baseUrl, setBaseUrl] = useState(profile?.aiBaseUrl ?? '')
  const [model, setModel] = useState(profile?.aiModel ?? '')
  const [apiKey, setApiKey] = useState('')
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [testMsg, setTestMsg] = useState('')
  const [saved, setSaved] = useState(false)

  // Change-password state. Errors from the server are shown verbatim: the
  // honest message is the whole point (wrong current password, too short, ...).
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState('')

  if (!profile) return null

  async function save(patch: Record<string, unknown>) {
    // snapshot the touched fields so a failed PATCH can undo the optimistic write
    const prev: Record<string, unknown> = {}
    for (const k of Object.keys(patch)) {
      prev[k] = (profile as unknown as Record<string, unknown>)[k]
    }
    patchProfile(patch)
    setSaved(false)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const d = await readJson<{ profile?: typeof profile }>(res)
      if (d.profile) patchProfile(d.profile)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch {
      // the server did not take it: put the old values back and say so
      patchProfile(prev)
      toast({ title: 'Could not save settings. Try again.', variant: 'destructive' })
    }
  }

  async function testAi() {
    setTestState('testing')
    setTestMsg('')
    try {
      const res = await fetch('/api/ai/test', { method: 'POST' })
      const d = await readJson<{ ok?: boolean; provider?: string; error?: string }>(res)
      setTestState(d.ok ? 'ok' : 'fail')
      setTestMsg(d.ok ? d.provider ?? 'works' : d.error ?? 'failed')
    } catch (e) {
      setTestState('fail')
      setTestMsg(e instanceof Error ? e.message : 'network error')
    }
  }

  async function changePassword() {
    setPwError('')
    if (newPw.length < 8) {
      setPwError('New password must be at least 8 characters.')
      return
    }
    if (newPw !== confirmPw) {
      setPwError('New password and confirmation do not match.')
      return
    }
    setPwBusy(true)
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      })
      const d = await readJson<{ ok?: boolean; error?: string }>(res)
      if (res.ok && d.ok) {
        setCurrentPw('')
        setNewPw('')
        setConfirmPw('')
        toast({ title: 'Password changed', description: 'Use the new password next time you sign in.' })
      } else {
        setPwError(d.error ?? 'Could not change the password. Try again.')
      }
    } catch {
      setPwError('Network error — the password was not changed.')
    } finally {
      setPwBusy(false)
    }
  }

  const selectedProvider = PROVIDERS[provider]

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="font-display text-2xl font-extrabold">Settings</h1>

      {/* profile */}
      <section className="mt-6 rounded-lg bg-card p-6 shadow-sm">
        <h2 className="font-display text-lg font-bold">Profile</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="grow">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 max-w-xs" maxLength={24} />
          </div>
          <Button className="btn-hero" onClick={() => save({ name: name.trim() || 'Player' })}>
            Save name
          </Button>
          {saved && <span className="text-sm font-semibold text-primary">Saved</span>}
        </div>
      </section>

      {/* security: change password */}
      <section className="mt-6 rounded-lg bg-card p-6 shadow-sm">
        <h2 className="font-display text-lg font-bold">Password</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Change the password for this account. You stay signed in here; the new password applies to the next sign-in.
        </p>
        <div className="mt-4 grid gap-3 sm:max-w-sm">
          <div>
            <Label htmlFor="current-pw">Current password</Label>
            <Input
              id="current-pw"
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              className="mt-1"
              autoComplete="current-password"
              maxLength={128}
            />
          </div>
          <div>
            <Label htmlFor="new-pw">New password (at least 8 characters)</Label>
            <Input
              id="new-pw"
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="mt-1"
              autoComplete="new-password"
              maxLength={128}
            />
          </div>
          <div>
            <Label htmlFor="confirm-pw">Repeat new password</Label>
            <Input
              id="confirm-pw"
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className="mt-1"
              autoComplete="new-password"
              maxLength={128}
            />
          </div>
          {pwError && (
            <p role="alert" className="text-sm font-semibold text-destructive">
              {pwError}
            </p>
          )}
          <div>
            <Button className="btn-hero" onClick={changePassword} disabled={pwBusy || !currentPw || !newPw || !confirmPw}>
              {pwBusy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Changing…
                </>
              ) : (
                'Change password'
              )}
            </Button>
          </div>
        </div>
      </section>

      {/* coach */}
      <section className="mt-6 rounded-lg bg-card p-6 shadow-sm">
        <h2 className="font-display text-lg font-bold">Your coach</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every coach covers the whole curriculum but each has their own style. They speak their feedback out loud too.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {COACHES.map((c) => (
            <button
              key={c.id}
              onClick={() => save({ coach: c.id })}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3 text-left transition',
                profile.coach === c.id
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border hover:border-muted-foreground/40 hover:bg-accent/40',
              )}
              aria-pressed={profile.coach === c.id}
            >
              <CharacterFace id={c.id} label={c.name} className="h-14 w-14 shrink-0 rounded-full shadow-sm ring-1 ring-border" />
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-bold">{c.name}</span>
                  <span className="text-xs font-semibold text-muted-foreground">{c.title}</span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{c.blurb}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* board */}
      <section className="mt-6 rounded-lg bg-card p-6 shadow-sm">
        <h2 className="font-display text-lg font-bold">Board</h2>
        <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {Object.entries(BOARD_THEMES).map(([key, t]) => (
            <button
              key={key}
              onClick={() => save({ theme: key })}
              className={cn(
                'rounded-lg p-1.5 transition',
                profile.theme === key
                  ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                  : 'hover:bg-accent/40',
              )}
              aria-pressed={profile.theme === key}
              aria-label={`Board theme ${t.name}`}
            >
              <div className="grid aspect-square w-full grid-cols-4 overflow-hidden rounded-md shadow-sm">
                {Array.from({ length: 16 }, (_, i) => {
                  const row = Math.floor(i / 4)
                  const col = i % 4
                  const light = (row + col) % 2 === 0
                  const piece = MINI_PIECES[i]
                  return (
                    <div key={i} className="flex items-center justify-center" style={{ background: light ? t.light : t.dark }}>
                      {piece && (
                        <span
                          className={cn(
                            'text-[15px] leading-none',
                            piece.white
                              ? 'text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]'
                              : 'text-black drop-shadow-[0_1px_1px_rgba(255,255,255,0.4)]',
                          )}
                        >
                          {piece.glyph}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="mt-1 truncate text-center text-[11px] font-medium">{t.name}</div>
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-8">
          <div className="flex items-center gap-2">
            <Switch id="coords" checked={profile.showCoords} onCheckedChange={(v) => save({ showCoords: v })} />
            <Label htmlFor="coords">Coordinates</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="legal" checked={profile.showLegal} onCheckedChange={(v) => save({ showLegal: v })} />
            <Label htmlFor="legal">Legal move dots</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="sound" checked={profile.soundEnabled} onCheckedChange={(v) => save({ soundEnabled: v })} />
            <Label htmlFor="sound">Sounds</Label>
          </div>
        </div>
      </section>

      {/* appearance */}
      <section className="mt-6 rounded-lg bg-card p-6 shadow-sm">
        <h2 className="font-display text-lg font-bold">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Light, dark, or follow your system. You can also flip it any time from the toggle in the sidebar.
        </p>
        <div className="mt-3 grid max-w-md grid-cols-3 gap-1 rounded-lg bg-secondary p-1" role="group" aria-label="Color theme">
          {([
            { m: 'light', label: 'Light', Icon: Sun },
            { m: 'dark', label: 'Dark', Icon: Moon },
            { m: 'system', label: 'System', Icon: Monitor },
          ] as const).map(({ m, label, Icon }) => (
            <button
              key={m}
              onClick={() => save({ darkMode: m })}
              aria-pressed={profile.darkMode === m}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-bold transition-all duration-150 active:scale-[0.98]',
                profile.darkMode === m
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* AI */}
      <section className="mt-6 rounded-lg bg-card p-6 shadow-sm">
        <h2 className="font-display text-lg font-bold">AI coach</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The built-in model works out of the box. Prefer your own? Bring an API key. It is stored on this device's database and used server-side only.
        </p>

        <div className="mt-4 grid gap-4">
          <div>
            <Label>Provider</Label>
            <Select
              value={provider}
              onValueChange={(v) => {
                setProvider(v)
                setBaseUrl('')
                setModel('')
                setTestState('idle')
                save({ aiProvider: v, aiBaseUrl: '', aiModel: '' })
              }}
            >
              <SelectTrigger className="mt-1 w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PROVIDERS).map(([key, p]) => (
                  <SelectItem key={key} value={key}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {provider !== 'builtin' && (
            <>
              {provider === 'custom' && (
                <div>
                  <Label htmlFor="baseurl">Base URL (OpenAI-compatible)</Label>
                  <Input
                    id="baseurl"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://your-endpoint/v1"
                    className="mt-1 max-w-md font-mono text-sm"
                  />
                </div>
              )}
              <div>
                <Label htmlFor="model">Model</Label>
                <Input
                  id="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={selectedProvider?.defaultModel ?? 'model name'}
                  className="mt-1 max-w-md font-mono text-sm"
                />
                {provider === 'openrouter' && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    OpenRouter model ids look like openai/gpt-4o-mini or anthropic/claude-3.5-haiku. The full list lives at openrouter.ai/models.
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="key">API key {profile.hasApiKey ? '(saved, leave blank to keep)' : ''}</Label>
                <Input
                  id="key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={provider === 'openrouter' ? 'sk-or-…' : 'sk-…'}
                  className="mt-1 max-w-md font-mono text-sm"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  className="btn-hero"
                  onClick={() => {
                    const patch: Record<string, unknown> = { aiProvider: provider, aiModel: model, aiBaseUrl: baseUrl }
                    if (apiKey.trim()) patch.aiApiKey = apiKey.trim()
                    save(patch).then(() => testAi())
                  }}
                  disabled={testState === 'testing'}
                >
                  {testState === 'testing' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save & test
                </Button>
                {testState === 'ok' && (
                  <span className="flex items-center gap-1 text-sm font-semibold text-primary">
                    <CheckCircle2 className="h-4 w-4" /> {testMsg} responded
                  </span>
                )}
                {testState === 'fail' && (
                  <span className="flex items-center gap-1 text-sm font-semibold text-destructive">
                    <XCircle className="h-4 w-4" /> {testMsg}
                  </span>
                )}
              </div>
            </>
          )}
          {provider === 'builtin' && (
            <p className="text-sm text-muted-foreground">Using the built-in ChessX AI. No key needed.</p>
          )}
        </div>
      </section>

      {/* Fair play & security: chess.com publishes enforcement stats; the
          honest equivalent is publishing exactly how this platform behaves.
          Every line below describes real, verifiable behavior. */}
      <section className="mt-6 rounded-lg bg-card p-6 shadow-sm">
        <h2 className="font-display text-lg font-bold">Security &amp; fairness</h2>
        <p className="mt-1 text-sm text-muted-foreground">How this platform actually behaves — no fine print.</p>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>
              <strong className="text-foreground">Rated games are human-only.</strong> The matchmaking
              queue never inserts bots or engine players — you only get paired with another signed-in
              account. Bot and coach games never touch the rating pool.
            </span>
          </li>
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>
              <strong className="text-foreground">The engine is always labeled.</strong> Stockfish plays
              only where you asked for it (coach games, sparring bots, analysis) at the strength you chose,
              and every coach game is stored as training, never rated.
            </span>
          </li>
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>
              <strong className="text-foreground">The coach cannot invent facts.</strong> Statements about
              your games are verified against the real moves and engine evals before they are shown; when
              something cannot be confirmed, the coach says so.
            </span>
          </li>
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>
              <strong className="text-foreground">Your credentials stay hashed.</strong> Passwords are
              bcrypt-hashed, session tokens are stored hashed, and nothing is shared with third-party
              analytics or ad networks.
            </span>
          </li>
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>
              <strong className="text-foreground">Rate limits protect everyone.</strong> Sign-in, analysis,
              coach chat and imports are rate-limited so no single account can starve the service.
            </span>
          </li>
        </ul>
      </section>

      {/* Self-diagnosis: real round-trips against every subsystem. */}
      <div className="mt-6">
        <SystemStatusCard />
      </div>
    </div>
  )
}
