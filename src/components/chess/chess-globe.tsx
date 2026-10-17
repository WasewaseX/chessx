'use client'

/**
 * Chess Globe — chessigma-parity live-games visualization for the Home view.
 *
 * Canvas 2D only (the sandbox is memory-constrained — no three.js): an
 * orthographic sphere with a graticule, slowly rotating (one revolution
 * every ~40s, paused while the tab is hidden, while hovered/dragged, or
 * when the OS asks for reduced motion). Each live lichess TV game gets a
 * pin PAIR (white player + black player) at a position hashed from the
 * game id — deliberately NOT real player locations, and the tooltip says
 * so. The two pins are joined by a great-circle arc drawn with animated
 * dashes; segments behind the sphere (z < 0) are clipped.
 *
 * The companion <GlobeSection /> owns the data fetching, the game list and
 * the honest "unreachable" state, so the canvas never renders fake data.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Globe2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { readJson } from '@/lib/api-client'

export interface GlobeGame {
  channel: string
  gameId: string
  white: { name: string; elo: number | null }
  black: { name: string; elo: number | null }
  plies: number
  result: string
}

/* ------------------------------------------------------------------ */
/* geometry                                                            */
/* ------------------------------------------------------------------ */

interface Vec3 {
  x: number
  y: number
  z: number
}

interface Projected {
  sx: number
  sy: number
  z: number
}

/** FNV-1a (same flavor as the puzzle bank) — deterministic pin seed. */
function hashSeed(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Deterministic pseudo-position for a pin. Stable for the same id across
 * renders (and reloads), so arcs never jump. Decorative by design.
 */
function pinFor(id: string): { lat: number; lng: number } {
  const h = hashSeed(id)
  const lat = ((h >>> 8) % 1200) / 1200 * 120 - 60 // -60..60, keep off the poles
  const lng = (h % 3600) / 3600 * 360 - 180
  return { lat, lng }
}

function ll2v(latDeg: number, lngDeg: number): Vec3 {
  const la = (latDeg * Math.PI) / 180
  const lo = (lngDeg * Math.PI) / 180
  return { x: Math.cos(la) * Math.cos(lo), y: Math.sin(la), z: Math.cos(la) * Math.sin(lo) }
}

/** Orthographic projection after a Y-spin and an X-tilt. */
function project(v: Vec3, rotY: number, tilt: number, cx: number, cy: number, r: number): Projected {
  const cy1 = Math.cos(rotY)
  const sy1 = Math.sin(rotY)
  const x1 = v.x * cy1 + v.z * sy1
  const z1 = -v.x * sy1 + v.z * cy1
  const ct = Math.cos(tilt)
  const st = Math.sin(tilt)
  const y2 = v.y * ct - z1 * st
  const z2 = v.y * st + z1 * ct
  return { sx: cx + x1 * r, sy: cy - y2 * r, z: z2 }
}

/** Slerp between two unit vectors (great-circle interpolation). */
function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z
  dot = Math.min(1, Math.max(-1, dot))
  const omega = Math.acos(dot)
  if (omega < 1e-6) return a
  const so = Math.sin(omega)
  const k0 = Math.sin((1 - t) * omega) / so
  const k1 = Math.sin(t * omega) / so
  return { x: a.x * k0 + b.x * k1, y: a.y * k0 + b.y * k1, z: a.z * k0 + b.z * k1 }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/* ------------------------------------------------------------------ */
/* theme-aware palette (CSS vars, hex fallbacks)                       */
/* ------------------------------------------------------------------ */

interface RGB {
  r: number
  g: number
  b: number
}

interface Palette {
  oceanCenter: string
  oceanEdge: string
  shade: number
  grat: string
  gratStrong: string
  rim: string
  accent: RGB
  accentCss: string
  pinWhite: string
  pinWhiteStroke: string
  pinBlack: string
  pinBlackStroke: string
}

function parseHex(v: string | undefined | null): RGB | null {
  if (!v) return null
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  }
}

function rgb(c: RGB, a = 1): string {
  return a >= 1 ? `rgb(${c.r} ${c.g} ${c.b})` : `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`
}

function readVar(el: HTMLElement, name: string): string | undefined {
  try {
    return getComputedStyle(el).getPropertyValue(name).trim() || undefined
  } catch {
    return undefined
  }
}

const WHITE: RGB = { r: 255, g: 255, b: 255 }
const BLACK: RGB = { r: 0, g: 0, b: 0 }

function computePalette(el: HTMLElement): Palette {
  const card = parseHex(readVar(el, '--card')) ?? WHITE
  const dark = card.r * 0.299 + card.g * 0.587 + card.b * 0.114 < 110
  const border = parseHex(readVar(el, '--border')) ?? (dark ? { r: 60, g: 57, b: 54 } : { r: 229, b: 223, g: 227 } as RGB)
  const muted = parseHex(readVar(el, '--muted-foreground')) ??
    (dark ? { r: 163, g: 160, b: 154 } : { r: 121, g: 118, b: 111 })
  const primary = parseHex(readVar(el, '--primary')) ?? { r: 129, g: 182, b: 76 }

  return {
    oceanCenter: rgb(mix(card, WHITE, dark ? 0.08 : 0.42)),
    oceanEdge: rgb(mix(card, BLACK, dark ? 0.52 : 0.26)),
    shade: dark ? 0.5 : 0.18,
    grat: rgb(muted, dark ? 0.26 : 0.3),
    gratStrong: rgb(muted, dark ? 0.4 : 0.45),
    rim: rgb(mix(border, muted, 0.2)),
    accent: primary,
    accentCss: rgb(primary),
    pinWhite: rgb(mix(WHITE, card, 0.04)),
    pinWhiteStroke: rgb(mix(muted, BLACK, 0.3)),
    pinBlack: rgb(mix(card, BLACK, dark ? 0.55 : 0.88)),
    pinBlackStroke: rgb(mix(card, WHITE, dark ? 0.35 : 0.6)),
  }
}

/* ------------------------------------------------------------------ */
/* the canvas globe                                                    */
/* ------------------------------------------------------------------ */

const SPIN_PER_MS = (2 * Math.PI) / 40_000 // one revolution per ~40s
const ARC_SAMPLES = 64
const ARC_HEIGHT = 0.17 // altitude of the arc apex, fraction of R

interface PinHit {
  channel: string
  x: number
  y: number
  z: number
  isWhite: boolean
}

interface Props {
  games: GlobeGame[]
  /** Selected game, keyed by channel (each TV channel features one game). */
  selected: string | null
  onSelect: (channel: string) => void
}

export function ChessGlobe({ games, selected, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 300, h: 300, dpr: 1 })
  const colorsRef = useRef<Palette | null>(null)
  const rafRef = useRef(0)
  const lastFrameRef = useRef(0)
  const phaseRef = useRef(0)

  const stateRef = useRef({
    rotY: 0.6,
    tilt: -0.42,
    velY: 0,
    velT: 0,
    dragging: false,
    hovering: false,
    hidden: false,
    reduced: false,
  })

  const dragRef = useRef({
    active: false,
    id: -1,
    lastX: 0,
    lastY: 0,
    downX: 0,
    downY: 0,
    downT: 0,
    lastMoveT: 0,
    moved: false,
  })

  const [hovered, setHovered] = useState<{ channel: string; x: number; y: number } | null>(null)
  const [wrapSize, setWrapSize] = useState({ w: 300, h: 300 })
  const hoveredRef = useRef<{ channel: string; x: number; y: number } | null>(null)
  const selectedRef = useRef<string | null>(selected)
  const onSelectRef = useRef(onSelect)
  const hitsRef = useRef<PinHit[]>([])

  /** Deterministic pin vectors, recomputed only when the games change. */
  const pinsRef = useRef<{ w: Vec3; b: Vec3 }[]>([])
  const gameListRef = useRef<GlobeGame[]>([])

  useEffect(() => {
    gameListRef.current = games
    pinsRef.current = games.map((g) => {
      const seed = g.gameId || g.channel
      const pw = pinFor(`${seed}:white`)
      const pb = pinFor(`${seed}:black`)
      return { w: ll2v(pw.lat, pw.lng), b: ll2v(pb.lat, pb.lng) }
    })
  }, [games])

  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  useEffect(() => {
    hoveredRef.current = hovered
  }, [hovered])

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  /* size + dpr ------------------------------------------------------ */
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const apply = () => {
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      sizeRef.current = { w, h, dpr }
      setWrapSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  /* theme changes invalidate the palette ----------------------------- */
  useEffect(() => {
    colorsRef.current = null
    const root = document.documentElement
    const mo = new MutationObserver(() => {
      colorsRef.current = null
    })
    mo.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    return () => mo.disconnect()
  }, [])

  /* reduced motion + tab visibility ---------------------------------- */
  useEffect(() => {
    const st = stateRef.current
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMq = () => {
      st.reduced = mq.matches
    }
    onMq()
    mq.addEventListener('change', onMq)
    const onVis = () => {
      st.hidden = document.hidden
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      mq.removeEventListener('change', onMq)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  /* the render loop --------------------------------------------------- */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const graticule = (cx: number, cy: number, r: number, rotY: number, tilt: number, pal: Palette) => {
      const seg = 6 * (Math.PI / 180)
      const drawRun = (pts: Projected[], strong: boolean) => {
        ctx.strokeStyle = strong ? pal.gratStrong : pal.grat
        ctx.lineWidth = 1
        ctx.beginPath()
        let pen = false
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1]
          const b = pts[i]
          if (a.z >= 0 && b.z >= 0) {
            if (!pen) {
              ctx.moveTo(a.sx, a.sy)
              pen = true
            }
            ctx.lineTo(b.sx, b.sy)
          } else {
            pen = false
          }
        }
        ctx.stroke()
      }
      // latitude rings
      for (const latDeg of [-60, -40, -20, 0, 20, 40, 60]) {
        const pts: Projected[] = []
        for (let lng = -180; lng <= 180 + 1e-9; lng += 6) {
          pts.push(project(ll2v(latDeg, lng), rotY, tilt, cx, cy, r))
        }
        drawRun(pts, latDeg === 0)
      }
      // longitude meridians
      for (let lngDeg = -180; lngDeg < 180; lngDeg += 20) {
        const pts: Projected[] = []
        for (let lat = -90; lat <= 90 + 1e-9; lat += 6) {
          pts.push(project(ll2v(lat, lngDeg), rotY, tilt, cx, cy, r))
        }
        drawRun(pts, false)
      }
    }

    const drawArc = (
      a: Vec3,
      b: Vec3,
      cx: number,
      cy: number,
      r: number,
      rotY: number,
      tilt: number,
      pal: Palette,
      isSel: boolean,
      phase: number,
    ) => {
      const pts: Projected[] = []
      for (let i = 0; i <= ARC_SAMPLES; i++) {
        const t = i / ARC_SAMPLES
        const v = slerp(a, b, t)
        const lift = 1 + ARC_HEIGHT * Math.sin(Math.PI * t)
        pts.push(project({ x: v.x * lift, y: v.y * lift, z: v.z * lift }, rotY, tilt, cx, cy, r))
      }
      ctx.strokeStyle = pal.accentCss
      ctx.globalAlpha = isSel ? 1 : 0.5
      ctx.lineWidth = isSel ? 2.6 : 1.6
      if (isSel) {
        ctx.shadowColor = pal.accentCss
        ctx.shadowBlur = 6
      }
      ctx.setLineDash([5, 7])
      ctx.lineDashOffset = -phase
      ctx.beginPath()
      let pen = false
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1]
        const p1 = pts[i]
        if (p0.z >= 0 && p1.z >= 0) {
          if (!pen) {
            ctx.moveTo(p0.sx, p0.sy)
            pen = true
          }
          ctx.lineTo(p1.sx, p1.sy)
        } else {
          pen = false
        }
      }
      ctx.stroke()
      ctx.setLineDash([])
      ctx.shadowBlur = 0
      ctx.globalAlpha = 1
    }

    const drawPin = (
      p: { x: number; y: number; z: number },
      isWhite: boolean,
      isSel: boolean,
      isHover: boolean,
      pal: Palette,
    ) => {
      const front = p.z >= 0
      const base = front ? 4.2 : 2.8
      const radius = isSel || isHover ? base + 1.6 : base
      ctx.globalAlpha = front ? 1 : 0.3
      if (isSel && front) {
        ctx.strokeStyle = pal.accentCss
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(p.x, p.y, radius + 3.5, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.fillStyle = isWhite ? pal.pinWhite : pal.pinBlack
      ctx.strokeStyle = isWhite ? pal.pinWhiteStroke : pal.pinBlackStroke
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    const frame = (now: number) => {
      rafRef.current = requestAnimationFrame(frame)
      const st = stateRef.current
      const dt = clamp(now - lastFrameRef.current, 0, 50)
      lastFrameRef.current = now

      if (!st.hidden && !st.reduced) phaseRef.current = (phaseRef.current + dt * 0.012) % 1_000
      if (!st.dragging && !st.hovering && !st.hidden && !st.reduced) st.rotY -= SPIN_PER_MS * dt
      if (!st.dragging && (Math.abs(st.velY) > 1e-4 || Math.abs(st.velT) > 1e-4)) {
        st.rotY += st.velY * dt
        st.tilt = clamp(st.tilt + st.velT * dt, -1.1, 1.1)
        const decay = Math.pow(0.9, dt / 16.7)
        st.velY *= decay
        st.velT *= decay
      }

      const { w, h, dpr } = sizeRef.current
      if (w < 2 || h < 2) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      if (!colorsRef.current) colorsRef.current = computePalette(canvas)
      const pal = colorsRef.current
      const cx = w / 2
      const cy = h / 2
      const r = (Math.min(w, h) / 2) * 0.88
      const rotY = st.rotY
      const tilt = st.tilt
      const phase = phaseRef.current

      // ocean
      const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.12, cx, cy, r * 1.02)
      grad.addColorStop(0, pal.oceanCenter)
      grad.addColorStop(1, pal.oceanEdge)
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()

      // graticule
      graticule(cx, cy, r, rotY, tilt, pal)

      // day/night shading on the right limb
      const shade = ctx.createRadialGradient(cx + r * 0.55, cy + r * 0.3, r * 0.1, cx + r * 0.25, cy, r * 1.3)
      shade.addColorStop(0, `rgba(0, 0, 0, 0)`)
      shade.addColorStop(1, `rgba(0, 0, 0, ${pal.shade})`)
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.clip()
      ctx.fillStyle = shade
      ctx.fillRect(0, 0, w, h)
      ctx.restore()

      // rim
      ctx.strokeStyle = pal.rim
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()

      // pins + arcs
      const hits: PinHit[] = []
      const pins = pinsRef.current
      const sel = selectedRef.current
      const hov = hoveredRef.current?.channel ?? null

      for (let i = 0; i < pins.length; i++) {
        const pw = project(pins[i].w, rotY, tilt, cx, cy, r * 1.03)
        const pb = project(pins[i].b, rotY, tilt, cx, cy, r * 1.03)
        const game = gameListRef.current[i]
        const isSel = game?.channel === sel
        hits.push({ channel: game?.channel ?? '', x: pw.sx, y: pw.sy, z: pw.z, isWhite: true })
        hits.push({ channel: game?.channel ?? '', x: pb.sx, y: pb.sy, z: pb.z, isWhite: false })
        if (pinsRef.current[i]) drawArc(pins[i].w, pins[i].b, cx, cy, r * 1.03, rotY, tilt, pal, isSel, phase)
      }
      // back-side pins first, arcs already drawn, then front-side pins on top
      for (const hit of hits) if (hit.z < 0) drawPin(hit, hit.isWhite, hit.channel === sel, false, pal)
      for (const hit of hits) {
        if (hit.z >= 0) {
          drawPin(hit, hit.isWhite, hit.channel === sel, hit.channel === hov, pal)
        }
      }
      hitsRef.current = hits
    }

    const start = () => {
      lastFrameRef.current = performance.now()
      rafRef.current = requestAnimationFrame(frame)
    }

    const st = stateRef.current
    start()
    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafRef.current)
      } else if (!st.hidden) {
        start()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(rafRef.current)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  /* hit testing -------------------------------------------------------- */
  const hitTest = (x: number, y: number): string | null => {
    let best: PinHit | null = null
    let bestD = 16
    for (const hit of hitsRef.current) {
      if (hit.z < 0 || !hit.channel) continue
      const d = Math.hypot(hit.x - x, hit.y - y)
      if (d <= bestD) {
        bestD = d
        best = hit
      }
    }
    return best?.channel ?? null
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const d = dragRef.current
    const st = stateRef.current
    d.active = true
    d.id = e.pointerId
    d.lastX = e.clientX
    d.lastY = e.clientY
    d.downX = e.clientX
    d.downY = e.clientY
    d.downT = performance.now()
    d.lastMoveT = d.downT
    d.moved = false
    st.dragging = true
    st.velY = 0
    st.velT = 0
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* pointer capture is best-effort */
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const x = e.nativeEvent.offsetX
    const y = e.nativeEvent.offsetY
    const d = dragRef.current
    const st = stateRef.current

    if (d.active && e.pointerId === d.id) {
      const dx = e.clientX - d.lastX
      const dy = e.clientY - d.lastY
      const now = performance.now()
      const dtMs = Math.max(8, now - d.lastMoveT)
      if (Math.abs(e.clientX - d.downX) + Math.abs(e.clientY - d.downY) > 6) d.moved = true
      const k = 1.15 / Math.max(60, Math.min(sizeRef.current.w, sizeRef.current.h) / 2)
      st.rotY += dx * k
      st.tilt = clamp(st.tilt + dy * k, -1.1, 1.1)
      // capped flick velocity for inertia after release
      st.velY = clamp((dx * k) / dtMs, -0.0025, 0.0025)
      st.velT = clamp((dy * k) / dtMs, -0.0025, 0.0025)
      d.lastX = e.clientX
      d.lastY = e.clientY
      d.lastMoveT = now
    }

    // hover / tooltip (front-side pins only)
    const channel = hitTest(x, y)
    if (channel) {
      const prev = hoveredRef.current
      if (!prev || prev.channel !== channel || Math.abs(prev.x - x) + Math.abs(prev.y - y) > 3) {
        setHovered({ channel, x, y })
      }
    } else if (hoveredRef.current) {
      setHovered(null)
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current
    const st = stateRef.current
    if (!d.active || e.pointerId !== d.id) return
    d.active = false
    st.dragging = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    const dt = performance.now() - d.downT
    if (!d.moved && dt < 600) {
      const channel = hitTest(e.nativeEvent.offsetX, e.nativeEvent.offsetY)
      if (channel) onSelectRef.current(channel)
    } else if (performance.now() - d.lastMoveT > 120) {
      // the pointer rested before release — no flick, drop the inertia
      st.velY = 0
      st.velT = 0
    }
  }

  const hoverGame = useMemo(
    () => (hovered ? games.find((g) => g.channel === hovered.channel) ?? null : null),
    [hovered, games],
  )
  const hoverLeft = hovered && hovered.x > wrapSize.w * 0.55

  return (
    <div ref={wrapRef} className="relative mx-auto aspect-square w-full max-w-md select-none">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Rotating globe with ${games.length} featured live lichess TV games. Drag to spin; click a pin to select a game. The full game list is next to the globe.`}
        className="absolute inset-0 h-full w-full cursor-grab touch-none active:cursor-grabbing"
        style={hovered ? { cursor: 'pointer' } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerEnter={() => {
          stateRef.current.hovering = true
        }}
        onPointerLeave={() => {
          stateRef.current.hovering = false
          setHovered(null)
        }}
      />
      {hoverGame && hovered && (
        <div
          className="pointer-events-none absolute z-10 max-w-60 rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md"
          style={{
            left: clamp(hovered.x, 8, Math.max(8, wrapSize.w - 8)),
            top: clamp(hovered.y - 12, 8, Math.max(8, wrapSize.h - 8)),
            transform: `translate(${hoverLeft ? '-100%' : '0'}, -100%)`,
          }}
          role="tooltip"
        >
          <div className="font-semibold">Featured live game · lichess TV</div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
              {hoverGame.channel}
            </span>
          </div>
          <div className="mt-1">
            <span className="tabular-nums font-semibold">{hoverGame.white.elo ?? '?'}</span> {hoverGame.white.name}
            <span className="mx-1 text-muted-foreground">vs</span>
            {hoverGame.black.name} <span className="tabular-nums font-semibold">{hoverGame.black.elo ?? '?'}</span>
          </div>
          <div className="text-muted-foreground">
            {hoverGame.plies} plies · {hoverGame.result}
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            Pin positions are decorative, not real player locations.
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* the Home section: data + game list                                  */
/* ------------------------------------------------------------------ */

function LiveDot() {
  return (
    <span className="relative inline-flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60 motion-reduce:animate-none" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
    </span>
  )
}

function Eyebrow({ text }: { text: string }) {
  return (
    <span aria-hidden="true" className="block text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground/60">
      {text}
    </span>
  )
}

export function GlobeSection() {
  const [games, setGames] = useState<GlobeGame[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  const load = useCallback(() => {
    fetch('/api/globe/live', { cache: 'no-store' })
      .then((r) => readJson<{ games?: GlobeGame[]; updatedAt?: string }>(r))
      .then((d) => {
        setGames(d.games ?? [])
        setUpdatedAt(d.updatedAt ?? null)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // gentle refresh while the view is open (the API itself caches 20s)
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 30_000)
    const onVis = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const t of timers) clearTimeout(t)
      timers.clear()
    }
  }, [])

  // A selected channel can vanish on refresh (lichess switched games); a
  // stale selection simply matches no row and no pin, so it is harmless —
  // no effect needed to clear it.

  const copyLink = useCallback((g: GlobeGame) => {
    const url = `https://lichess.org/${g.gameId}`
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(g.channel)
        const t = setTimeout(() => {
          setCopied((c) => (c === g.channel ? null : c))
          timersRef.current.delete(t)
        }, 2000)
        timersRef.current.add(t)
      })
      .catch(() => {
        /* clipboard unavailable — the tooltip on the icon still shows the URL */
      })
  }, [])

  const updatedLabel = useMemo(() => {
    if (!updatedAt) return null
    const d = new Date(updatedAt)
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  }, [updatedAt])

  return (
    <section className="rounded-lg bg-card shadow-sm" aria-label="Live chess around the world">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-border px-6 py-3">
        <div>
          <Eyebrow text="05 / Globe" />
          <div className="flex items-center gap-2">
            <Globe2 className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="font-display text-lg font-bold">Live chess around the world</h2>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {status === 'ready' && (
            <span className="inline-flex items-center gap-1.5 font-bold uppercase tracking-wide text-primary">
              <LiveDot /> Live
            </span>
          )}
          {updatedLabel && <span>updated {updatedLabel}</span>}
        </div>
      </div>

      <div className="grid gap-6 px-6 py-6 lg:grid-cols-2">
        {/* the globe always renders — even while loading or on API failure */}
        <ChessGlobe games={games} selected={selected} onSelect={setSelected} />

        <div>
          {status === 'loading' && (
            <div className="space-y-2" role="status" aria-label="Loading live games">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-12 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
              ))}
            </div>
          )}

          {status === 'error' && (
            <div className="flex h-full flex-col items-start justify-center gap-3 rounded-lg border border-border px-4 py-6">
              <p className="text-sm text-muted-foreground">Live games are unreachable right now.</p>
              <Button variant="secondary" size="sm" onClick={load}>
                <RotateCcw className="h-4 w-4" /> Retry
              </Button>
            </div>
          )}

          {status === 'ready' && games.length === 0 && (
            <div className="flex h-full items-center rounded-lg border border-border px-4 py-6 text-sm text-muted-foreground">
              No featured games are streaming right now. Check back soon.
            </div>
          )}

          {status === 'ready' && games.length > 0 && (
            <ul
              role="list"
              className="max-h-96 divide-y divide-border overflow-y-auto rounded-lg border border-border [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar]:w-1.5"
            >
              {games.map((g) => {
                const isSel = selected === g.channel
                return (
                  <li key={g.channel} className={`flex items-center gap-1 px-3 ${isSel ? 'bg-secondary/70' : ''}`}>
                    <button
                      type="button"
                      onClick={() => setSelected(g.channel)}
                      aria-pressed={isSel}
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
                    >
                      <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        {g.channel}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        <span className="font-semibold tabular-nums">{g.white.elo ?? '?'}</span> {g.white.name}
                        <span className="mx-1 text-muted-foreground">vs</span>
                        {g.black.name} <span className="font-semibold tabular-nums">{g.black.elo ?? '?'}</span>
                      </span>
                      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{g.plies} plies</span>
                    </button>
                    <LiveDot />
                    <button
                      type="button"
                      onClick={() => copyLink(g)}
                      aria-label={`Copy link to the ${g.channel} game on lichess.org`}
                      title={copied === g.channel ? 'Copied' : `Copy link · lichess.org/${g.gameId}`}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      {copied === g.channel ? (
                        <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                      ) : (
                        <Copy className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <p className="border-t border-border px-6 py-3 text-xs text-muted-foreground">
        Featured games from lichess TV, refreshed automatically. Pin positions are decorative — hashed from the game id,
        not real player locations. &ldquo;Copy link&rdquo; copies the game&apos;s lichess.org address; the board cannot be
        continued here.
      </p>
    </section>
  )
}
