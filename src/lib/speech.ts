// Coach speech, done with the browser's own voice engine: native OS voices
// (Aria, Jenny, Google US English, Samantha, ...) so English sounds English,
// never like a dubbed movie. Chess notation is expanded into spoken words
// first, so "Nf3" is heard as "knight to F three" instead of a mangled word.

export interface SpeakOptions {
  text: string
  voice: string // coach key: 'nina' | 'victor' | 'elena' | 'sasha' | 'default'
  speed?: number
  onDone?: () => void
}

/* ---------- notation → speech ---------- */

const PIECE_WORDS: Record<string, string> = {
  K: 'King',
  Q: 'Queen',
  R: 'Rook',
  B: 'Bishop',
  N: 'Knight',
}

function rankWord(d: string): string {
  const words: Record<string, string> = { '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight' }
  return words[d] ?? d
}

const SAN_RE = /^(?:(O-O(-O)?)|([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=([QRBN]))?)([+#])?$/

function expandSan(tok: string): string {
  const m = tok.match(SAN_RE)
  if (!m) return tok
  if (m[1]) return m[2] ? 'castle long' : 'castle short'
  // group order: 1 castle, 2 long-castle tail, 3 piece, 4 fromFile, 5 fromRank,
  // 6 capture, 7 destination, 8 promotion, 9 check/mate suffix
  const piece = m[3]
  const fromFile = m[4]
  const fromRank = m[5]
  const isCapture = m[6]
  const dest = m[7]
  if (!dest) return tok // defensive: group drift must never break speech
  const promo = m[8]
  const suffix = m[9]
  const parts: string[] = []
  if (piece && fromFile) parts.push(`${PIECE_WORDS[piece]} from ${fromFile.toUpperCase()}`)
  else if (piece && fromRank) parts.push(`${PIECE_WORDS[piece]} ${rankWord(fromRank)}`)
  else if (piece) parts.push(PIECE_WORDS[piece] ?? piece)
  else if (fromFile && isCapture) parts.push(`${fromFile.toUpperCase()} pawn`)
  if (isCapture) parts.push('takes')
  else if (piece) parts.push('to')
  parts.push(dest[0].toUpperCase() + ' ' + rankWord(dest[1]))
  if (promo) parts.push('promotes to ' + (PIECE_WORDS[promo] ?? promo))
  if (suffix === '#') parts.push(', checkmate')
  else if (suffix === '+') parts.push(', check')
  return parts.join(' ')
}

/** Turn coach text into something a voice can say naturally. */
export function speechText(raw: string): string {
  let t = raw
  t = t.replace(/```[\s\S]*?```/g, ' ')
  t = t.replace(/`([^`]+)`/g, '$1')
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  t = t.replace(/https?:\/\/\S+/g, '')
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1')
  t = t.replace(/\*([^*]+)\*/g, '$1')
  t = t.replace(/^#{1,6}\s+/gm, '')
  t = t.replace(/^>\s?/gm, '')
  t = t.replace(/^\s*[-•*]\s+/gm, '')
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
  t = t.replace(/\b1\/2-1\/2\b/g, 'a draw')
  t = t.replace(/\b1-0\b/g, 'White won')
  t = t.replace(/\b0-1\b/g, 'Black won')
  t = t.replace(/\bO-O-O\b/g, 'castle long')
  t = t.replace(/\bO-O\b/g, 'castle short')
  t = t.replace(/\be\.p\./g, '')
  // move numbers: "1." "12..." become spoken counts
  t = t.replace(/\b(\d{1,3})\.(?!\d)/g, '$1,')
  // expand SAN tokens (case-sensitive on purpose: files are lowercase)
  t = t.replace(/\b(?:O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|[a-h]x[a-h][1-8]|[a-h][1-8](?:=[QRBN])?)[+#]?/g, (tok) => expandSan(tok))
  return t.replace(/\s+/g, ' ').trim()
}

/* ---------- voice selection ---------- */

interface VoiceProfile {
  index: number // preference among the quality-sorted English voices
  pitch: number
  rate: number
}

const PROFILES: Record<string, VoiceProfile> = {
  nina: { index: 0, pitch: 1.08, rate: 0.97 },
  victor: { index: 1, pitch: 0.98, rate: 1.08 },
  elena: { index: 2, pitch: 0.96, rate: 0.95 },
  sasha: { index: 3, pitch: 0.82, rate: 0.92 },
  default: { index: 0, pitch: 1, rate: 1 },
}

function scoreVoice(v: SpeechSynthesisVoice): number {
  const n = v.name.toLowerCase()
  let s = 0
  if (/natural|neural/.test(n)) s += 6
  if (/google us english/.test(n)) s += 5
  if (/aria|jenny|guy|sonia|libby|ryan|emma/.test(n)) s += 4
  if (/samantha|serena|ava|allison|zira|karen|moira|daniel|kate/.test(n)) s += 3
  if (/compact|espeak|robot/.test(n)) s -= 4
  const lang = v.lang.toLowerCase()
  if (lang === 'en-us') s += 2
  else if (lang === 'en-gb') s += 1
  if (v.localService) s += 1
  return s
}

let voiceCache: SpeechSynthesisVoice[] | null = null
let warmRequested = false

function warmVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      resolve([])
      return
    }
    const synth = window.speechSynthesis
    const existing = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'))
    if (existing.length > 0) {
      voiceCache = existing
      resolve(existing)
      return
    }
    if (warmRequested) {
      resolve(voiceCache ?? [])
      return
    }
    warmRequested = true
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      const list = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'))
      voiceCache = list
      resolve(list)
    }
    synth.addEventListener('voiceschanged', finish, { once: true })
    // some engines never fire the event; poll once after a beat
    setTimeout(finish, 700)
  })
}

/* ---------- playback queue ---------- */

let currentToken = 0
let stateListener: ((speaking: boolean) => void) | null = null
let doneCb: (() => void) | null = null

export function onSpeakingStateChange(cb: (speaking: boolean) => void): () => void {
  stateListener = cb
  return () => {
    if (stateListener === cb) stateListener = null
  }
}

export function isSpeaking(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.speaking
}

/** Whether this browser can speak at all (button can hide otherwise). */
export function hasSpeech(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

function chunkText(text: string, maxLen = 170): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]?|[^.!?]+$/g) ?? [text]
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
  return chunks.length ? chunks : [text]
}

/** Speak text out loud with the given coach's voice. Cancels anything running. */
export async function speak(opts: SpeakOptions): Promise<void> {
  stopSpeaking()
  const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
  const spoken = speechText(opts.text)
  if (!synth || !spoken) {
    doneCb = opts.onDone ?? null
    stateListener?.(false)
    doneCb?.()
    doneCb = null
    return
  }
  const token = ++currentToken
  doneCb = opts.onDone ?? null
  const voices = await warmVoices()
  if (token !== currentToken) return

  const profile = PROFILES[opts.voice] ?? PROFILES.default
  let picked: SpeechSynthesisVoice | undefined
  if (voices.length > 0) {
    const sorted = [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a))
    picked = sorted[profile.index % sorted.length]
  }
  if (!picked && voices.length === 0) {
    // no English voice installed: stay silent rather than mangle the text
    stateListener?.(false)
    doneCb?.()
    doneCb = null
    return
  }

  const chunks = chunkText(spoken)
  stateListener?.(true)
  let idx = 0
  const next = () => {
    if (token !== currentToken) return
    if (idx >= chunks.length) {
      stateListener?.(false)
      doneCb?.()
      doneCb = null
      return
    }
    const text = chunks[idx++]
    // Some engines never fire onend (headless previews, a few Linux builds).
    // Two stopgaps keep every listener honest: if nothing is speaking or
    // pending a beat after queueing, the engine ignored us; and if a chunk
    // runs absurdly long it is treated as finished rather than stuck.
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      window.clearInterval(ignorePoll)
      window.clearTimeout(stallGuard)
      next()
    }
    // started before the try so settle can always clear them
    const ignorePoll = window.setInterval(() => {
      if (!synth!.speaking && !synth!.pending) settle()
    }, 1000)
    const stallGuard = window.setTimeout(
      settle,
      Math.max(6000, (text.length / 9) * 1000 / Math.max(0.5, opts.speed ?? profile.rate)) + 3000,
    )
    try {
      const u = new SpeechSynthesisUtterance(text)
      if (picked) u.voice = picked
      u.pitch = profile.pitch
      u.rate = Math.min(1.6, Math.max(0.6, opts.speed ?? profile.rate))
      u.onend = settle
      u.onerror = settle
      synth!.speak(u)
    } catch {
      // an engine that rejects the utterance outright: treat the chunk as
      // finished so queues and button states never freeze
      settle()
    }
  }
  next()
}

export function stopSpeaking() {
  currentToken++
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel()
    } catch {
      /* ignore */
    }
  }
  stateListener?.(false)
  doneCb?.()
  doneCb = null
}
