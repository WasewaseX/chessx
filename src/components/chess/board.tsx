'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { boardColors } from '@/lib/chess/board-themes'
import { cn } from '@/lib/utils'

export interface Arrow {
  from: string
  to: string
  color?: 'green' | 'red' | 'orange' | 'gray'
}

export interface Mark {
  square: string
  color?: 'green' | 'red' | 'yellow' | 'gray'
}

export interface BoardProps {
  fen: string
  orientation?: 'w' | 'b'
  onMove?: (from: Square, to: Square, promotion?: string) => void
  interactive?: boolean // can the user pick up pieces at all
  movableSide?: 'w' | 'b' | 'both' // whose pieces may be moved
  lastMove?: { from: string; to: string } | null
  checkSquare?: string | null
  marks?: Mark[]
  arrows?: Arrow[]
  showLegal?: boolean
  showCoords?: boolean
  theme?: string
  shake?: boolean // brief shake animation (wrong answer feedback)
  className?: string
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'] as const

const MARK_COLORS: Record<string, string> = {
  green: 'rgba(130, 182, 76, 0.75)',
  red: 'rgba(202, 52, 49, 0.7)',
  yellow: 'rgba(230, 168, 44, 0.75)',
  gray: 'rgba(90, 90, 90, 0.5)',
}

const ARROW_COLORS: Record<string, string> = {
  green: '#82b64c',
  red: '#ca3431',
  orange: '#e6a82c',
  gray: '#5a5a5a',
}

function fileOf(sq: string) {
  return FILES.indexOf(sq[0] as (typeof FILES)[number])
}
function rankOf(sq: string) {
  return RANKS.indexOf(sq[1] as (typeof RANKS)[number])
}

interface PieceData {
  square: string
  color: 'w' | 'b'
  type: string
}

function parseBoard(fen: string): PieceData[] {
  const pieces: PieceData[] = []
  const rows = fen.split(' ')[0].split('/')
  for (let r = 0; r < 8; r++) {
    let f = 0
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) {
        f += parseInt(ch, 10)
        continue
      }
      pieces.push({
        square: `${FILES[f]}${RANKS[r]}`,
        color: ch === ch.toUpperCase() ? 'w' : 'b',
        type: ch.toLowerCase(),
      })
      f++
    }
  }
  return pieces
}

export function ChessBoard({
  fen,
  orientation = 'w',
  onMove,
  interactive = true,
  movableSide = 'both',
  lastMove,
  checkSquare,
  marks = [],
  arrows = [],
  showLegal = true,
  showCoords = true,
  theme = 'green',
  shake = false,
  className,
}: BoardProps) {
  const colors = boardColors(theme)
  const boardRef = useRef<HTMLDivElement>(null)
  const [boardPx, setBoardPx] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ from: string; x: number; y: number; piece: PieceData } | null>(null)
  const [hoverSquare, setHoverSquare] = useState<string | null>(null)
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null)
  const [animMove, setAnimMove] = useState<{ from: string; to: string } | null>(lastMove ?? null)

  const game = useMemo(() => {
    try {
      return new Chess(fen)
    } catch {
      return new Chess()
    }
  }, [fen])

  const pieces = useMemo(() => parseBoard(fen), [fen])

  const canMovePiece = useCallback(
    (color: 'w' | 'b') => {
      if (!interactive) return false
      return movableSide === 'both' || movableSide === color
    },
    [interactive, movableSide],
  )

  const legalTargets = useMemo(() => {
    if (!selected && !drag) return new Map<string, boolean>()
    const from = (selected ?? drag?.from) as Square
    const map = new Map<string, boolean>()
    if (!from) return map
    try {
      for (const m of game.moves({ square: from, verbose: true })) {
        map.set(m.to, Boolean(m.captured))
      }
    } catch {
      /* square had no piece */
    }
    return map
  }, [selected, drag, game])

  useEffect(() => {
    if (!lastMove) return
    setAnimMove(lastMove)
  }, [lastMove])

  useEffect(() => {
    setSelected(null)
    setPromotion(null)
  }, [fen])

  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    const update = () => setBoardPx(el.getBoundingClientRect().width)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const squareFromPoint = useCallback(
    (clientX: number, clientY: number): string | null => {
      const el = boardRef.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      const x = (clientX - rect.left) / rect.width
      const y = (clientY - rect.top) / rect.height
      if (x < 0 || x > 1 || y < 0 || y > 1) return null
      const col = Math.min(7, Math.max(0, Math.floor(x * 8)))
      const row = Math.min(7, Math.max(0, Math.floor(y * 8)))
      const file = orientation === 'w' ? FILES[col] : FILES[7 - col]
      const rank = orientation === 'w' ? RANKS[row] : RANKS[7 - row]
      return `${file}${rank}`
    },
    [orientation],
  )

  const tryMove = useCallback(
    (from: string, to: string) => {
      if (from === to) return
      const piece = game.get(from as Square)
      if (piece && piece.type === 'p' && (rankOf(to) === 0 || rankOf(to) === 7)) {
        // needs promotion choice
        setPromotion({ from, to })
        return
      }
      onMove?.(from as Square, to as Square)
    },
    [game, onMove],
  )

  const onSquarePointerDown = useCallback(
    (e: React.PointerEvent, square: string) => {
      if (promotion) return
      const piece = game.get(square as Square)
      if (selected && legalTargets.has(square)) {
        tryMove(selected, square)
        setSelected(null)
        return
      }
      if (piece && canMovePiece(piece.color) && game.turn() === piece.color) {
        const rect = boardRef.current?.getBoundingClientRect()
        if (!rect) return
        setDrag({ from: square, x: e.clientX, y: e.clientY, piece: { square, color: piece.color, type: piece.type } })
        setSelected(square)
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
      } else {
        setSelected(null)
      }
    },
    [game, selected, legalTargets, canMovePiece, tryMove, promotion],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d))
      const sq = squareFromPoint(e.clientX, e.clientY)
      setHoverSquare(sq)
    },
    [drag, squareFromPoint],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return
      const target = squareFromPoint(e.clientX, e.clientY)
      const from = drag.from
      setDrag(null)
      setHoverSquare(null)
      if (target && target !== from && legalTargets.has(target)) {
        tryMove(from, target)
        setSelected(null)
      }
      // if released on origin square: keep selection (click-to-move mode)
    },
    [drag, squareFromPoint, legalTargets, tryMove],
  )

  // keyboard support: arrows for accessibility are handled by views; board is pointer-first
  const squares: { square: string; light: boolean; col: number; row: number }[] = []
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const file = orientation === 'w' ? FILES[col] : FILES[7 - col]
      const rank = orientation === 'w' ? RANKS[row] : RANKS[7 - row]
      const square = `${file}${rank}`
      squares.push({ square, light: (fileOf(square) + rankOf(square)) % 2 === 1, col, row })
    }
  }

  const markMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const mk of marks) m.set(mk.square, MARK_COLORS[mk.color ?? 'green'])
    return m
  }, [marks])

  const squarePercent = (sq: string) => ({
    left: `${(orientation === 'w' ? fileOf(sq) : 7 - fileOf(sq)) * 12.5}%`,
    top: `${(orientation === 'w' ? rankOf(sq) : 7 - rankOf(sq)) * 12.5}%`,
  })

  const animDelta = (from: string, to: string) => {
    const dx = fileOf(from) - fileOf(to)
    const dy = rankOf(from) - rankOf(to)
    const fx = orientation === 'w' ? dx : -dx
    const fy = orientation === 'w' ? dy : -dy
    return { x: fx * 100, y: fy * 100 }
  }

  return (
    <div
      className={cn('relative aspect-square w-full select-none overflow-hidden rounded-md', shake && 'animate-shake', className)}
      style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.25)' }}
    >
      <div
        ref={boardRef}
        className="absolute inset-0 touch-none"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          setDrag(null)
          setHoverSquare(null)
        }}
      >
        {/* squares */}
        {squares.map(({ square, light, col, row }) => {
          const isLast = lastMove && (lastMove.from === square || lastMove.to === square)
          const markColor = markMap.get(square)
          return (
            <div
              key={square}
              data-square={square}
              className="absolute"
              style={{
                left: `${col * 12.5}%`,
                top: `${row * 12.5}%`,
                width: '12.5%',
                height: '12.5%',
                background: light ? colors.light : colors.dark,
              }}
              onPointerDown={(e) => onSquarePointerDown(e, square)}
            >
              {isLast && <div className="absolute inset-0" style={{ background: 'rgba(230, 168, 44, 0.42)' }} />}
              {checkSquare === square && (
                <div
                  className="absolute inset-0"
                  style={{
                    background: 'radial-gradient(circle, rgba(224,60,49,0.95) 15%, rgba(224,60,49,0.5) 55%, transparent 75%)',
                  }}
                />
              )}
              {markColor && <div className="absolute inset-0" style={{ background: markColor }} />}
              {hoverSquare === square && drag && drag.from !== square && (
                <div className="absolute inset-0" style={{ background: 'rgba(255,255,255,0.28)' }} />
              )}
              {showCoords && col === 0 && (
                <span
                  className={cn('absolute left-0.5 top-0 text-[min(1.6vw,11px)] font-bold', light ? 'opacity-80' : 'opacity-90')}
                  style={{ color: light ? colors.dark : colors.light }}
                >
                  {square[1]}
                </span>
              )}
              {showCoords && row === 7 && (
                <span
                  className={cn('absolute bottom-0 right-0.5 text-[min(1.6vw,11px)] font-bold', light ? 'opacity-80' : 'opacity-90')}
                  style={{ color: light ? colors.dark : colors.light }}
                >
                  {square[0]}
                </span>
              )}
            </div>
          )
        })}

        {/* legal move indicators */}
        {showLegal &&
          [...legalTargets.entries()].map(([sq, isCapture]) =>
            sq === hoverSquare && drag ? null : (
              <div key={`dot-${sq}`} className="pointer-events-none absolute z-10" style={{ ...squarePercent(sq), width: '12.5%', height: '12.5%' }}>
                {isCapture ? (
                  <div className="absolute inset-[6%] rounded-full" style={{ border: 'calc(min(4vw, 26px) / 3) solid rgba(0,0,0,0.16)' }} />
                ) : (
                  <div className="absolute inset-[38%] rounded-full bg-black/15" />
                )}
              </div>
            ),
          )}

        {/* pieces */}
        {pieces.map((p) => {
          const isDragged = drag?.from === p.square
          const anim = animMove?.to === p.square && animMove?.from !== p.square ? animMove : null
          const delta = anim ? animDelta(anim.from, anim.to) : null
          return (
            <div
              key={`${p.square}-${p.color}${p.type}`}
              className="pointer-events-none absolute z-20"
              style={{
                ...squarePercent(p.square),
                width: '12.5%',
                height: '12.5%',
                opacity: isDragged ? 0.25 : 1,
                transform: delta ? `translate(${delta.x}%, ${delta.y}%)` : undefined,
                transition: delta ? 'transform 0.16s ease' : undefined,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/pieces/${p.color}${p.type.toUpperCase()}.svg`}
                alt=""
                className="piece-img h-full w-full"
                draggable={false}
              />
            </div>
          )
        })}

        {/* dragged piece follows cursor */}
        {drag && boardPx > 0 && (
          <div
            className="pointer-events-none fixed z-50"
            style={{
              left: drag.x,
              top: drag.y,
              width: `${boardPx / 8}px`,
              height: `${boardPx / 8}px`,
              transform: 'translate(-50%, -50%) scale(1.1)',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/pieces/${drag.piece.color}${drag.piece.type.toUpperCase()}.svg`} alt="" className="h-full w-full drop-shadow-lg" draggable={false} />
          </div>
        )}

        {/* arrows */}
        {arrows.length > 0 && (
          <svg className="pointer-events-none absolute inset-0 z-30" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              {Object.entries(ARROW_COLORS).map(([k, c]) => (
                <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="7.5" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
                  <path d="M 0 1 L 8 5 L 0 9 z" fill={c} />
                </marker>
              ))}
            </defs>
            {arrows.map((a, i) => {
              const x1 = (orientation === 'w' ? fileOf(a.from) : 7 - fileOf(a.from)) * 12.5 + 6.25
              const y1 = (orientation === 'w' ? rankOf(a.from) : 7 - rankOf(a.from)) * 12.5 + 6.25
              const x2 = (orientation === 'w' ? fileOf(a.to) : 7 - fileOf(a.to)) * 12.5 + 6.25
              const y2 = (orientation === 'w' ? rankOf(a.to) : 7 - rankOf(a.to)) * 12.5 + 6.25
              const dx = x2 - x1
              const dy = y2 - y1
              const len = Math.sqrt(dx * dx + dy * dy)
              const shrink = 3.4 // pull arrowhead inside the target square
              const ex = x2 - (dx / len) * shrink
              const ey = y2 - (dy / len) * shrink
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={ex}
                  y2={ey}
                  stroke={ARROW_COLORS[a.color ?? 'green']}
                  strokeWidth="2.2"
                  opacity="0.85"
                  markerEnd={`url(#arrow-${a.color ?? 'green'})`}
                />
              )
            })}
          </svg>
        )}

        {/* promotion picker */}
        {promotion && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60" onPointerDown={(e) => e.stopPropagation()}>
            <div className="rounded-lg bg-background p-3 shadow-xl">
              <div className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">Promote to</div>
              <div className="flex gap-2">
                {['q', 'r', 'b', 'n'].map((t) => {
                  const color = game.get(promotion.from as Square)?.color ?? 'w'
                  return (
                    <button
                      key={t}
                      className="rounded-md bg-secondary p-1 transition hover:bg-accent"
                      aria-label={`Promote to ${t}`}
                      onClick={() => {
                        const { from, to } = promotion
                        setPromotion(null)
                        setSelected(null)
                        onMove?.(from as Square, to as Square, t)
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/pieces/${color}${t.toUpperCase()}.svg`} alt={t} className="h-12 w-12" draggable={false} />
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
