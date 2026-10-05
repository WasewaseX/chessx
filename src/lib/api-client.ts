'use client'

/**
 * Response.json() throws a cryptic "JSON.parse: unexpected character" when a
 * route is missing or a proxy answers with an HTML error page. Every client
 * fetch that expects JSON goes through here: it checks what actually came
 * back and turns failures into readable errors instead of parser crashes.
 */
export async function readJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text().catch(() => '')
  if (!text) {
    throw new Error(res.ok ? 'Empty response from the server' : `Request failed (${res.status})`)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    const head = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
    throw new Error(res.ok ? `Unexpected server response: ${head}` : `Request failed (${res.status}): ${head}`)
  }
}
