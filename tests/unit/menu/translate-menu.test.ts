import { describe, expect, it } from 'vitest'
import { MockLanguageModelV3 } from 'ai/test'
import {
  MAX_TRANSLATE_ITEMS,
  buildTranslatePrompt,
  parseTranslateRequest,
  pickTranslationModel,
  translateMenuTexts,
} from '@/lib/ai/translate-menu'

describe('parseTranslateRequest', () => {
  it('normalises a valid request', () => {
    expect(parseTranslateRequest({
      from: 'pt',
      to: ['en', 'ja', 'en', 'pt', 'xx', 3],
      items: { name: ' Feijoada ', description: '', 'option:1': 'Grande', bad: 5 },
    })).toEqual({ from: 'pt', to: ['en', 'ja'], items: { name: 'Feijoada', 'option:1': 'Grande' } })
  })

  it('rejects unusable bodies', () => {
    expect(parseTranslateRequest(null)).toHaveProperty('error')
    expect(parseTranslateRequest({ from: 'xx', to: ['en'], items: { a: 'b' } })).toEqual({ error: 'Unknown source language' })
    expect(parseTranslateRequest({ from: 'pt', to: ['pt'], items: { a: 'b' } })).toEqual({ error: 'Missing target languages' })
    expect(parseTranslateRequest({ from: 'pt', to: ['en'], items: { a: '  ' } })).toEqual({ error: 'Nothing to translate' })
    expect(parseTranslateRequest({ from: 'pt', to: ['en'], items: ['a'] })).toEqual({ error: 'Nothing to translate' })
  })

  it('limits how much is sent at once', () => {
    const many = Object.fromEntries(Array.from({ length: MAX_TRANSLATE_ITEMS + 1 }, (_, i) => [`k${i}`, 'x']))
    expect(parseTranslateRequest({ from: 'pt', to: ['en'], items: many })).toHaveProperty('error')
    const long = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`k${i}`, 'x'.repeat(2000)]))
    expect(parseTranslateRequest({ from: 'pt', to: ['en'], items: long })).toEqual({ error: 'Texts are too long to translate at once' })
  })
})

describe('pickTranslationModel', () => {
  it('uses OpenRouter on the platform key, with the model overridable', () => {
    expect(pickTranslationModel({ OPENROUTER_API_KEY: 'k' })?.label).toBe('google/gemini-2.5-flash')
    expect(pickTranslationModel({ OPENROUTER_API_KEY: 'k', OPENROUTER_TEXT_MODEL: 'openai/gpt-5-mini' })?.label).toBe('openai/gpt-5-mini')
    expect(pickTranslationModel({ OPENROUTER_API_KEY: ' ' })).toBeNull()
    expect(pickTranslationModel({ GOOGLE_GENERATIVE_AI_API_KEY: 'g', OPENAI_API_KEY: 'o' })).toBeNull()
  })
})

describe('translateMenuTexts', () => {
  const request = { from: 'pt', to: ['en', 'ja'], items: { name: 'Feijoada', 'option:1': 'Grande' } }
  const usage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  }
  function answering(object: unknown) {
    return new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: 'text' as const, text: JSON.stringify(object) }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage,
        warnings: [],
      }) as never,
    })
  }

  it('returns only requested languages and known keys', async () => {
    const model = answering({
      languages: [
        { language: 'en', entries: [{ key: 'name', text: ' Black bean stew ' }, { key: 'option:1', text: 'Large' }, { key: 'invented', text: 'x' }] },
        { language: 'ja', entries: [{ key: 'name', text: 'フェイジョアーダ' }, { key: 'option:1', text: '' }] },
        { language: 'fr', entries: [{ key: 'name', text: 'Ragoût' }] },
      ],
    })
    expect(await translateMenuTexts(model, request)).toEqual({
      en: { name: 'Black bean stew', 'option:1': 'Large' },
      ja: { name: 'フェイジョアーダ' },
    })
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt)
    expect(prompt).toContain('Feijoada')
    expect(prompt).toContain('ja (Japanese)')
  })

  it('throws when the model answers something that is not the schema', async () => {
    await expect(translateMenuTexts(answering({ nope: true }), request)).rejects.toThrow()
  })
})

describe('buildTranslatePrompt', () => {
  it('names source and targets and lists the texts', () => {
    const prompt = buildTranslatePrompt({ from: 'pt', to: ['en'], items: { name: 'Picanha' } })
    expect(prompt).toContain('from Portuguese into: en (English)')
    expect(prompt).toContain('"name": "Picanha"')
  })
})
