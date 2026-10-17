'use client'

/**
 * Chessigma-style board editor: paint pieces onto an 8x8 grid with the mouse,
 * tune side-to-move / castling / en-passant / move counters, and hand the
 * resulting FEN to play (vs bot) or analysis. Pure divs — this is a position
 * SETUP tool, not the legal-move ChessBoard.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { Check, Copy, Eraser, LineChart, Play } from 'lucide-react'
import { boardColors } from '@/lib/chess/board-themes'
import { useApp } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
type PieceLetter = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K' | 'p' | 'n' | 'b' | 'r' | 'q' | 'k'
type Color = 'w' | 'b'
type Tool = { kind: 'piece'; letter: PieceLetter } | { kind: 'eraser' } | null
type DragPayload = { kind: 'place'; letter: PieceLetter } | { kind: 'move'; from: string } | null

/** FEN letters, display order per color. */
const PIECE_ORDER: PieceLetter[] = ['K', 'Q', 'R', 'B', 'N', 'P']
const PIECE_NAMES: Record<PieceLetter, string> = {
  K: 'white king', Q: 'white queen', R: 'white rook', B: 'white bishop', N: 'white knight', P: 'white pawn',
  k: 'black king', q: 'black queen', r: 'black rook', b: 'black bishop', n: 'black knight', p: 'black pawn',
}
const CASTLE_LABELS: Record<'K' | 'Q' | 'k' | 'q', string> = {
  K: 'White O-O', Q: 'White O-O-O', k: 'Black O-O', q: 'Black O-O-O',
}
const START_PLACEMENT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'
const DEFAULT_FEN = `${START_PLACEMENT} w KQkq - 0 1`
const MICRO = 'text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground'

function letterOf(piece: { type: string; color: Color }): PieceLetter {
  return (piece.color === 'w' ? piece.type.toUpperCase() : piece.type.toLowerCase()) as PieceLetter
}

function imgName(letter: PieceLetter): string {
  return `${letter === letter.toUpperCase() ? 'w' : 'b'}${letter.toUpperCase()}`
}

function parsePlacement(placement: string): Record<string, PieceLetter> {
  const out: Record<string, PieceLetter> = {}
  placement.split('/').forEach((row, i) => {
    let file = 0
    for (const ch of row) {
      if (/\d/.test(ch)) {
        file += Number(ch)
        continue
      }
      out[`${FILES[file]}${8 - i}`] = ch as PieceLetter
      file += 1
    }
  })
  return out
}

interface EditorState {
  pieces: Record<string, PieceLetter>
  turn: Color
  castling: string
  ep: string | null
  halfmove: number
  fullmove: number
}

/** Parse a FEN into editor state; null when the FEN is not chess.js-legal. */
function editorStateFromFen(fen: string | null | undefined): EditorState | null {
  const trimmed = fen?.trim()
  if (!trimmed) return null
  let g: Chess
  try {
    g = new Chess(trimmed)
  } catch {
    return null
  }
  const pieces: Record<string, PieceLetter> = {}
  for (const row of g.board()) {
    for (const sq of row) {
      if (sq) pieces[sq.square] = letterOf(sq)
    }
  }
  const parts = trimmed.split(/\s+/)
  const castling = (parts[2] ?? '-')
    .split('')
    .filter((c) => 'KQkq'.includes(c))
    .join('')
  return {
    pieces,
    turn: g.turn(),
    castling,
    ep: parts[3] && parts[3] !== '-' ? parts[3] : null,
    halfmove: Number.parseInt(parts[4] ?? '0', 10) || 0,
    fullmove: Number.parseInt(parts[5] ?? '1', 10) || 1,
  }
}

/** A castling right survives only while its king and rook sit on their home squares. */
function castlingAvailability(pieces: Record<string, PieceLetter>): Record<'K' | 'Q' | 'k' | 'q', boolean> {
  return {
    K: pieces.e1 === 'K' && pieces.h1 === 'R',
    Q: pieces.e1 === 'K' && pieces.a1 === 'R',
    k: pieces.e8 === 'k' && pieces.h8 === 'r',
    q: pieces.e8 === 'k' && pieces.a8 === 'r',
  }
}

function buildFen(state: EditorState, castling: string, ep: string | null): string {
  const rows: string[] = []
  for (let rank = 8; rank >= 1; rank--) {
    let row = ''
    let empty = 0
    for (const file of FILES) {
      const p = state.pieces[`${file}${rank}`]
      if (!p) {
        empty += 1
        continue
      }
      if (empty) {
        row += String(empty)
        empty = 0
      }
      row += p
    }
    if (empty) row += String(empty)
    rows.push(row)
  }
  return `${rows.join('/')} ${state.turn} ${castling || '-'} ${ep ?? '-'} ${Math.max(0, state.halfmove)} ${Math.max(1, state.fullmove)}`
}

export interface BoardEditorProps {
  /** FEN adopted when the editor mounts (tab switches remount it, so pasted
   * or preset FENs are picked up then). Ignored afterwards while mounted. */
  initialFen?: string
  /** Start a bot game from the current position. */
  onPlayVsBot: (fen: string) => void
  /** Open the current position in the analysis view. */
  onAnalyze: (fen: string) => void
  /** Reports the live FEN upward so parents can share one source of truth. */
  onFenChange?: (fen: string) => void
}

type Verdict = { ok: true; game: Chess; text: string } | { ok: false; reason: string }

export function BoardEditor({ initialFen, onPlayVsBot, onAnalyze, onFenChange }: BoardEditorProps) {
  const themeName = useApp((s) => s.profile?.theme ?? 'green')
  const { light, dark } = boardColors(themeName)

  const [initialState] = useState(() => editorStateFromFen(initialFen))
  // Mount-only adoption of `initialFen`: the editor unmounts whenever the
  // dialog's tab switches away, so a FEN pasted/preset on the other tab is
  // picked up on the next mount. While mounted, the board is the source of
  // truth and echoes back to the parent through onFenChange.
  const [pieces, setPieces] = useState<Record<string, PieceLetter>>(() => initialState?.pieces ?? parsePlacement(START_PLACEMENT))
  const [turn, setTurn] = useState<Color>(initialState?.turn ?? 'w')
  const [castling, setCastling] = useState(initialState?.castling ?? 'KQkq')
  const [ep, setEp] = useState<string | null>(initialState?.ep ?? null)
  const [halfmove, setHalfmove] = useState(initialState?.halfmove ?? 0)
  const [fullmove, setFullmove] = useState(initialState?.fullmove ?? 1)
  const [tool, setTool] = useState<Tool>(null)
  const [copied, setCopied] = useState(false)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const dragRef = useRef<DragPayload>(null)

  const avail = useMemo(() => castlingAvailability(pieces), [pieces])
  // Only rights whose king/rook are still home reach the FEN.
  const effectiveCastling = useMemo(
    () =>
      castling
        .split('')
        .filter((c) => avail[c as keyof typeof avail])
        .join(''),
    [castling, avail],
  )

  const state = useMemo<EditorState>(() => ({ pieces, turn, castling, ep, halfmove, fullmove }), [pieces, turn, castling, ep, halfmove, fullmove])
  // A stored en-passant target only reaches the FEN while it is still an empty
  // square on the rank that matches the side to move (rank 6 with White to
  // move, rank 3 with Black) — otherwise the FEN quietly falls back to '-'.
  const activeEp = useMemo(
    () =>
      ep && !pieces[ep] && ((turn === 'w' && ep[1] === '6') || (turn === 'b' && ep[1] === '3')) ? ep : null,
    [ep, pieces, turn],
  )
  const fen = useMemo(() => buildFen(state, effectiveCastling, activeEp), [state, effectiveCastling, activeEp])

  const verdict = useMemo<Verdict>(() => {
    try {
      const g = new Chess(fen)
      const over = g.isCheckmate() ? ' · Checkmate' : g.isStalemate() ? ' · Stalemate' : g.isDraw() ? ' · Draw' : ''
      return { ok: true, game: g, text: `Valid position — ${turn === 'w' ? 'White' : 'Black'} to move${over}` }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : 'That position is not a legal chess position.' }
    }
  }, [fen, turn])
  const canPlay = verdict.ok && !verdict.game.isCheckmate() && !verdict.game.isStalemate() && !verdict.game.isDraw()

  // Report the live FEN upward (skip the very first render so an untouched
  // editor does not clobber a parent field the user may have left empty).
  const firstReportRef = useRef(true)
  useEffect(() => {
    if (firstReportRef.current) {
      firstReportRef.current = false
      return
    }
    onFenChange?.(fen)
  }, [fen, onFenChange])

  const applyFen = useCallback((value: string) => {
    const next = editorStateFromFen(value)
    if (!next) return
    setPieces(next.pieces)
    setTurn(next.turn)
    setCastling(next.castling)
    setEp(next.ep)
    setHalfmove(next.halfmove)
    setFullmove(next.fullmove)
  }, [])

  const clearBoard = useCallback(() => {
    setPieces({})
    setTurn('w')
    setCastling('')
    setEp(null)
    setHalfmove(0)
    setFullmove(1)
  }, [])

  const clearSquare = useCallback((sq: string) => {
    setPieces((prev) => {
      if (!prev[sq]) return prev
      const next = { ...prev }
      delete next[sq]
      return next
    })
  }, [])

  const placeAt = useCallback((sq: string, letter: PieceLetter) => {
    setPieces((prev) => ({ ...prev, [sq]: letter }))
  }, [])

  const movePiece = useCallback((from: string, to: string) => {
    setPieces((prev) => {
      const piece = prev[from]
      if (!piece) return prev
      const next = { ...prev }
      delete next[from]
      next[to] = piece
      return next
    })
  }, [])

  const clickSquare = useCallback(
    (sq: string) => {
      if (!tool) return
      if (tool.kind === 'eraser') {
        clearSquare(sq)
        return
      }
      setPieces((prev) => {
        const next = { ...prev }
        if (prev[sq] === tool.letter) delete next[sq]
        else next[sq] = tool.letter
        return next
      })
    },
    [tool, clearSquare],
  )

  const copyFen = useCallback(() => {
    void navigator.clipboard
      ?.writeText(fen)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      })
      .catch(() => {
        /* clipboard blocked: the FEN field is still selectable */
      })
  }, [fen])

  const epRank = turn === 'w' ? 6 : 3
  const epOptions = useMemo(() => FILES.map((f) => `${f}${epRank}`).filter((s) => !pieces[s]), [epRank, pieces])

  const pieceButton = (letter: PieceLetter) => {
    const selected = tool?.kind === 'piece' && tool.letter === letter
    return (
      <button
        key={letter}
        type="button"
        draggable
        onDragStart={(e) => {
          dragRef.current = { kind: 'place', letter }
          e.dataTransfer.setData('text/plain', `place:${letter}`)
          e.dataTransfer.effectAllowed = 'copy'
        }}
        onDragEnd={() => {
          dragRef.current = null
          setDragOver(null)
        }}
        onClick={() => setTool((t) => (t?.kind === 'piece' && t.letter === letter ? null : { kind: 'piece', letter }))}
        aria-pressed={selected}
        aria-label={`Select ${PIECE_NAMES[letter]}`}
        title={PIECE_NAMES[letter]}
        className={cn(
          'grid h-11 w-11 place-items-center rounded-md border transition-transform active:scale-95',
          selected ? 'border-primary bg-accent ring-2 ring-primary' : 'border-border bg-secondary/70 hover:bg-accent',
        )}
      >
        <img src={`/pieces/${imgName(letter)}.svg`} alt="" draggable={false} className="h-8 w-8" />
      </button>
    )
  }

  const eraserSelected = tool?.kind === 'eraser'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={MICRO}>Draw the position</span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => applyFen(DEFAULT_FEN)}
            className="min-h-9 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold transition hover:bg-accent active:scale-95"
          >
            Start position
          </button>
          <button
            type="button"
            onClick={clearBoard}
            className="min-h-9 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold transition hover:bg-accent active:scale-95"
          >
            Empty board
          </button>
        </div>
      </div>

      {/* the 8x8 editor grid */}
      <div
        className="grid aspect-square w-full grid-cols-8 grid-rows-8 overflow-hidden rounded-md shadow-sm"
        role="group"
        aria-label="Board editor: click to place the selected piece, right-click to clear a square"
      >
        {Array.from({ length: 8 }, (_, r) =>
          FILES.map((file, f) => {
            const rank = 8 - r
            const sq = `${file}${rank}`
            const isLight = (f + rank) % 2 === 0
            const letter = pieces[sq]
            return (
              <button
                key={sq}
                type="button"
                onClick={() => clickSquare(sq)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  clearSquare(sq)
                }}
                draggable={Boolean(letter)}
                onDragStart={(e) => {
                  if (!letter) {
                    e.preventDefault()
                    return
                  }
                  dragRef.current = { kind: 'move', from: sq }
                  e.dataTransfer.setData('text/plain', `move:${sq}`)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragEnd={() => {
                  dragRef.current = null
                  setDragOver(null)
                }}
                onDragOver={(e) => {
                  if (!dragRef.current) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = dragRef.current.kind === 'move' ? 'move' : 'copy'
                }}
                onDragEnter={() => {
                  if (dragRef.current) setDragOver(sq)
                }}
                onDragLeave={() => setDragOver((cur) => (cur === sq ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault()
                  const payload = dragRef.current
                  dragRef.current = null
                  setDragOver(null)
                  if (!payload) return
                  if (payload.kind === 'place') placeAt(sq, payload.letter)
                  else if (payload.from !== sq) movePiece(payload.from, sq)
                }}
                aria-label={`${sq}, ${letter ? PIECE_NAMES[letter] : 'empty'}`}
                className="relative flex items-center justify-center"
                style={{ backgroundColor: isLight ? light : dark }}
              >
                {letter && <img src={`/pieces/${imgName(letter)}.svg`} alt="" draggable={false} className="piece-img h-[86%] w-[86%] select-none" />}
                {f === 0 && (
                  <span className={cn('absolute left-0.5 top-0.5 text-[9px] font-bold leading-none sm:text-[10px]', isLight ? 'text-black/35' : 'text-white/45')}>
                    {rank}
                  </span>
                )}
                {rank === 1 && (
                  <span className={cn('absolute bottom-0.5 right-0.5 text-[9px] font-bold leading-none sm:text-[10px]', isLight ? 'text-black/35' : 'text-white/45')}>
                    {file}
                  </span>
                )}
                {dragOver === sq && <span className="pointer-events-none absolute inset-0 border-2 border-primary" aria-hidden="true" />}
              </button>
            )
          }),
        )}
      </div>

      {/* piece palette */}
      <div>
        <span className={MICRO}>Palette</span>
        <div className="mt-1.5 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1">
            <span className="w-11 shrink-0 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">White</span>
            {PIECE_ORDER.map((l) => pieceButton(l))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="w-11 shrink-0 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Black</span>
            {PIECE_ORDER.map((l) => pieceButton(l.toLowerCase() as PieceLetter))}
            <span className="mx-1 h-8 w-px shrink-0 bg-border" aria-hidden="true" />
            <button
              type="button"
              onClick={() => setTool((t) => (t?.kind === 'eraser' ? null : { kind: 'eraser' }))}
              aria-pressed={eraserSelected}
              aria-label="Eraser — click squares to clear them"
              title="Eraser"
              className={cn(
                'grid h-11 w-11 place-items-center rounded-md border transition-transform active:scale-95',
                eraserSelected ? 'border-primary bg-accent ring-2 ring-primary' : 'border-border bg-secondary/70 hover:bg-accent',
              )}
            >
              <Eraser className="h-5 w-5" />
            </button>
          </div>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          Pick a piece, then click squares to place it — click the same piece again to lift it. Right-click or the eraser clears; drag pieces to move them.
        </p>
      </div>

      {/* position metadata */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className={MICRO}>Side to move</span>
          <div className="mt-1.5 flex rounded-md border p-0.5" role="radiogroup" aria-label="Side to move">
            {(['w', 'b'] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={turn === c}
                onClick={() => setTurn(c)}
                className={cn(
                  'min-h-9 flex-1 rounded px-2 py-1.5 text-sm font-semibold transition',
                  turn === c ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                )}
              >
                {c === 'w' ? 'White' : 'Black'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className={MICRO}>En passant target</span>
          <Select
            value={activeEp ?? 'none'}
            onValueChange={(v) => setEp(v === 'none' ? null : v)}
          >
            <SelectTrigger className="mt-1.5 min-h-11" aria-label="En passant target square">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value="none">None</SelectItem>
              {epOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2">
          <span className={MICRO}>Castling rights</span>
          <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            {(['K', 'Q', 'k', 'q'] as const).map((c) => {
              const enabled = avail[c]
              return (
                <label key={c} className={cn('flex min-h-11 items-center gap-2 text-sm', !enabled && 'cursor-not-allowed opacity-50')}>
                  <Checkbox
                    checked={castling.includes(c) && enabled}
                    disabled={!enabled}
                    onCheckedChange={(v) =>
                      setCastling((prev) => {
                        const raw = prev.includes(c) ? prev.replace(c, '') : prev + c
                        // keep the FEN field in canonical KQkq order
                        return (['K', 'Q', 'k', 'q'] as const).filter((x) => raw.includes(x)).join('')
                      })
                    }
                    aria-label={`Castling right ${CASTLE_LABELS[c]}`}
                  />
                  <span className="font-mono text-sm font-bold">{c}</span>
                  <span className="text-xs text-muted-foreground">{CASTLE_LABELS[c]}</span>
                </label>
              )
            })}
          </div>
        </div>
        <div>
          <label htmlFor="editor-halfmove" className={MICRO}>Halfmove clock</label>
          <Input
            id="editor-halfmove"
            type="number"
            min={0}
            value={halfmove}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10)
              setHalfmove(Number.isFinite(n) && n >= 0 ? n : 0)
            }}
            className="mt-1.5"
          />
        </div>
        <div>
          <label htmlFor="editor-fullmove" className={MICRO}>Fullmove number</label>
          <Input
            id="editor-fullmove"
            type="number"
            min={1}
            value={fullmove}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10)
              setFullmove(Number.isFinite(n) && n >= 1 ? n : 1)
            }}
            className="mt-1.5"
          />
        </div>
      </div>

      {/* live FEN output */}
      <div>
        <span className={MICRO}>FEN</span>
        <div className="mt-1.5 flex gap-2">
          <Input
            readOnly
            value={fen}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 font-mono text-xs"
            aria-label="Generated FEN"
          />
          <Button type="button" variant="secondary" onClick={copyFen} className="min-h-11 shrink-0 px-3">
            {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        {verdict.ok ? (
          <p className="mt-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">{verdict.text}</p>
        ) : (
          <p className="mt-1.5 text-xs font-semibold text-destructive" role="alert">
            {verdict.reason}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!canPlay} onClick={() => onPlayVsBot(fen)} className="min-h-11 flex-1 sm:flex-none">
          <Play className="mr-2 h-4 w-4" /> Play vs bot
        </Button>
        <Button type="button" variant="secondary" disabled={!verdict.ok} onClick={() => onAnalyze(fen)} className="min-h-11 flex-1 sm:flex-none">
          <LineChart className="mr-2 h-4 w-4" /> Analyze
        </Button>
      </div>
      {!canPlay && verdict.ok && (
        <p className="-mt-1 text-[11px] text-muted-foreground">The game is already decided here — play is disabled, but you can still analyze or copy the FEN.</p>
      )}
    </div>
  )
}
