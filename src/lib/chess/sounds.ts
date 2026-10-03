// Board sounds built from real recorded chess samples (the wooden click set
// the lichess project ships, CC0). A tiny synth layer covers the musical
// motifs and the soft miss cue. Everything runs through a master gain and a
// limiter so no sound, on any move, can ever spike into clipping territory.

let ctx: AudioContext | null = null
let out: GainNode | null = null
const buffers = new Map<string, AudioBuffer>()
const failed = new Set<string>()

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

// Master bus: modest level into a hard limiter. Even stacked sounds (castle,
// check ping over a move) physically cannot exceed this ceiling.
function master(c: AudioContext): GainNode {
  if (!out) {
    const g = c.createGain()
    g.gain.value = 0.55
    const limiter = c.createDynamicsCompressor()
    limiter.threshold.value = -14
    limiter.knee.value = 6
    limiter.ratio.value = 16
    limiter.attack.value = 0.002
    limiter.release.value = 0.12
    g.connect(limiter).connect(c.destination)
    out = g
  }
  return out
}

async function load(name: string): Promise<AudioBuffer | null> {
  const c = ac()
  if (!c) return null
  const cached = buffers.get(name)
  if (cached) return cached
  if (failed.has(name)) return null
  try {
    const res = await fetch(`/sfx/${name}.mp3`)
    if (!res.ok) throw new Error('missing')
    const buf = await c.decodeAudioData(await res.arrayBuffer())
    buffers.set(name, buf)
    return buf
  } catch {
    failed.add(name)
    return null
  }
}

// Warm one synth fallback for the wooden click, in case the sample has not
// loaded yet: short filtered noise, deliberately dull and quiet.
function clickSynth(gain: number, delay = 0) {
  const c = ac()
  if (!c) return
  const t0 = c.currentTime + delay
  const len = Math.floor(c.sampleRate * 0.05)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5)
  const src = c.createBufferSource()
  src.buffer = buf
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 1400
  bp.Q.value = 1
  const g = c.createGain()
  g.gain.value = gain
  src.connect(bp).connect(g).connect(master(c))
  src.start(t0)
}

function playBuffer(buf: AudioBuffer, gain: number, delay = 0) {
  const c = ac()
  if (!c) return
  const t0 = c.currentTime + delay
  const src = c.createBufferSource()
  src.buffer = buf
  const g = c.createGain()
  g.gain.value = gain
  src.connect(g).connect(master(c))
  src.start(t0)
}

// Soft mallet tone for the musical motifs. Quieter than before on purpose.
function tone(freq: number, dur: number, gain: number, delay = 0) {
  const c = ac()
  if (!c) return
  const t0 = c.currentTime + delay
  const osc = c.createOscillator()
  const g = c.createGain()
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 2200
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(freq, t0)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(lp).connect(g).connect(master(c))
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

export type SoundName =
  | 'move'
  | 'capture'
  | 'check'
  | 'castle'
  | 'promote'
  | 'gameEnd'
  | 'win'
  | 'lose'
  | 'correct'
  | 'wrong'
  | 'click'
  | 'notify'

export function playSound(name: SoundName, enabled: boolean) {
  if (!enabled) return
  try {
    switch (name) {
      case 'move':
        void load('Move').then((b) => {
          if (b) playBuffer(b, 0.9)
          else clickSynth(0.25)
        })
        break
      case 'capture':
        void load('Capture').then((b) => {
          if (b) playBuffer(b, 0.8)
          else {
            clickSynth(0.3)
            clickSynth(0.12, 0.05)
          }
        })
        break
      case 'castle':
        // two quick wooden taps, king then rook, exactly like the real thing
        void load('Move').then((b) => {
          if (b) {
            playBuffer(b, 0.85)
            playBuffer(b, 0.8, 0.1)
          } else {
            clickSynth(0.24)
            clickSynth(0.22, 0.1)
          }
        })
        break
      case 'check':
        // the move itself plus a small wooden ping on top, never a siren
        void load('Move').then((b) => {
          if (b) playBuffer(b, 0.9)
          else clickSynth(0.25)
        })
        tone(1180, 0.09, 0.06, 0.02)
        break
      case 'promote':
        void load('Confirmation').then((b) => {
          if (b) playBuffer(b, 0.6)
        })
        clickSynth(0.2)
        break
      case 'correct':
        void load('Confirmation').then((b) => {
          if (b) playBuffer(b, 0.7)
          else {
            tone(560, 0.1, 0.1)
            tone(840, 0.16, 0.1, 0.09)
          }
        })
        break
      case 'wrong':
        // a dull, short "hmm" thud. Quiet on purpose: a miss is a normal part
        // of learning, and the sound should not punish the ear.
        tone(196, 0.12, 0.09)
        tone(147, 0.14, 0.07, 0.06)
        break
      case 'notify':
        void load('GenericNotify').then((b) => {
          if (b) playBuffer(b, 0.45)
        })
        break
      case 'click':
        void load('Select').then((b) => {
          if (b) playBuffer(b, 0.3)
          else clickSynth(0.08)
        })
        break
      case 'gameEnd':
        tone(494, 0.14, 0.08)
        tone(587, 0.14, 0.08, 0.12)
        tone(740, 0.22, 0.08, 0.24)
        break
      case 'win':
        tone(523, 0.12, 0.09)
        tone(659, 0.12, 0.09, 0.1)
        tone(784, 0.12, 0.09, 0.2)
        tone(1047, 0.26, 0.09, 0.3)
        break
      case 'lose':
        tone(392, 0.18, 0.08)
        tone(311, 0.26, 0.08, 0.15)
        break
    }
  } catch {
    // audio is a nicety, never a failure
  }
}
