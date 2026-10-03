// Provider metadata shared between client (settings UI) and server (API routes).
// No server-only imports here.

export interface AiConfig {
  provider: string
  baseUrl: string | null
  apiKey: string | null
  model: string | null
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export const PROVIDERS: Record<
  string,
  { label: string; baseUrl?: string; defaultModel?: string; kind: 'openai' | 'anthropic' | 'gemini' | 'builtin' }
> = {
  builtin: { label: 'Built-in (ChessX AI)', kind: 'builtin' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', kind: 'openai' },
  anthropic: { label: 'Anthropic', baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-3-5-haiku-latest', kind: 'anthropic' },
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com', defaultModel: 'gemini-2.0-flash', kind: 'gemini' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o-mini', kind: 'openai' },
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', kind: 'openai' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', kind: 'openai' },
  custom: { label: 'Custom OpenAI-compatible', kind: 'openai' },
}
