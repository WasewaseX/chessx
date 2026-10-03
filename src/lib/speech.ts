// Client-side speech: turns coach text into spoken audio via /api/tts.
// Long text is split into sentence chunks and played back to back.
// A module-level cache keeps repeat lines instant and free.

export interface SpeakOptions {
  text: string
  voice: string
  speed?: number
  onDone?: () => void
}

interface CacheEntry {
  audio: HTMLAudioElement[]
}

const cache = new Map<string, CacheEntry>()

let currentAudio: HTMLAudioElement[] = []
let currentToken = 0
let doneCb: (() => void) | null = null
let stateListener: ((speaking: boolean) => void) | null = null

/** Subscribe to global speaking state (used by speak buttons). */
export function onSpeakingStateChange(cb: (speaking: boolean) => void): () => void {
  stateListener = cb
  return () => {
    if (stateListener === cb) stateListener = null
  }
}

export function isSpeaking(): boolean {
  return currentAudio.length > 0
}

function chunkText(text: string, maxLen = 900): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= maxLen) return [clean]
  const sentences = clean.match(/[^.!?]+[.!?]+["')\]]?|[^.!?]+$/g) ?? [clean]
  const chunks: string[] = []
  let cur = ''
  for (const s of sentences) {
    if ((cur + s).length <= maxLen) {
      cur += s
    } else {
      if (cur.trim()) chunks.push(cur.trim())
      cur = s.length > maxLen ? s.slice(0, maxLen) : s
    }
  }
  if (cur.trim()) chunks.push(cur.trim())
  return chunks
}

async function fetchChunk(chunk: string, voice: string, speed: number): Promise<string> {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: chunk, voice, speed }),
  })
  if (!res.ok) throw new Error('tts failed')
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

/** Speak the text with the given voice. Cancels any speech already running. */
export async function speak(opts: SpeakOptions): Promise<void> {
  stopSpeaking()
  const token = ++currentToken
  doneCb = opts.onDone ?? null
  const { text, voice } = opts
  const speed = opts.speed ?? 1
  const key = `${voice}:${speed}:${text}`
  let entry = cache.get(key)
  if (!entry) {
    const chunks = chunkText(text)
    const audio: HTMLAudioElement[] = []
    for (const chunk of chunks) {
      const url = await fetchChunk(chunk, voice, speed)
      if (token !== currentToken) {
        URL.revokeObjectURL(url)
        return
      }
      audio.push(new Audio(url))
    }
    entry = { audio }
    cache.set(key, entry)
  }
  if (token !== currentToken) return
  currentAudio = entry.audio
  // play sequentially; cached entries are reusable so urls are never revoked
  const chain = currentAudio
  for (let i = 0; i < chain.length; i++) {
    const a = chain[i]
    const next = chain[i + 1]
    a.onended = () => {
      if (next) void next.play()
      else {
        if (currentAudio === chain) currentAudio = []
        stateListener?.(false)
        doneCb?.()
      }
    }
  }
  stateListener?.(true)
  try {
    void chain[0]?.play()
  } catch {
    stateListener?.(false)
    doneCb?.()
  }
}

export function stopSpeaking() {
  currentToken++
  for (const a of currentAudio) {
    a.onended = null
    a.pause()
    a.currentTime = 0
  }
  currentAudio = []
  stateListener?.(false)
  doneCb?.()
  doneCb = null
}
