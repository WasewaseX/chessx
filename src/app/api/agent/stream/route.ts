// SSE stream for a running mission: replays a snapshot on connect, then
// forwards every runtime event until the mission closes. The card also works
// without this route (it polls the snapshot), so a dropped stream never
// breaks a mission; the runtime lives in memory on the server either way.
import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { getTaskView, subscribeTask } from '@/lib/server/agent/runtime'
import type { AgentEvent } from '@/lib/agent-types'

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return new Response('Not signed in', { status: 401 })
  const profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile) return new Response('No profile', { status: 404 })

  const taskId = req.nextUrl.searchParams.get('id') ?? ''
  const task = getTaskView(taskId, profile.id)
  if (!task) return new Response('Mission not found', { status: 404 })

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: AgentEvent) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          closed = true
        }
      }

      // Initial state, then live events.
      send({ type: 'snapshot', task: getTaskView(taskId, profile.id) ?? task })
      const unsubscribe = subscribeTask(taskId, profile.id, send)

      // Heartbeat keeps proxies from eating the stream on quiet stretches.
      const heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          closed = true
        }
      }, 15_000)

      const finish = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        unsubscribe?.()
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      // A task that already finished emits done once and clears subscribers;
      // close on the next tick if nothing else arrives.
      const current = getTaskView(taskId, profile.id)
      if (current && current.status !== 'running') {
        setTimeout(finish, 250)
      }

      const cleanup = () => {
        closed = true
        clearInterval(heartbeat)
        unsubscribe?.()
      }
      req.signal.addEventListener('abort', cleanup)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
