// Small synthesized sounds (WebAudio) — no assets, always instant.
let ctx: AudioContext | null = null

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tap(freq: number, dur: number, gain: number, delay = 0, type: OscillatorType = 'sine') {
  const c = ac()
  if (!c) return
  const t0 = c.currentTime + delay
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), t0 + dur)
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

function noise(dur: number, gain: number, delay = 0, filterFreq = 2000) {
  const c = ac()
  if (!c) return
  const t0 = c.currentTime + delay
  const len = Math.floor(c.sampleRate * dur)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = c.createBufferSource()
  src.buffer = buf
  const f = c.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.value = filterFreq
  const g = c.createGain()
  g.gain.value = gain
  src.connect(f).connect(g).connect(c.destination)
  src.start(t0)
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

export function playSound(name: SoundName, enabled: boolean) {
  if (!enabled) return
  try {
    switch (name) {
      case 'move':
        tap(210, 0.09, 0.5)
        noise(0.05, 0.15, 0, 3200)
        break
      case 'capture':
        tap(140, 0.12, 0.6)
        noise(0.09, 0.3, 0, 1800)
        break
      case 'castle':
        tap(210, 0.08, 0.45)
        tap(180, 0.08, 0.45, 0.09)
        break
      case 'check':
        tap(660, 0.07, 0.28, 0, 'triangle')
        tap(880, 0.09, 0.28, 0.09, 'triangle')
        break
      case 'promote':
        tap(440, 0.09, 0.25, 0, 'triangle')
        tap(660, 0.09, 0.25, 0.08, 'triangle')
        tap(880, 0.14, 0.25, 0.16, 'triangle')
        break
      case 'correct':
        tap(520, 0.08, 0.25, 0, 'triangle')
        tap(780, 0.12, 0.25, 0.08, 'triangle')
        break
      case 'wrong':
        tap(220, 0.14, 0.3, 0, 'square')
        tap(160, 0.18, 0.3, 0.1, 'square')
        break
      case 'gameEnd':
        tap(330, 0.16, 0.22, 0, 'triangle')
        tap(415, 0.16, 0.22, 0.12, 'triangle')
        tap(494, 0.22, 0.22, 0.24, 'triangle')
        break
      case 'win':
        tap(523, 0.12, 0.25, 0, 'triangle')
        tap(659, 0.12, 0.25, 0.11, 'triangle')
        tap(784, 0.12, 0.25, 0.22, 'triangle')
        tap(1047, 0.2, 0.25, 0.33, 'triangle')
        break
      case 'lose':
        tap(392, 0.18, 0.25, 0, 'triangle')
        tap(330, 0.18, 0.25, 0.15, 'triangle')
        tap(262, 0.26, 0.25, 0.3, 'triangle')
        break
      case 'click':
        tap(300, 0.04, 0.12, 0, 'triangle')
        break
    }
  } catch {
    // audio is a nicety, never a failure
  }
}
