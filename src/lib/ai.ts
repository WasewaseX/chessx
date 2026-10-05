// Server-side AI execution: built-in Z.ai SDK or bring-your-own key
// (OpenAI-compatible endpoints, Anthropic, Google Gemini).
import { db } from '@/lib/db'
import { PROVIDERS, type AiConfig, type ChatMessage } from '@/lib/ai-providers'

export { PROVIDERS }
export type { AiConfig, ChatMessage }

export async function getAiConfig(profileId: string): Promise<AiConfig> {
  const p = await db.profile.findUnique({ where: { id: profileId } })
  return {
    provider: p?.aiProvider ?? 'builtin',
    baseUrl: p?.aiBaseUrl ?? null,
    apiKey: p?.aiApiKey ?? null,
    model: p?.aiModel ?? null,
  }
}

export async function runChat(
  cfg: AiConfig,
  system: string,
  messages: ChatMessage[],
  maxTokens = 700,
): Promise<string> {
  const provider = PROVIDERS[cfg.provider] ?? PROVIDERS.builtin
  if (provider.kind === 'builtin') {
    return runBuiltin(system, messages)
  }
  if (cfg.provider === 'custom' && !cfg.baseUrl) {
    throw new Error('No base URL set for the custom provider.')
  }
  if (!cfg.apiKey) {
    throw new Error('No API key set for this provider.')
  }
  switch (provider.kind) {
    case 'openai':
      return runOpenAICompatible(cfg, provider.baseUrl ?? cfg.baseUrl ?? '', system, messages, maxTokens)
    case 'anthropic':
      return runAnthropic(cfg, system, messages, maxTokens)
    case 'gemini':
      return runGemini(cfg, system, messages, maxTokens)
    default:
      return runBuiltin(system, messages)
  }
}

async function runBuiltin(system: string, messages: ChatMessage[]): Promise<string> {
  const { default: ZAI } = await import('z-ai-web-dev-sdk')
  const zai = await ZAI.create()
  const completion = await zai.chat.completions.create({
    messages: [{ role: 'assistant', content: system }, ...messages],
    thinking: { type: 'disabled' },
  })
  const content = completion.choices[0]?.message?.content
  if (!content) throw new Error('Empty response from the built-in model.')
  return content
}

async function runOpenAICompatible(
  cfg: AiConfig,
  baseUrl: string,
  system: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<string> {
  const model = cfg.model || PROVIDERS[cfg.provider]?.defaultModel || 'gpt-4o-mini'
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} from ${cfg.provider}: ${text.slice(0, 300)}`)
  }
  const data = await res.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('Empty response from provider.')
  return content
}

async function runAnthropic(cfg: AiConfig, system: string, messages: ChatMessage[], maxTokens: number): Promise<string> {
  const model = cfg.model || PROVIDERS.anthropic.defaultModel!
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} from Anthropic: ${text.slice(0, 300)}`)
  }
  const data = await res.json()
  const content = data.content?.[0]?.text
  if (!content) throw new Error('Empty response from Anthropic.')
  return content
}

async function runGemini(cfg: AiConfig, system: string, messages: ChatMessage[], maxTokens: number): Promise<string> {
  const model = cfg.model || PROVIDERS.gemini.defaultModel!
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cfg.apiKey ?? '')}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} from Gemini: ${text.slice(0, 300)}`)
  }
  const data = await res.json()
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!content) throw new Error('Empty response from Gemini.')
  return content
}
