/**
 * Translated dish content: categories, dishes, option groups and options can
 * carry `translations` — { "<lang>": { name?, description? } } — next to their
 * base text. Pure helpers shared by the admin (sanitising what is saved), the
 * AI translate route and the public menu (resolving with fallback).
 */
import { MENU_LANGUAGE_CODES } from '@/components/menu/menu-i18n'

export type TextFields = { name?: string; description?: string }
export type TextTranslations = Record<string, TextFields>

const MAX = { name: 200, description: 2000 } as const
const KNOWN_LANGUAGES = new Set<string>(MENU_LANGUAGE_CODES)

/**
 * Keeps only known language codes and the given fields, trimmed and capped;
 * drops empty values and empty languages. Anything malformed becomes {}.
 */
export function sanitizeTranslations(raw: unknown, fields: ReadonlyArray<keyof TextFields> = ['name', 'description']): TextTranslations {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: TextTranslations = {}
  for (const [lang, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!KNOWN_LANGUAGES.has(lang) || !value || typeof value !== 'object') continue
    const entry: TextFields = {}
    for (const field of fields) {
      const text = (value as Record<string, unknown>)[field]
      if (typeof text === 'string' && text.trim()) entry[field] = text.trim().slice(0, MAX[field])
    }
    if (Object.keys(entry).length) out[lang] = entry
  }
  return out
}

/** The text in `lang` when there is one, else the base text. */
export function translatedText(base: string, translations: TextTranslations | null | undefined, lang: string, field: keyof TextFields = 'name'): string {
  const value = translations?.[lang]?.[field]
  return typeof value === 'string' && value.trim() ? value : base
}

type Translatable = { name: string; translations?: TextTranslations | Record<string, { name?: string }> | null }

/**
 * A copy shown in `lang`: name (and description, when present) translated,
 * the base name kept as `base_name` so orders still reach the kitchen in the
 * restaurant's own language. The base language returns the item as is.
 */
export function localizeItem<T extends Translatable & { description?: string | null }>(item: T, lang: string, baseLang: string | null | undefined): T & { base_name?: string } {
  if (!lang || lang === baseLang || !item.translations) return item
  const translations = item.translations as TextTranslations
  const name = translatedText(item.name, translations, lang, 'name')
  const hasDescription = typeof item.description === 'string'
  const description = hasDescription ? translatedText(item.description as string, translations, lang, 'description') : item.description
  if (name === item.name && description === item.description) return item
  return { ...item, name, description, base_name: item.name }
}

type GroupLike = Translatable & { options: Translatable[] }

/** Option groups with their options, localized the same way. */
export function localizeGroups<G extends GroupLike>(groups: G[], lang: string, baseLang: string | null | undefined): G[] {
  if (!lang || lang === baseLang) return groups
  return groups.map((group) => ({
    ...localizeItem(group, lang, baseLang),
    options: group.options.map((option) => localizeItem(option, lang, baseLang)),
  }))
}

/** The name to send to the kitchen: the base text, whatever the guest reads. */
export function baseName(item: { name: string; base_name?: string }): string {
  return item.base_name ?? item.name
}

/** Editor shape: language → field key → text (keys like "name" or "option:<id>"). */
export type EditorValues = Record<string, Record<string, string>>
export type EditorKeys = { name: string; description?: string }

/** Spreads one item's stored translations into editor values under its keys. */
export function addEditorValues(values: EditorValues, translations: TextTranslations | Record<string, { name?: string }> | null | undefined, keys: EditorKeys): EditorValues {
  for (const [lang, entry] of Object.entries(translations ?? {})) {
    const row: Record<string, string> = { ...(values[lang] ?? {}) }
    if (entry?.name) row[keys.name] = entry.name
    const description = (entry as TextFields | undefined)?.description
    if (keys.description && description) row[keys.description] = description
    if (Object.keys(row).length) values[lang] = row
  }
  return values
}

/** One item's translations collected back out of editor values, sanitised for saving. */
export function pickEditorTranslations(values: EditorValues, keys: EditorKeys): TextTranslations {
  const raw: Record<string, TextFields> = {}
  for (const [lang, row] of Object.entries(values)) {
    raw[lang] = { name: row[keys.name], description: keys.description ? row[keys.description] : undefined }
  }
  return sanitizeTranslations(raw, keys.description ? ['name', 'description'] : ['name'])
}
