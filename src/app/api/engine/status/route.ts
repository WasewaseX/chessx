// Engine identity + pool status for the UI (the "Stockfish 19 · NNUE" pill)
// and for honest degradation everywhere. Read-only, no search is triggered.
import { NextResponse } from 'next/server'
import { engineStatus } from '@/lib/server/engine'

export async function GET() {
  const status = await engineStatus()
  return NextResponse.json(status)
}
