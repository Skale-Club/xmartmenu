import { describe, expect, it } from 'vitest'
import { ACCESS_REQUEST_STEPS, approveSchema, saveDraftSchema, submitSchema } from '@/lib/access-requests/contract'

const answers = { language: 'pt', businessName: 'Cantina Bela', businessType: 'restaurant', location: 'Orlando, FL', contactPhone: '+1 407 555 0100' }

describe('access request contract', () => {
  it('accepts a submission with the required answers only', () => {
    expect(submitSchema.safeParse({ answers, whatsappOptIn: false }).success).toBe(true)
  })
  it.each(['language', 'businessName', 'businessType', 'location', 'contactPhone'])('requires %s', key => {
    const rest: Record<string, string> = { ...answers }
    delete rest[key]
    expect(submitSchema.safeParse({ answers: rest, whatsappOptIn: true }).success).toBe(false)
  })
  it('requires the WhatsApp opt-in flag and rejects bad contact data', () => {
    expect(submitSchema.safeParse({ answers }).success).toBe(false)
    expect(submitSchema.safeParse({ answers: { ...answers, contactPhone: 'abc' }, whatsappOptIn: true }).success).toBe(false)
    expect(submitSchema.safeParse({ answers: { ...answers, contactEmail: 'nope' }, whatsappOptIn: true }).success).toBe(false)
  })
  it('rejects unknown keys everywhere', () => {
    expect(submitSchema.safeParse({ answers: { ...answers, tenant_id: 'x' }, whatsappOptIn: true }).success).toBe(false)
    expect(submitSchema.safeParse({ answers, whatsappOptIn: true, extra: 1 }).success).toBe(false)
    expect(saveDraftSchema.safeParse({ step: 'language', answers: { admin: true } }).success).toBe(false)
    expect(saveDraftSchema.safeParse({ step: 'language', answers: {}, extra: 1 }).success).toBe(false)
  })
  it('limits draft steps to the known enum', () => {
    for (const step of ACCESS_REQUEST_STEPS) expect(saveDraftSchema.safeParse({ step, answers: {} }).success).toBe(true)
    expect(saveDraftSchema.safeParse({ step: 'done', answers: {} }).success).toBe(false)
    expect(saveDraftSchema.safeParse({ step: 'nope', answers: {} }).success).toBe(false)
  })
  it('discriminates approve by mode', () => {
    const id = '5b0f9a3e-1d2c-4b6a-8e7f-0a1b2c3d4e5f'
    expect(approveSchema.safeParse({ mode: 'new', name: 'Cantina', slug: 'cantina', plan_id: id }).success).toBe(true)
    expect(approveSchema.safeParse({ mode: 'existing', tenant_id: id }).success).toBe(true)
    expect(approveSchema.safeParse({ mode: 'new', name: 'Cantina', slug: 'cantina' }).success).toBe(false)
    expect(approveSchema.safeParse({ mode: 'existing', tenant_id: 'bad' }).success).toBe(false)
    expect(approveSchema.safeParse({ mode: 'existing', tenant_id: id, name: 'x' }).success).toBe(false)
    expect(approveSchema.safeParse({ mode: 'other' }).success).toBe(false)
  })
})
