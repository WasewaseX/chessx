import { NextResponse } from 'next/server'
import { googleConfigured } from '@/lib/google-oauth'

/**
 * One-bit probe so the sign-in screen can show the Google button only when
 * this deployment actually has OAuth credentials. No cookie touching, no
 * side effects — an unconfigured deployment answers { configured: false }
 * and the screen falls back to email as the primary path instead of
 * rendering a button that can only ever fail.
 */
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    { configured: googleConfigured() },
    { headers: { 'cache-control': 'no-store' } },
  )
}
