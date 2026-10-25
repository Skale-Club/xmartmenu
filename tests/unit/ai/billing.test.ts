import { beforeAll, describe, expect, it, vi } from 'vitest'

// The pure helpers live next to server code; keep the server side out.
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => { throw new Error('no database in unit tests') } }))
vi.mock('@/lib/stripe', () => ({ stripe: {} }))

import {
  chargeFor,
  clampMarkup,
  invoiceAmountMinor,
  isKeyRejection,
  parseBillingMode,
  planAiAccess,
  type AiFeature,
} from '@/lib/ai/billing-rules'
import { subscriptionIdFromInvoice, usageLineDescription } from '@/lib/ai/billing'
import { isMaskedKey, nextStoredKey, startOfMonthIso, verifyOpenRouterKey } from '@/lib/ai/settings-service'
import { decryptApiKey } from '@/lib/crypto'
import { keyCheckMessage } from '@/lib/ai/labels'

const base = {
  feature: 'chat' as AiFeature,
  tenantId: 'tenant-1',
  tenantMode: null,
  tenantKey: null,
  tenantMarkupPct: null,
  platformKey: 'sk-platform',
  defaultMode: 'platform' as const,
  defaultMarkupPct: 30,
}

describe('planAiAccess', () => {
  it('own key: client key first, not billed; platform key as billed fallback', () => {
    const plan = planAiAccess({ ...base, tenantMode: 'own_key', tenantKey: 'sk-client' })
    expect(plan?.primary).toEqual({ apiKey: 'sk-client', keySource: 'tenant', billable: false, markupPct: 0 })
    expect(plan?.fallback).toEqual({ apiKey: 'sk-platform', keySource: 'platform', billable: true, markupPct: 30 })
  })

  it('own key without a key saved yet: platform key, billed', () => {
    const plan = planAiAccess({ ...base, tenantMode: 'own_key' })
    expect(plan?.primary).toMatchObject({ keySource: 'platform', billable: true })
    expect(plan?.fallback).toBeNull()
  })

  it('own key with no global key: client key and no fallback', () => {
    const plan = planAiAccess({ ...base, tenantMode: 'own_key', tenantKey: 'sk-client', platformKey: null })
    expect(plan?.primary.keySource).toBe('tenant')
    expect(plan?.fallback).toBeNull()
  })

  it('platform mode: billed with the client margin when set', () => {
    const plan = planAiAccess({ ...base, tenantMode: 'platform', tenantMarkupPct: 50 })
    expect(plan?.primary).toEqual({ apiKey: 'sk-platform', keySource: 'platform', billable: true, markupPct: 50 })
  })

  it('included: platform key, never billed', () => {
    const plan = planAiAccess({ ...base, tenantMode: 'included', tenantKey: 'sk-client' })
    expect(plan?.primary).toMatchObject({ keySource: 'platform', billable: false, markupPct: 0 })
  })

  it('follows the platform default when the client has no mode', () => {
    expect(planAiAccess({ ...base, defaultMode: 'included' })?.primary.billable).toBe(false)
    expect(planAiAccess({ ...base, defaultMode: 'own_key', tenantKey: 'sk-client' })?.primary.keySource).toBe('tenant')
  })

  it('superadmin work for a client (seed, OCR, images) is never billed and ignores the client key', () => {
    for (const feature of ['seed', 'ocr', 'seed_image'] as AiFeature[]) {
      const plan = planAiAccess({ ...base, feature, tenantMode: 'own_key', tenantKey: 'sk-client' })
      expect(plan?.primary).toMatchObject({ keySource: 'platform', billable: false })
    }
  })

  it('platform features with no client are not billed', () => {
    expect(planAiAccess({ ...base, feature: 'blog', tenantId: null })?.primary).toMatchObject({ keySource: 'platform', billable: false })
  })

  it('null when no key can serve the call', () => {
    expect(planAiAccess({ ...base, platformKey: null })).toBeNull()
    expect(planAiAccess({ ...base, tenantMode: 'included', platformKey: null })).toBeNull()
  })
})

describe('money', () => {
  it('charge = cost + margin, only when billable', () => {
    expect(chargeFor(0.002, true, 30)).toBeCloseTo(0.0026, 10)
    expect(chargeFor(0.002, false, 30)).toBe(0)
    expect(chargeFor(0, true, 30)).toBe(0)
    expect(chargeFor(Number.NaN, true, 30)).toBe(0)
  })

  it('margin is clamped to 0–1000%', () => {
    expect(clampMarkup(-5)).toBe(0)
    expect(clampMarkup(5000)).toBe(1000)
    expect(clampMarkup(Number.NaN)).toBe(0)
  })

  it('invoice amount converts to BRL cents with the panel rate', () => {
    expect(invoiceAmountMinor(1.3, 'brl', 5.5)).toBe(715)
    expect(invoiceAmountMinor(1.3, 'BRL', 5.5)).toBe(715)
    expect(invoiceAmountMinor(1.3, 'usd', 5.5)).toBe(130)
    expect(invoiceAmountMinor(0.0001, 'brl', 5.5)).toBe(0)
  })

  it('401/402/403 mean the key cannot pay; other errors do not switch keys', () => {
    expect([401, 402, 403].every(isKeyRejection)).toBe(true)
    expect([400, 429, 500, null, undefined].some(isKeyRejection)).toBe(false)
  })

  it('parses billing modes', () => {
    expect(parseBillingMode('own_key')).toBe('own_key')
    expect(parseBillingMode('free')).toBeNull()
    expect(parseBillingMode(null)).toBeNull()
  })
})

describe('Stripe invoice helpers', () => {
  it('finds the subscription across API shapes', () => {
    expect(subscriptionIdFromInvoice({ subscription: 'sub_1' })).toBe('sub_1')
    expect(subscriptionIdFromInvoice({ parent: { subscription_details: { subscription: 'sub_2' } } })).toBe('sub_2')
    expect(subscriptionIdFromInvoice({ lines: { data: [{ parent: null }, { parent: { subscription_item_details: { subscription: 'sub_3' } } }] } })).toBe('sub_3')
    expect(subscriptionIdFromInvoice({})).toBeNull()
  })

  it('describes the AI line in Portuguese with the amount', () => {
    const text = usageLineDescription({ events: 12, costUsd: 1, chargeUsd: 1.3, amountMinor: 715, currency: 'brl', until: new Date('2026-10-25T12:00:00Z') })
    expect(text).toContain('12 chamadas')
    expect(text).toContain('25/10/2026')
    expect(text).toMatch(/R\$\s?7,15/)
  })
})

describe('key settings', () => {
  beforeAll(() => {
    process.env.CHAT_ADDON_ENCRYPTION_KEY = '0'.repeat(64)
  })

  it('masked value keeps, empty removes, new value is encrypted', () => {
    expect(isMaskedKey('sk-o••••••••abcd')).toBe(true)
    expect(nextStoredKey(undefined)).toBeUndefined()
    expect(nextStoredKey('sk-o••••••••abcd')).toBeUndefined()
    expect(nextStoredKey(42)).toBeUndefined()
    expect(nextStoredKey(null)).toBeNull()
    expect(nextStoredKey('   ')).toBeNull()
    const stored = nextStoredKey('  sk-or-v1-new  ')
    expect(stored).toBeTruthy()
    expect(stored).not.toContain('sk-or')
    expect(decryptApiKey(stored as string)).toBe('sk-or-v1-new')
  })

  it('verifies a key against OpenRouter /key', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ data: { label: 'prod', limit_remaining: 12.5 } }), { status: 200 }))
    const result = await verifyOpenRouterKey('sk-good', ok as unknown as typeof fetch)
    expect(result).toEqual({ ok: true, status: 200, label: 'prod', limitRemaining: 12.5 })
    expect(String((ok.mock.calls[0] as unknown[])[0])).toMatch(/\/key$/)
    expect(keyCheckMessage(result)).toBe('Key works · label "prod" · US$ 12.50 left on its limit')

    const bad = vi.fn(async () => new Response('{}', { status: 401 }))
    expect(await verifyOpenRouterKey('sk-bad', bad as unknown as typeof fetch)).toMatchObject({ ok: false, status: 401, error: 'Invalid key' })

    const down = vi.fn(async () => { throw new Error('ECONNREFUSED') })
    expect(await verifyOpenRouterKey('sk-x', down as unknown as typeof fetch)).toMatchObject({ ok: false, error: 'ECONNREFUSED' })
  })

  it('month starts at day 1, UTC', () => {
    expect(startOfMonthIso(new Date('2026-10-25T15:00:00Z'))).toBe('2026-10-01T00:00:00.000Z')
  })
})
