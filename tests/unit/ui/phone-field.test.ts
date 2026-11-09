import { describe, expect, it } from 'vitest'
import { phoneFieldDisplay, phoneFieldValue } from '@/components/ui/PhoneField'

describe('PhoneField value', () => {
  it('stores a complete local number as E.164 for the chosen country', () => {
    expect(phoneFieldValue('(11) 99999-8888', 'BR')).toBe('+5511999998888')
    expect(phoneFieldValue('(330) 313-0832', 'US')).toBe('+13303130832')
  })

  it('keeps an incomplete number with its calling code instead of guessing', () => {
    expect(phoneFieldValue('7911', 'GB')).toBe('+44 7911')
    expect(phoneFieldValue('   ', 'BR')).toBe('')
  })

  it('shows a stored number in its own country, formatted the local way', () => {
    expect(phoneFieldDisplay('+5511999998888', 'US')).toEqual({ country: 'BR', display: '(11) 99999-8888' })
    expect(phoneFieldDisplay('+13303130832', 'BR')).toEqual({ country: 'US', display: '(330) 313-0832' })
  })

  it('round-trips an incomplete number typed in the restaurant country', () => {
    expect(phoneFieldDisplay('+44 7911', 'GB')).toEqual({ country: 'GB', display: '7911' })
    expect(phoneFieldDisplay('11 9999', 'BR')).toEqual({ country: 'BR', display: '11 9999' })
  })
})

describe('phone placeholder', () => {
  it('shows a local example for the chosen country', async () => {
    const { phonePlaceholder } = await import('@/components/ui/PhoneField')
    expect(phonePlaceholder('US')).toBe('(201) 555-0123')
    expect(phonePlaceholder('BR')).toBe('(11) 96123-4567')
  })
})

describe('phone ghost', () => {
  it('shows the rest of the example while the typed part keeps its shape', async () => {
    const { phoneGhost } = await import('@/components/ui/PhoneField')
    expect(phoneGhost('(11) 9', '(11) 96123-4567')).toBe('6123-4567')
    expect(phoneGhost('(330) 3', '(201) 555-0123')).toBe('55-0123')
    expect(phoneGhost('', '(201) 555-0123')).toBe('')
    expect(phoneGhost('+44 7', '(201) 555-0123')).toBe('')
    expect(phoneGhost('(201) 555-0123', '(201) 555-0123')).toBe('')
  })
})
