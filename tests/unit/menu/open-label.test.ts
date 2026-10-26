import { describe, expect, it } from 'vitest'
import { computeOpenState } from '@/lib/chat-context'
import { describeOpenState, menuTimeZone } from '@/components/menu/open-label'
import { getMenuCopy } from '@/components/menu/menu-i18n'
import { getGuestCopy } from '@/components/menu/guest-copy'

const NY = 'America/New_York' // 2026-10-24 is a Saturday; 17:00Z = 13:00 local
const SAT_AFTERNOON = new Date('2026-10-24T17:00:00Z')
const en = getMenuCopy('en')
const guestEn = getGuestCopy('en')

function label(hours: Record<string, string>, now = SAT_AFTERNOON, lang = 'en') {
  return describeOpenState(computeOpenState(hours, now, NY).state, getMenuCopy(lang), getGuestCopy(lang), lang)
}

describe('open badge with free-text hours', () => {
  it('shows today\'s free text as written instead of nothing', () => {
    const hours = { sat: 'Pickup by confirmation', sun: 'Pickup by confirmation' }
    expect(computeOpenState(hours, SAT_AFTERNOON, NY).state).toEqual({ kind: 'unknown', reason: 'free-text', text: 'Pickup by confirmation' })
    expect(label(hours)).toEqual({ text: 'Today: Pickup by confirmation', tone: 'info' })
    expect(label(hours, SAT_AFTERNOON, 'pt')).toEqual({ text: 'Hoje: Pickup by confirmation', tone: 'info' })
  })

  it('says "Closed" with the next day\'s free text instead of a bare "Closed"', () => {
    const hours = { sat: 'Closed', sun: 'Pickup by confirmation' }
    expect(label(hours)).toEqual({ text: 'Closed · Sunday: Pickup by confirmation', tone: 'closed' })
  })

  it('keeps the regular open / closed wording', () => {
    expect(label({ sat: '09:00 - 18:00' })).toEqual({ text: 'Open until 6:00 PM', tone: 'open' })
    expect(label({ sat: '15:00 - 18:00' })).toEqual({ text: 'Closed · opens at 3:00 PM', tone: 'closed' })
    expect(describeOpenState({ kind: 'closed', opens: null, nextText: null }, en, guestEn, 'en')).toEqual({ text: 'Closed', tone: 'closed' })
  })

  it('shows nothing when it cannot tell', () => {
    expect(describeOpenState({ kind: 'unknown', reason: 'no-hours', text: null }, en, guestEn, 'en')).toBeNull()
    expect(describeOpenState({ kind: 'unknown', reason: 'free-text', text: '  ' }, en, guestEn, 'en')).toBeNull()
  })
})

describe('menuTimeZone', () => {
  it('prefers the restaurant profile, then the guest device', () => {
    expect(menuTimeZone('America/Sao_Paulo', 'Europe/Lisbon')).toBe('America/Sao_Paulo')
    expect(menuTimeZone(null, 'Europe/Lisbon')).toBe('Europe/Lisbon')
    expect(menuTimeZone(null, 'Not/AZone')).toBeNull()
    expect(menuTimeZone(null, undefined)).toBeNull()
  })
})
