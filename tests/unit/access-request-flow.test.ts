import { describe, expect, it } from 'vitest'
import { ACCESS_REQUEST_STEPS, REQUIRED_STEPS, submitSchema, saveDraftSchema, type AccessRequestAnswers } from '@/lib/access-requests/contract'
import { STRINGS } from '@/components/access-request/strings'
import {
  buildSubmitPayload, cleanAnswers, detectLanguage, detectRegion, pickRestore, stepFilled, stepIndexOf, validateStep,
} from '@/components/access-request/survey-state'

const full: AccessRequestAnswers = {
  language: 'pt', businessName: ' Casa Verde ', businessType: 'other', businessTypeOther: 'Quiosque', location: 'Miami, FL, USA',
  contactPhone: '+5511999998888', contactEmail: '', interests: ['qr_menu'], socialUrl: '',
}

describe('access request survey state', () => {
  it('blocks Continue on every required step until answered', () => {
    for (const step of REQUIRED_STEPS) expect(validateStep(step, {}), step).toBe('required')
    expect(validateStep('businessType', { businessType: 'other' })).toBe('required')
    expect(validateStep('contact', { contactPhone: 'abc' })).toBe('phone')
    expect(validateStep('contact', { contactPhone: '+5511999998888', contactEmail: 'nope' })).toBe('email')
    expect(validateStep('contact', { contactPhone: '+5511999998888' })).toBeNull()
  })

  it('lets optional steps be skipped and tells filled from empty', () => {
    for (const step of ACCESS_REQUEST_STEPS.filter(s => !REQUIRED_STEPS.includes(s))) {
      expect(validateStep(step, {}), step).toBeNull()
      expect(stepFilled(step, {}), step).toBe(false)
    }
    expect(stepFilled('interests', { interests: ['ai_chat'] })).toBe(true)
  })

  it('restore prefers the newer source', () => {
    const server = { step: 'location' as const, answers: { businessName: 'Server' }, savedAt: 100 }
    const local = { step: 'businessName' as const, answers: { businessName: 'Local' }, savedAt: 200 }
    expect(pickRestore(server, local)?.answers.businessName).toBe('Local')
    expect(pickRestore(server, { ...local, savedAt: 50 })?.answers.businessName).toBe('Server')
    // Server has no timestamp: the copy further along wins, a tie goes to the server.
    expect(pickRestore({ ...server, savedAt: null }, local)?.answers.businessName).toBe('Server')
    expect(pickRestore({ step: 'language', answers: { language: 'en' }, savedAt: null }, { ...local, step: 'contact' })?.answers.businessName).toBe('Local')
    expect(pickRestore({ step: 'language', answers: {}, savedAt: null }, local)?.answers.businessName).toBe('Local')
    expect(pickRestore(null, null)).toBeNull()
  })

  it('builds a payload the server schema accepts', () => {
    const payload = buildSubmitPayload(full, false)
    expect(submitSchema.safeParse(payload).success).toBe(true)
    expect(payload.answers.businessName).toBe('Casa Verde')
    expect(payload.answers).not.toHaveProperty('contactEmail')
    expect(payload.whatsappOptIn).toBe(false)
    expect(cleanAnswers({ ...full, businessType: 'bar' })).not.toHaveProperty('businessTypeOther')
  })

  it('autosave body matches the draft schema', () => {
    expect(saveDraftSchema.safeParse({ step: 'contact', answers: cleanAnswers({ language: 'es', contactEmail: '  ' }) }).success).toBe(true)
  })

  it('detects language, region and steps', () => {
    expect(detectLanguage('pt-BR')).toBe('pt'); expect(detectLanguage('fr')).toBe('en')
    expect(detectRegion('pt-BR')).toBe('BR'); expect(detectRegion('en')).toBeNull()
    expect(stepIndexOf('done')).toBe(ACCESS_REQUEST_STEPS.length - 1); expect(stepIndexOf('bogus')).toBe(0)
  })

  it('has complete strings in all three languages', () => {
    for (const lang of ['en', 'pt', 'es'] as const) {
      const t = STRINGS[lang]
      for (const step of ACCESS_REQUEST_STEPS) expect(t.steps[step].title, `${lang}.${step}`).toBeTruthy()
      for (const b of ['restaurant', 'bar', 'cafe', 'bakery', 'pizzeria', 'food_truck', 'hotel', 'other']) expect(t.businessTypes[b]).toBeTruthy()
      for (const k of ['qr_menu', 'table_ordering', 'takeout_delivery', 'ai_chat', 'ar_dishes', 'website_domain', 'multi_language']) expect(t.interests[k]).toBeTruthy()
      for (const k of ['1', '2-5', '6+']) expect(t.locations[k]).toBeTruthy()
      for (const k of ['printed', 'pdf_qr', 'other_app', 'none']) expect(t.currentMenus[k]).toBeTruthy()
      for (const k of ['up_to_30', '30_80', '80_plus']) expect(t.menuSizes[k]).toBeTruthy()
      for (const k of ['morning', 'afternoon', 'evening']) expect(t.contactTimes[k]).toBeTruthy()
    }
  })
})
