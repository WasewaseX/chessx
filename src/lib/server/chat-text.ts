/**
 * Mechanical text hygiene for coach answers. LLMs occasionally echo a fact
 * sentence twice (seen live: "Bc4 was the engine's choice. Bc4 was the
 * engine's choice." — the prompt had quoted the verified reason in more than
 * one context line, and the model repeated it verbatim). The root cause is
 * fixed at the prompt level (reason quoted at most once per move), and this
 * collapse runs on the way out so the echo class can never reach the student
 * again, whatever the model does.
 */

/** Collapse immediately-repeated duplicate sentences (case/punctuation
 * insensitive). Deliberately conservative: only CONSECUTIVE exact repeats are
 * removed — deliberate stylistic repetition further apart stays. */
export function collapseEchoedSentences(text: string): string {
  const parts = text.split(/(?<=[.!?])\s+/)
  const norm = (s: string) => s.trim().toLowerCase().replace(/[.!?]+$/, '')
  const out: string[] = []
  for (const part of parts) {
    if (out.length && norm(out[out.length - 1]) === norm(part) && norm(part).length > 0) continue
    out.push(part)
  }
  return out.join(' ').trim()
}
