/**
 * Translates a restaurant's menu texts (dish names, descriptions, option
 * names…) from its base language into the other languages its menu offers.
 *
 * Input and output are flat key → text maps, so the caller decides what the
 * keys mean ("name", "description", "option:<id>"…). Only requested
 * languages and known keys come back; anything else the model returns is
 * dropped. Nothing is saved here — the owner reviews before saving.
 */
import { generateObject, type LanguageModel } from 'ai'
import { openRouterModel, platformOpenRouterKey, textModelId } from '@/lib/ai/openrouter'
import { z } from 'zod'
import { MENU_LANGUAGE_CODES, menuLanguage } from '@/components/menu/menu-i18n'

export const MAX_TRANSLATE_ITEMS = 80
export const MAX_TRANSLATE_CHARS = 12_000
export const MAX_TARGET_LANGUAGES = MENU_LANGUAGE_CODES.length - 1

export interface TranslateRequest {
  from: string
  to: string[]
  items: Record<string, string>
}

export type TranslateResult = Record<string, Record<string, string>>

const KNOWN = new Set<string>(MENU_LANGUAGE_CODES)

/** Checks and normalises a request body; returns an error message instead when it is unusable. */
export function parseTranslateRequest(body: unknown): TranslateRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid request' }
  const { from, to, items } = body as Record<string, unknown>
  if (typeof from !== 'string' || !KNOWN.has(from)) return { error: 'Unknown source language' }
  if (!Array.isArray(to)) return { error: 'Missing target languages' }
  const targets = [...new Set(to.filter((l): l is string => typeof l === 'string' && KNOWN.has(l) && l !== from))]
  if (!targets.length) return { error: 'Missing target languages' }
  if (!items || typeof items !== 'object' || Array.isArray(items)) return { error: 'Nothing to translate' }
  const clean: Record<string, string> = {}
  let chars = 0
  for (const [key, text] of Object.entries(items as Record<string, unknown>)) {
    if (typeof text !== 'string' || !text.trim() || key.length > 120) continue
    const trimmed = text.trim().slice(0, 2000)
    clean[key] = trimmed
    chars += trimmed.length
  }
  const count = Object.keys(clean).length
  if (!count) return { error: 'Nothing to translate' }
  if (count > MAX_TRANSLATE_ITEMS) return { error: `Too many texts (max ${MAX_TRANSLATE_ITEMS})` }
  if (chars > MAX_TRANSLATE_CHARS) return { error: 'Texts are too long to translate at once' }
  return { from, to: targets.slice(0, MAX_TARGET_LANGUAGES), items: clean }
}

/** The OpenRouter text model on the platform key; null when this deployment has no key. */
export function pickTranslationModel(env: Record<string, string | undefined> = process.env): { model: LanguageModel; label: string } | null {
  const key = platformOpenRouterKey(env)
  if (!key) return null
  const label = textModelId(env)
  return { model: openRouterModel(key, label), label }
}

const responseSchema = z.object({
  languages: z.array(z.object({
    language: z.string(),
    entries: z.array(z.object({ key: z.string(), text: z.string() })),
  })),
})

export function buildTranslatePrompt(req: TranslateRequest): string {
  const source = menuLanguage(req.from).englishName
  const targets = req.to.map((code) => `${code} (${menuLanguage(code).englishName})`).join(', ')
  return `You translate a restaurant menu from ${source} into: ${targets}.

Rules:
- Write natural, appetizing menu language a local restaurant would use, not a literal word-for-word rendering.
- Keep dish names that are usually left untranslated in that language as they are (for example Bruschetta, Tiramisu, Picanha, Sushi, Pad Thai), or add a short translation after them only when guests would not understand.
- Keep numbers, sizes, units, prices and brand names exactly.
- Do not add, drop or invent ingredients or claims. Keep the length close to the original.
- Return every key for every target language, using the exact language codes and keys given.

Texts (JSON, key → text):
${JSON.stringify(req.items, null, 2)}`
}

export async function translateMenuTexts(model: LanguageModel, req: TranslateRequest): Promise<TranslateResult> {
  const { object } = await generateObject({
    model,
    schema: responseSchema,
    prompt: buildTranslatePrompt(req),
    temperature: 0.2,
    maxRetries: 1,
  })
  const wanted = new Set(req.to)
  const result: TranslateResult = {}
  for (const block of object.languages) {
    if (!wanted.has(block.language)) continue
    const texts: Record<string, string> = {}
    for (const entry of block.entries) {
      if (entry.key in req.items && entry.text.trim()) texts[entry.key] = entry.text.trim().slice(0, 2000)
    }
    if (Object.keys(texts).length) result[block.language] = { ...(result[block.language] ?? {}), ...texts }
  }
  return result
}
