// Synthesized sound effects built from wood-acoustics modeling: every board
// sound is a short filtered noise burst (the wood contact) plus a low sine
// thump (the body of the board). No assets, no latency, and nothing harsh.
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

// shared gentle master curve: keeps everything soft and close
function master(c: AudioContext): GainNode {
  const g = c.createGain()
  g.gain.value = 0.9
  const shelf = c.createBiquadFilter()
  shelf.type = 'highshelf'
  shelf.frequency.value = 6000
  shelf.gain.value = -6 // tame the top end, wood is dark
  g.connect(shelf).connect(c.destination)
  return g
}

function thump(freq: number, dur: number, gain: number, delay = 0, out?: GainNode) {
  const c = ac()
  if (!c) return
  const t0 = c.currentTime + delay
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, t0)
  osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.55), t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(out ?? master(c))
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

// wooden contact: band-limited noise with a fast natural decay
function knock(cutLow: number, cutHigh: number, dur: number, gain: number, delay = 0, out?: GainNode) {
  const c = ac()
  if (!c) return
  const t0 = c.currentTime + delay
  const len = Math.floor(c.sampleRate * dur)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) {
    const env = Math.pow(1 - i / len, 2.2)
    data[i] = (Math.random() * 2 - 1) * env
  }
  const src = c.createBufferSource()
  src.buffer = buf
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = (cutLow + cutHigh) / 2
  bp.Q.value = 1.1
  const hp = c.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = cutLow
  const g = c.createGain()
  g.gain.value = gain
  src.connect(bp).connect(hp).connect(g).connect(out ?? master(c))
  src.start(t0)
}

// soft mallet tone for the little musical motifs (correct, win, lose)
function tone(freq: number, dur: number, gain: number, delay = 0, out?: GainNode) {
  const c = ac()
  if (!c) return
  const t0 = c.currentTime + delay
  const osc = c.createOscillator()
  const g = c.createGain()
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 2600
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(freq, t0)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(lp).connect(g).connect(out ?? master(c))
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

export function playSound(name: SoundName, enabled: boolean) {
  if (!enabled) return
  try {
    switch (name) {
      case 'move':
        // piece set down on the board: soft knock + low body
        knock(700, 2400, 0.055, 0.5)
        thump(170, 0.07, 0.22)
        break
      case 'capture':
        // strike and settle: harder knock, tiny double hit
        knock(500, 3000, 0.07, 0.65)
        thump(130, 0.1, 0.34)
        knock(900, 2600, 0.04, 0.22, 0.045)
        break
      case 'castle':
        knock(700, 2400, 0.05, 0.45)
        thump(170, 0.06, 0.2)
        knock(650, 2300, 0.05, 0.4, 0.09)
        thump(160, 0.06, 0.18, 0.09)
        break
      case 'check':
        // alert without shouting: tighter tap, subtle high ping
        knock(1100, 3200, 0.04, 0.4)
        tone(920, 0.12, 0.1, 0.02)
        break
      case 'promote':
        // warm rise, quiet enough to not get old
        tone(523, 0.14, 0.14)
        tone(659, 0.14, 0.14, 0.09)
        tone(784, 0.22, 0.14, 0.18)
        knock(700, 2400, 0.05, 0.3)
        break
      case 'correct':
        tone(587, 0.12, 0.16)
        tone(880, 0.2, 0.16, 0.1)
        break
      case 'wrong':
        // dull low wood thud, no harshness
        thump(120, 0.16, 0.4)
        knock(220, 900, 0.08, 0.28)
        break
      case 'gameEnd':
        tone(494, 0.16, 0.13)
        tone(587, 0.16, 0.13, 0.12)
        tone(740, 0.26, 0.13, 0.24)
        break
      case 'win':
        tone(523, 0.14, 0.15)
        tone(659, 0.14, 0.15, 0.11)
        tone(784, 0.14, 0.15, 0.22)
        tone(1047, 0.3, 0.15, 0.33)
        break
      case 'lose':
        tone(392, 0.2, 0.14)
        tone(311, 0.3, 0.14, 0.16)
        thump(110, 0.24, 0.2, 0.3)
        break
      case 'click':
        knock(1400, 3600, 0.02, 0.12)
        break
    }
  } catch {
    // audio is a nicety, never a failure
  }
}
