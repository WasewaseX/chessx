'use client'

import { io, type Socket } from 'socket.io-client'

// Gateway rule: the game service lives on port 3030 but the browser only
// ever talks to the current origin, with XTransformPort routing it there.
const SOCKET_URL = '/?XTransformPort=3030'

export interface OnlineSeat {
  username: string
  rating: number
  provisional: boolean
}

export interface OnlineGameView {
  id: string
  color: 'w' | 'b'
  initialSec: number
  incSec: number
  pool: string
  white: OnlineSeat
  black: OnlineSeat
  opponent: OnlineSeat
  fen: string
  moves: string[]
  drawOfferBy?: 'w' | 'b' | null
  whiteMs?: number
  blackMs?: number
  turn?: 'w' | 'b'
}

export interface GameStateView {
  id: string
  fen: string
  lastMove: { from: string; to: string } | null
  pgn: string
  moves: string[]
  whiteMs: number
  blackMs: number
  turn: 'w' | 'b'
  white: OnlineSeat
  black: OnlineSeat
  check: boolean
}

export interface GameOverView {
  id: string
  result: '1-0' | '0-1' | '1/2-1/2'
  termination: string
  color: 'w' | 'b'
  myDelta: number | null
  myNewRating: number | null
  rated: boolean
  pgn: string
}

export type AccountRating = { rating: number; rd: number; games: number }

let socket: Socket | null = null
let connecting: Promise<Socket> | null = null

async function mintTicket(): Promise<string> {
  const res = await fetch('/api/auth/ticket', { method: 'POST' })
  if (!res.ok) throw new Error('Not signed in')
  const d = await res.json()
  return d.ticket as string
}

/** Connect and authenticate. Reuses one socket for the whole tab. */
export function connectGameService(): Promise<Socket> {
  if (socket?.connected) return Promise.resolve(socket)
  if (connecting) return connecting

  connecting = new Promise<Socket>((resolve, reject) => {
    const s = io(SOCKET_URL, { transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 800 })
    let timeout: ReturnType<typeof setTimeout> | undefined

    const cleanupFail = () => {
      if (timeout) clearTimeout(timeout)
      connecting = null
    }

    timeout = setTimeout(() => {
      cleanupFail()
      s.close()
      reject(new Error('Game service unreachable'))
    }, 8000)

    s.on('connect', async () => {
      try {
        const ticket = await mintTicket()
        s.emit('auth', { ticket })
      } catch (err) {
        cleanupFail()
        s.close()
        reject(err instanceof Error ? err : new Error('Auth failed'))
      }
    })

    s.on('auth:ok', () => {
      cleanupFail()
      socket = s
      resolve(s)
    })

    s.on('auth:failed', (d: { error?: string }) => {
      cleanupFail()
      s.close()
      reject(new Error(d.error ?? 'Auth failed'))
    })

    s.on('auth:replaced', () => {
      // another tab signed in as this account; this one stops playing
      s.close()
      if (socket === s) socket = null
    })

    s.on('connect_error', () => {
      /* retries handled by socket.io; the timeout above catches total failure */
    })
  })

  return connecting
}

export function getSocket(): Socket | null {
  return socket
}

/** Non-throwing accessor for components that just want the live socket. */
export function getSocketSafe(): Socket | null {
  return socket
}

export function disconnectGameService() {
  socket?.close()
  socket = null
  connecting = null
}
