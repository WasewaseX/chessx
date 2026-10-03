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
import { cn } from '@/lib/utils'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'

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

  if (!profile) return null

  async function save(patch: Record<string, unknown>) {
    patchProfile(patch)
    setSaved(false)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const d = await res.json()
      if (d.profile) patchProfile(d.profile)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch {
      /* offline */
    }
  }

  async function testAi() {
    setTestState('testing')
    setTestMsg('')
    try {
      const res = await fetch('/api/ai/test', { method: 'POST' })
      const d = await res.json()
      setTestState(d.ok ? 'ok' : 'fail')
      setTestMsg(d.ok ? d.provider ?? 'works' : d.error ?? 'failed')
    } catch (e) {
      setTestState('fail')
      setTestMsg(e instanceof Error ? e.message : 'network error')
    }
  }

  const selectedProvider = PROVIDERS[provider]

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="font-display text-2xl font-extrabold">Settings</h1>

      {/* profile */}
      <section className="mt-6 rounded-lg bg-card p-5 shadow-sm">
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

      {/* coach */}
      <section className="mt-4 rounded-lg bg-card p-5 shadow-sm">
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
              <img src={c.face} alt={c.name} className="h-14 w-14 shrink-0 rounded-full object-cover object-top shadow-sm" />
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
      <section className="mt-4 rounded-lg bg-card p-5 shadow-sm">
        <h2 className="font-display text-lg font-bold">Board</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {Object.entries(BOARD_THEMES).map(([key, t]) => (
            <button
              key={key}
              onClick={() => save({ theme: key })}
              className={cn(
                'overflow-hidden rounded-md border-2 shadow-sm transition',
                profile.theme === key ? 'border-primary' : 'border-transparent hover:border-muted-foreground/40',
              )}
              aria-pressed={profile.theme === key}
              aria-label={`Board theme ${t.name}`}
            >
              <div className="grid h-12 w-16 grid-cols-4">
                {Array.from({ length: 8 }, (_, i) => {
                  const row = Math.floor(i / 4)
                  const col = i % 4
                  const light = (row + col) % 2 === 0
                  return <div key={i} style={{ background: light ? t.light : t.dark }} />
                })}
              </div>
              <div className="bg-secondary py-0.5 text-center text-[10px] font-bold">{t.name}</div>
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
      <section className="mt-4 rounded-lg bg-card p-5 shadow-sm">
        <h2 className="font-display text-lg font-bold">Appearance</h2>
        <div className="mt-3 flex overflow-hidden rounded-md border">
          {(['light', 'dark'] as const).map((m) => (
            <button
              key={m}
              onClick={() => save({ darkMode: m })}
              className={cn('px-5 py-2 text-sm font-semibold capitalize', profile.darkMode === m ? 'bg-primary text-primary-foreground' : 'bg-secondary')}
            >
              {m}
            </button>
          ))}
        </div>
      </section>

      {/* AI */}
      <section className="mt-4 rounded-lg bg-card p-5 shadow-sm">
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
              </div>
              <div>
                <Label htmlFor="key">API key {profile.hasApiKey ? '(saved, leave blank to keep)' : ''}</Label>
                <Input
                  id="key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={profile.hasApiKey ? '••••••••' : 'sk-…'}
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
    </div>
  )
}
