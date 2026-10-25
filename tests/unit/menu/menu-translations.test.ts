import { describe, expect, it } from 'vitest'
import {
  addEditorValues,
  baseName,
  localizeGroups,
  localizeItem,
  pickEditorTranslations,
  sanitizeTranslations,
  translatedText,
} from '@/lib/menu-translations'

describe('sanitizeTranslations', () => {
  it('keeps known languages and fields, trimmed, and drops empties', () => {
    expect(sanitizeTranslations({
      ja: { name: '  マルゲリータ ', description: '' },
      en: { name: '', description: '' },
      xx: { name: 'unknown language' },
      es: { name: 'Margarita', extra: 'ignored' },
    })).toEqual({ ja: { name: 'マルゲリータ' }, es: { name: 'Margarita' } })
  })

  it('caps lengths and only keeps the requested fields', () => {
    const out = sanitizeTranslations({ en: { name: 'n'.repeat(300), description: 'd'.repeat(3000) } })
    expect(out.en.name).toHaveLength(200)
    expect(out.en.description).toHaveLength(2000)
    expect(sanitizeTranslations({ en: { name: 'Size', description: 'x' } }, ['name'])).toEqual({ en: { name: 'Size' } })
  })

  it('turns malformed input into an empty object', () => {
    expect(sanitizeTranslations(null)).toEqual({})
    expect(sanitizeTranslations('ja')).toEqual({})
    expect(sanitizeTranslations([{ name: 'x' }])).toEqual({})
    expect(sanitizeTranslations({ ja: 'not an object' })).toEqual({})
    expect(sanitizeTranslations({ ja: { name: 42 } })).toEqual({})
  })
})

describe('translatedText', () => {
  const t = { ja: { name: 'ピザ', description: '' } }
  it('uses the translation when present and falls back to the base text', () => {
    expect(translatedText('Pizza', t, 'ja')).toBe('ピザ')
    expect(translatedText('Molho de tomate', t, 'ja', 'description')).toBe('Molho de tomate')
    expect(translatedText('Pizza', t, 'fr')).toBe('Pizza')
    expect(translatedText('Pizza', undefined, 'ja')).toBe('Pizza')
  })
})

describe('localizeItem', () => {
  const dish = {
    id: 'p1',
    name: 'Feijoada',
    description: 'Feijão preto com carnes',
    translations: { en: { name: 'Black bean stew', description: 'Black beans with pork' }, ja: { name: 'フェイジョアーダ' } },
  }

  it('returns the item untouched in the base language', () => {
    expect(localizeItem(dish, 'pt', 'pt')).toBe(dish)
  })

  it('translates name and description and keeps the base name for orders', () => {
    const en = localizeItem(dish, 'en', 'pt')
    expect(en.name).toBe('Black bean stew')
    expect(en.description).toBe('Black beans with pork')
    expect(baseName(en)).toBe('Feijoada')
  })

  it('falls back field by field', () => {
    const ja = localizeItem(dish, 'ja', 'pt')
    expect(ja.name).toBe('フェイジョアーダ')
    expect(ja.description).toBe('Feijão preto com carnes')
    expect(ja.base_name).toBe('Feijoada')
  })

  it('returns the same object when there is nothing to translate', () => {
    expect(localizeItem(dish, 'fr', 'pt')).toBe(dish)
    const plain = { name: 'Água', description: null }
    expect(localizeItem(plain, 'en', 'pt')).toBe(plain)
    expect(baseName(plain)).toBe('Água')
  })
})

describe('localizeGroups', () => {
  it('localizes groups and their options, keeping base names', () => {
    const groups = [{
      id: 'g1',
      name: 'Tamanho',
      translations: { en: { name: 'Size' } },
      options: [
        { id: 'o1', name: 'Grande', translations: { en: { name: 'Large' } } },
        { id: 'o2', name: 'Média', translations: {} as Record<string, { name?: string }> },
      ],
    }]
    const [group] = localizeGroups(groups, 'en', 'pt')
    expect(group.name).toBe('Size')
    expect(baseName(group)).toBe('Tamanho')
    expect(group.options.map(o => o.name)).toEqual(['Large', 'Média'])
    expect(group.options.map(baseName)).toEqual(['Grande', 'Média'])
    expect(localizeGroups(groups, 'pt', 'pt')).toBe(groups)
  })
})

describe('editor values round trip', () => {
  it('spreads several items into one value map and collects each back', () => {
    const values = {}
    addEditorValues(values, { en: { name: 'Pizza', description: 'Tomato' }, ja: { name: 'ピザ' } }, { name: 'name', description: 'description' })
    addEditorValues(values, { en: { name: 'Size' } }, { name: 'group:g1' })
    expect(values).toEqual({
      en: { name: 'Pizza', description: 'Tomato', 'group:g1': 'Size' },
      ja: { name: 'ピザ' },
    })
    expect(pickEditorTranslations(values, { name: 'name', description: 'description' })).toEqual({
      en: { name: 'Pizza', description: 'Tomato' },
      ja: { name: 'ピザ' },
    })
    expect(pickEditorTranslations(values, { name: 'group:g1' })).toEqual({ en: { name: 'Size' } })
    expect(pickEditorTranslations(values, { name: 'option:none' })).toEqual({})
  })

  it('drops fields the owner cleared', () => {
    const values = { en: { name: '  ', description: 'Kept' } }
    expect(pickEditorTranslations(values, { name: 'name', description: 'description' })).toEqual({ en: { description: 'Kept' } })
  })
})
