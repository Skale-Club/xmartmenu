import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateObject } from 'ai'
import { z } from 'zod'
import {
  DEFAULT_MODELS,
  OPENROUTER_BASE_URL,
  OpenRouterError,
  audioFilename,
  defaultImageEngine,
  generateOpenRouterImage,
  imageModelId,
  openRouterModel,
  parseAspectRatio,
  parseImageEngine,
  platformOpenRouterKey,
  textModelId,
  transcribeWithOpenRouter,
  transcriptionModelId,
  visionModelId,
} from '@/lib/ai/openrouter'

afterEach(() => vi.unstubAllGlobals())

describe('keys and models', () => {
  it('reads the platform key and ignores blanks', () => {
    expect(platformOpenRouterKey({ OPENROUTER_API_KEY: ' sk-or-1 ' })).toBe('sk-or-1')
    expect(platformOpenRouterKey({ OPENROUTER_API_KEY: '  ' })).toBeNull()
    expect(platformOpenRouterKey({ GOOGLE_GENERATIVE_AI_API_KEY: 'g', OPENAI_API_KEY: 'o' })).toBeNull()
  })

  it('uses OpenRouter slugs with per-deployment overrides', () => {
    expect(textModelId({})).toBe(DEFAULT_MODELS.text)
    expect(textModelId({ OPENROUTER_TEXT_MODEL: 'openai/gpt-5-mini' })).toBe('openai/gpt-5-mini')
    expect(visionModelId({})).toBe('openai/gpt-4.1-mini')
    for (const id of [DEFAULT_MODELS.text, DEFAULT_MODELS.vision, ...Object.values(DEFAULT_MODELS.image), ...Object.values(DEFAULT_MODELS.transcription)]) {
      expect(id).toMatch(/^[a-z0-9-]+\/[a-z0-9.-]+$/)
    }
  })

  it('picks the image engine: Google by default, ChatGPT when asked', () => {
    expect(defaultImageEngine({})).toBe('google')
    expect(defaultImageEngine({ OPENROUTER_IMAGE_ENGINE: 'openai' })).toBe('openai')
    expect(parseImageEngine('openai', {})).toBe('openai')
    expect(parseImageEngine('dall-e', {})).toBe('google')
    expect(parseImageEngine(undefined, { OPENROUTER_IMAGE_ENGINE: 'openai' })).toBe('openai')
    expect(imageModelId('google', {})).toBe('google/gemini-3.1-flash-image')
    expect(imageModelId('openai', {})).toBe('openai/gpt-image-2')
    expect(imageModelId('openai', { OPENROUTER_IMAGE_MODEL_OPENAI: 'openai/gpt-image-1-mini' })).toBe('openai/gpt-image-1-mini')
  })

  it('maps the restaurant transcription choice to OpenRouter models', () => {
    expect(transcriptionModelId('whisper', {})).toBe('openai/whisper-1')
    expect(transcriptionModelId('deepgram', {})).toBe('deepgram/nova-3')
    expect(transcriptionModelId(null, {})).toBe('openai/whisper-1')
    expect(transcriptionModelId('deepgram', { OPENROUTER_TRANSCRIPTION_MODEL: 'openai/gpt-4o-mini-transcribe' })).toBe('openai/gpt-4o-mini-transcribe')
  })
})

describe('openRouterModel', () => {
  it('sends chat completions to OpenRouter with non-strict JSON schemas', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), headers: new Headers(init.headers) })
      return new Response(JSON.stringify({
        id: 'gen-1',
        created: 1,
        model: 'google/gemini-2.5-flash',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"name":"Feijoada"}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const { object } = await generateObject({
      model: openRouterModel('sk-or-test', 'google/gemini-2.5-flash'),
      schema: z.object({ name: z.string(), note: z.string().optional() }),
      prompt: 'Name a dish',
    })

    expect(object).toEqual({ name: 'Feijoada' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${OPENROUTER_BASE_URL}/chat/completions`)
    expect(calls[0].headers.get('authorization')).toBe('Bearer sk-or-test')
    expect(calls[0].headers.get('x-title')).toBe('XmartMenu')
    expect(calls[0].body.model).toBe('google/gemini-2.5-flash')
    const format = calls[0].body.response_format as { type: string; json_schema: { strict: boolean } }
    expect(format.type).toBe('json_schema')
    expect(format.json_schema.strict).toBe(false)
  })
})

describe('generateOpenRouterImage', () => {
  it('calls the Images API and decodes the first image', async () => {
    const png = Buffer.from('fake-png')
    let sent: { url: string; body: Record<string, unknown> } | null = null
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)) }
      return new Response(JSON.stringify({ created: 1, data: [{ b64_json: png.toString('base64'), media_type: 'image/png' }], usage: { total_tokens: 42, cost: 0.04 } }), { status: 200 })
    }) as unknown as typeof fetch

    const image = await generateOpenRouterImage({ apiKey: 'k', model: 'openai/gpt-image-2', prompt: 'a pizza', aspectRatio: '1:1', fetchImpl })
    expect(sent!.url).toBe(`${OPENROUTER_BASE_URL}/images`)
    expect(sent!.body).toEqual({ model: 'openai/gpt-image-2', prompt: 'a pizza', n: 1, aspect_ratio: '1:1' })
    expect(image.bytes.equals(png)).toBe(true)
    expect(image.mime).toBe('image/png')
    expect(image.totalTokens).toBe(42)
    expect(image.cost).toBe(0.04)
  })

  it('throws an OpenRouterError on failures and empty answers', async () => {
    const failing = (async () => new Response('{"error":{"message":"no credits"}}', { status: 402 })) as unknown as typeof fetch
    await expect(generateOpenRouterImage({ apiKey: 'k', model: 'm/x', prompt: 'p', fetchImpl: failing })).rejects.toMatchObject({ name: 'OpenRouterError', status: 402 })
    const empty = (async () => new Response('{"created":1,"data":[]}', { status: 200 })) as unknown as typeof fetch
    await expect(generateOpenRouterImage({ apiKey: 'k', model: 'm/x', prompt: 'p', fetchImpl: empty })).rejects.toBeInstanceOf(OpenRouterError)
  })

  it('parses aspect ratios', () => {
    expect(parseAspectRatio('16:9')).toBeCloseTo(16 / 9)
    expect(parseAspectRatio('4:1')).toBe(4)
    expect(parseAspectRatio('auto')).toBeNull()
  })
})

describe('transcribeWithOpenRouter', () => {
  it('uploads the clip as multipart with the model and returns the text', async () => {
    let form: FormData | null = null
    let url = ''
    const fetchImpl = (async (u: string, init: RequestInit) => {
      url = u
      form = init.body as FormData
      return new Response(JSON.stringify({ text: ' Two margheritas, please ' }), { status: 200 })
    }) as unknown as typeof fetch

    const text = await transcribeWithOpenRouter({ apiKey: 'k', model: 'openai/whisper-1', audio: new Blob(['abc'], { type: 'audio/webm;codecs=opus' }), fetchImpl })
    expect(url).toBe(`${OPENROUTER_BASE_URL}/audio/transcriptions`)
    expect(form!.get('model')).toBe('openai/whisper-1')
    expect((form!.get('file') as File).name).toBe('voice.webm')
    expect(text).toBe(' Two margheritas, please ')
  })

  it('names the file after the recorded format', () => {
    expect(audioFilename('audio/mp4')).toBe('voice.m4a')
    expect(audioFilename('audio/ogg;codecs=opus')).toBe('voice.ogg')
    expect(audioFilename('')).toBe('voice.webm')
  })
})
