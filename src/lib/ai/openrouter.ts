/**
 * Every AI call in XmartMenu goes through OpenRouter: text and structured
 * output (menu seed, OCR, translation, chat, blog), image generation (Google
 * Gemini Image or OpenAI GPT Image) and speech-to-text (Whisper, Deepgram).
 * No route talks to Google, OpenAI or any other AI vendor directly.
 *
 * Keys:
 * - Platform features (superadmin seed, OCR, images, menu translation) use
 *   OPENROUTER_API_KEY from the server environment.
 * - Tenant features (chat assistant, voice notes, tenant blog) use the
 *   tenant's own encrypted OpenRouter key, passed in by the caller.
 *
 * Model ids are OpenRouter slugs ("vendor/model") and can be overridden per
 * deployment with the OPENROUTER_*_MODEL variables below.
 */
import { createOpenAI } from '@ai-sdk/openai'
import { defaultSettingsMiddleware, wrapLanguageModel, type LanguageModel } from 'ai'

// Overridable so tests can point the app at a fake OpenRouter (tests/e2e/mock-openrouter.mjs).
export const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1'

type Env = Record<string, string | undefined>

/** OpenRouter's app attribution headers. */
function attributionHeaders(env: Env = process.env): Record<string, string> {
  return {
    'HTTP-Referer': env.NEXT_PUBLIC_SITE_URL || 'https://xmartmenu.com',
    'X-Title': 'XmartMenu',
  }
}

/** The platform key, or null when this deployment has none. */
export function platformOpenRouterKey(env: Env = process.env): string | null {
  return env.OPENROUTER_API_KEY?.trim() || null
}

export const PLATFORM_KEY_MISSING = 'AI is not configured on this server (OPENROUTER_API_KEY is missing).'

// ── Models ───────────────────────────────────────────────────────────────────

export type ImageEngine = 'google' | 'openai'
export const IMAGE_ENGINES: readonly ImageEngine[] = ['google', 'openai']

export const DEFAULT_MODELS = {
  /** Structured text: menu seed, copy, translations. */
  text: 'google/gemini-2.5-flash',
  /** Reading photos of printed menus. */
  vision: 'openai/gpt-4.1-mini',
  /** Image generation per engine. */
  image: { google: 'google/gemini-3.1-flash-image', openai: 'openai/gpt-image-2' } as Record<ImageEngine, string>,
  /** Speech-to-text per tenant audio_provider setting. */
  transcription: { whisper: 'openai/whisper-1', deepgram: 'deepgram/nova-3' } as Record<'whisper' | 'deepgram', string>,
}

export function textModelId(env: Env = process.env): string {
  return env.OPENROUTER_TEXT_MODEL?.trim() || DEFAULT_MODELS.text
}

export function visionModelId(env: Env = process.env): string {
  return env.OPENROUTER_VISION_MODEL?.trim() || DEFAULT_MODELS.vision
}

/** The engine to use when the caller does not pick one. */
export function defaultImageEngine(env: Env = process.env): ImageEngine {
  const value = env.OPENROUTER_IMAGE_ENGINE?.trim()
  return value === 'openai' ? 'openai' : 'google'
}

export function parseImageEngine(value: unknown, env: Env = process.env): ImageEngine {
  return value === 'google' || value === 'openai' ? value : defaultImageEngine(env)
}

export function imageModelId(engine: ImageEngine, env: Env = process.env): string {
  const override = engine === 'openai' ? env.OPENROUTER_IMAGE_MODEL_OPENAI : env.OPENROUTER_IMAGE_MODEL_GOOGLE
  return override?.trim() || DEFAULT_MODELS.image[engine]
}

export function transcriptionModelId(provider: string | null | undefined, env: Env = process.env): string {
  if (env.OPENROUTER_TRANSCRIPTION_MODEL?.trim()) return env.OPENROUTER_TRANSCRIPTION_MODEL.trim()
  return provider === 'deepgram' ? DEFAULT_MODELS.transcription.deepgram : DEFAULT_MODELS.transcription.whisper
}

// ── Text / structured output ─────────────────────────────────────────────────

/**
 * An AI SDK language model served by OpenRouter (chat completions API).
 *
 * JSON schemas are sent non-strict: OpenAI's strict mode rejects optional
 * fields, which the seed and OCR schemas use, and OpenRouter validates the
 * shape on its side anyway (the AI SDK still checks it against zod).
 */
export function openRouterModel(apiKey: string, modelId: string, fetchImpl?: typeof fetch): LanguageModel {
  const provider = createOpenAI({
    name: 'openrouter',
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    headers: attributionHeaders(),
    // ai/access.ts meteredFetch: records each call's real cost.
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })
  return wrapLanguageModel({
    model: provider.chat(modelId),
    middleware: defaultSettingsMiddleware({ settings: { providerOptions: { openai: { strictJsonSchema: false } } } }),
  })
}

// ── Images ───────────────────────────────────────────────────────────────────

export interface GeneratedImage {
  bytes: Buffer
  mime: string
  totalTokens: number
  cost: number | null
}

export class OpenRouterError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'OpenRouterError'
  }
}

/**
 * Generates one image through OpenRouter's Images API (POST /images).
 * The provider clamps `aspectRatio` to what the model supports; callers that
 * need an exact shape crop afterwards (see cropToAspect).
 */
export async function generateOpenRouterImage(args: {
  apiKey: string
  model: string
  prompt: string
  aspectRatio?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<GeneratedImage> {
  const doFetch = args.fetchImpl ?? fetch
  const res = await doFetch(`${OPENROUTER_BASE_URL}/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${args.apiKey}`, 'Content-Type': 'application/json', ...attributionHeaders() },
    body: JSON.stringify({
      model: args.model,
      prompt: args.prompt,
      n: 1,
      ...(args.aspectRatio ? { aspect_ratio: args.aspectRatio } : {}),
    }),
    signal: AbortSignal.timeout(args.timeoutMs ?? 120_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new OpenRouterError(`OpenRouter image request failed (${res.status}): ${body.slice(0, 300)}`, res.status)
  }
  const json = (await res.json()) as {
    data?: Array<{ b64_json?: string; media_type?: string }>
    usage?: { total_tokens?: number; cost?: number | null }
  }
  const first = json.data?.[0]
  if (!first?.b64_json) throw new OpenRouterError('OpenRouter returned no image', 502)
  return {
    bytes: Buffer.from(first.b64_json, 'base64'),
    mime: first.media_type || 'image/png',
    totalTokens: json.usage?.total_tokens ?? 0,
    cost: json.usage?.cost ?? null,
  }
}

/** "16:9" → 16/9; null when it is not a ratio. */
export function parseAspectRatio(value: string): number | null {
  const match = value.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)
  if (!match) return null
  const ratio = Number(match[1]) / Number(match[2])
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null
}

/**
 * Crops to the requested aspect ratio when the model returned another shape
 * (engines clamp to their own supported sizes). Crops instead of stretching,
 * keeping the most interesting region. Returns the input when it already fits
 * or when it cannot be read.
 */
export async function cropToAspect(bytes: Buffer, aspectRatio: string, tolerance = 0.05): Promise<Buffer> {
  const target = parseAspectRatio(aspectRatio)
  if (!target) return bytes
  try {
    const { default: sharp } = await import('sharp')
    const image = sharp(bytes)
    const { width, height } = await image.metadata()
    if (!width || !height) return bytes
    const actual = width / height
    if (Math.abs(actual - target) / target <= tolerance) return bytes
    const [cropWidth, cropHeight] = actual > target
      ? [Math.round(height * target), height]
      : [width, Math.round(width / target)]
    return await image.resize({ width: cropWidth, height: cropHeight, fit: 'cover', position: 'attention' }).toBuffer()
  } catch {
    return bytes
  }
}

// ── Speech-to-text ───────────────────────────────────────────────────────────

/** Transcribes a voice clip through OpenRouter (POST /audio/transcriptions). */
export async function transcribeWithOpenRouter(args: {
  apiKey: string
  model: string
  audio: Blob
  filename?: string
  fetchImpl?: typeof fetch
}): Promise<string> {
  const doFetch = args.fetchImpl ?? fetch
  const form = new FormData()
  form.append('file', args.audio, args.filename ?? audioFilename(args.audio.type))
  form.append('model', args.model)
  const res = await doFetch(`${OPENROUTER_BASE_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${args.apiKey}`, ...attributionHeaders() },
    body: form,
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new OpenRouterError(`OpenRouter transcription failed (${res.status}): ${body.slice(0, 200)}`, res.status)
  }
  const json = (await res.json()) as { text?: string }
  return json.text ?? ''
}

/** A filename whose extension tells OpenRouter the audio format. */
export function audioFilename(mime: string | null | undefined): string {
  const type = (mime ?? '').split(';')[0].trim().toLowerCase()
  const ext: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
  }
  return `voice.${ext[type] ?? 'webm'}`
}
