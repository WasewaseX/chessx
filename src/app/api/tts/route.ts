import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

const VALID_VOICES = new Set(['tongtong', 'chuichui', 'xiaochen', 'jam', 'kazi', 'douji', 'luodo'])

// Coach lines are spoken on demand. Keep the payload small and cache-friendly:
// same text + voice within a session is served from the client cache, and the
// route itself only exists because the SDK must run server-side.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 1000) : ''
  if (!text) {
    return NextResponse.json({ error: 'text required' }, { status: 400 })
  }
  const voice = VALID_VOICES.has(body.voice) ? body.voice : 'tongtong'
  const speedRaw = Number(body.speed)
  const speed = Number.isFinite(speedRaw) ? Math.min(2, Math.max(0.5, speedRaw)) : 1

  try {
    const { default: ZAI } = await import('z-ai-web-dev-sdk')
    const zai = await ZAI.create()
    const response = await zai.audio.tts.create({
      input: text,
      voice,
      speed,
      response_format: 'wav',
      stream: false,
    })
    const arrayBuffer = await response.arrayBuffer()
    return new NextResponse(Buffer.from(new Uint8Array(arrayBuffer)), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
