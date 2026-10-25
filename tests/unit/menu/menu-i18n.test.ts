import { describe, expect, it } from 'vitest'
import {
  MENU_LANGUAGES,
  MENU_LANGUAGE_CODES,
  fill,
  formatClock,
  formatMoney,
  formatWeekday,
  getMenuCopy,
  itemsLabel,
  localeFor,
  matchDeviceLanguage,
  menuLanguage,
  translateTag,
} from '@/components/menu/menu-i18n'
import { computeOpenState } from '@/lib/chat-context'

const english = getMenuCopy('en')
const KEYS = Object.keys(english) as Array<keyof typeof english>

describe('menu copy', () => {
  it('has every key, non-empty, in every offered language', () => {
    for (const { code } of MENU_LANGUAGES) {
      const copy = getMenuCopy(code)
      expect(copy, code).toBeDefined()
      for (const key of KEYS) {
        if (key === 'itemsFew') continue
        const value = copy[key]
        expect(typeof value === 'string' && value.trim().length > 0, `${code}.${key}`).toBe(true)
      }
    }
  })

  it('keeps every placeholder of the English text', () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort()
    for (const { code } of MENU_LANGUAGES) {
      const copy = getMenuCopy(code)
      for (const key of KEYS) {
        const base = english[key]
        if (typeof base !== 'string') continue
        expect(placeholders(copy[key] as string), `${code}.${key}`).toEqual(placeholders(base))
      }
    }
  })

  it('is really translated, not English copied over', () => {
    for (const { code } of MENU_LANGUAGES.filter(l => l.code !== 'en')) {
      const copy = getMenuCopy(code)
      expect(copy.viewOrder, code).not.toBe(english.viewOrder)
      expect(copy.checkout, code).not.toBe(english.checkout)
      expect(copy.placeOrder, code).not.toBe(english.placeOrder)
    }
  })

  it('falls back to English for unknown languages', () => {
    expect(getMenuCopy('xx')).toBe(english)
    expect(getMenuCopy(null)).toBe(english)
    expect(menuLanguage('xx').code).toBe('en')
  })

  it('lists each language once, with a locale and native name', () => {
    expect(new Set(MENU_LANGUAGE_CODES).size).toBe(MENU_LANGUAGES.length)
    expect(menuLanguage('ja').nativeName).toBe('日本語')
    expect(localeFor('zh-TW')).toBe('zh-TW')
    expect(localeFor('pt')).toBe('pt-BR')
  })
})

describe('matchDeviceLanguage', () => {
  it("picks the phone's language when the menu offers it", () => {
    expect(matchDeviceLanguage(['ja-JP', 'en-US'], ['en', 'ja'])).toBe('ja')
    expect(matchDeviceLanguage(['pt-BR'], ['en', 'pt'])).toBe('pt')
    expect(matchDeviceLanguage(['fr-FR', 'es-ES'], ['en', 'es'])).toBe('es')
  })

  it('tells simplified and traditional Chinese apart', () => {
    expect(matchDeviceLanguage(['zh-Hant-TW'], ['zh', 'zh-TW'])).toBe('zh-TW')
    expect(matchDeviceLanguage(['zh-HK'], ['zh', 'zh-TW'])).toBe('zh-TW')
    expect(matchDeviceLanguage(['zh-CN'], ['zh', 'zh-TW'])).toBe('zh')
    expect(matchDeviceLanguage(['zh-Hans'], ['en', 'zh-TW'])).toBeNull()
  })

  it('returns null when nothing matches', () => {
    expect(matchDeviceLanguage(['de-DE'], ['en', 'pt'])).toBeNull()
    expect(matchDeviceLanguage([], ['en'])).toBeNull()
  })
})

describe('formatting', () => {
  // Intl separates currency and amount with a no-break space.
  const plain = (text: string) => text.replace(/[  ]/g, ' ')

  it("formats prices in the restaurant's currency with the guest's conventions", () => {
    expect(plain(formatMoney(78, 'BRL', 'pt'))).toBe('R$ 78,00')
    expect(plain(formatMoney(78, 'BRL', 'en'))).toBe('R$78.00')
    expect(plain(formatMoney(1234.5, 'USD', 'en'))).toBe('$1,234.50')
    expect(formatMoney(1234.5, 'USD', 'de')).toMatch(/1\.234,50/)
    expect(formatMoney(1500, 'JPY', 'ja')).toMatch(/1,500/)
  })

  it('formats times and weekdays for the guest', () => {
    expect(formatClock(23 * 60, 'pt')).toBe('23:00')
    expect(plain(formatClock(23 * 60, 'en'))).toMatch(/11:00 ?PM/)
    expect(plain(formatClock(9 * 60, 'en'))).toMatch(/^9:00 ?AM$/)
    expect(formatClock(1440, 'pt')).toBe('00:00')
    expect(formatClock(9 * 60 + 5, 'de')).toBe('09:05')
    expect(formatWeekday(1, 'pt')).toBe('segunda-feira')
    expect(formatWeekday(0, 'en')).toBe('Sunday')
    expect(formatWeekday(6, 'ja')).toBe('土曜日')
  })

  it('uses the plural rules of each language', () => {
    expect(itemsLabel(getMenuCopy('pt'), 1, 'pt')).toBe('1 item')
    expect(itemsLabel(getMenuCopy('pt'), 3, 'pt')).toBe('3 itens')
    expect(itemsLabel(getMenuCopy('ru'), 2, 'ru')).toBe('2 позиции')
    expect(itemsLabel(getMenuCopy('ru'), 5, 'ru')).toBe('5 позиций')
    expect(itemsLabel(getMenuCopy('pl'), 4, 'pl')).toBe('4 pozycje')
    expect(itemsLabel(getMenuCopy('ja'), 3, 'ja')).toBe('3点')
  })

  it('fills placeholders and leaves unknown ones visible', () => {
    expect(fill('Open until {time}', { time: '23:00' })).toBe('Open until 23:00')
    expect(fill('{a} and {b}', { a: 1 })).toBe('1 and {b}')
  })

  it('translates the standard dish tags and keeps free-text ones', () => {
    expect(translateTag('Gluten-Free', 'pt')).toBe('Sem glúten')
    expect(translateTag('Vegan', 'ja')).toBe('ヴィーガン')
    expect(translateTag('Da casa', 'en')).toBe('Da casa')
  })
})

describe('computeOpenState', () => {
  const SP = 'America/Sao_Paulo' // UTC-3; 2026-10-24 is a Saturday
  const hours = { sat: '12:00 - 00:00', sun: '12:00 - 22:00', mon: '11:00 - 23:00' }

  it('gives the closing time as data while open', () => {
    expect(computeOpenState(hours, new Date('2026-10-24T17:00:00Z'), SP)).toEqual({
      state: { kind: 'open', closesAt: 0 },
      localTime: 'Saturday 14:00',
      todayIndex: 6,
    })
  })

  it('gives the next opening as data while closed', () => {
    expect(computeOpenState(hours, new Date('2026-10-24T13:00:00Z'), SP).state)
      .toEqual({ kind: 'closed', opens: { inDays: 0, dayIndex: 6, minutes: 720 }, nextText: null })
    expect(computeOpenState({ mon: '11:00 - 23:00' }, new Date('2026-10-24T17:00:00Z'), SP).state)
      .toEqual({ kind: 'closed', opens: { inDays: 2, dayIndex: 1, minutes: 660 }, nextText: null })
  })

  it('reports why it cannot tell', () => {
    expect(computeOpenState(hours, new Date(), null).state).toEqual({ kind: 'unknown', reason: 'no-timezone', text: null })
    expect(computeOpenState(null, new Date(), SP).state).toEqual({ kind: 'unknown', reason: 'no-hours', text: null })
  })
})
