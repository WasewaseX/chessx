import { NextResponse } from 'next/server'
import { googleConfigured } from '@/lib/google-oauth'

export const dynamic = 'force-dynamic'

/**
 * One-bit capability probe for the auth screen: is Google OAuth wired up on
 * this deployment? The client fetches this once on mount and hides the
 * "Continue with Google" button entirely when the answer is no, instead of
 * letting players click into a dead end and then explaining with a notice.
 */
export async function GET() {
  return NextResponse.json(
    { configured: googleConfigured() },
    { headers: { 'cache-control': 'no-store' } },
  )
}
