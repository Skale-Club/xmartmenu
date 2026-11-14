import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import React, { type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { randomUUID } from 'node:crypto'
import { checkoutTheme } from '@/lib/payments/checkout-theme'
import { contrastRatio } from '@/lib/color-utils'
import { OwnedPaymentRepository } from '@/lib/data/payments'

const mocks = vi.hoisted(() => ({ checkout: vi.fn(), enabled: vi.fn(), intent: vi.fn(), stripe: vi.fn(), legacy: vi.fn(), elements: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: mocks.legacy }))
vi.mock('@/lib/data/payments-runtime', () => ({ loadOwnedPaymentCheckout: mocks.checkout, ownedStripeEnabled: mocks.enabled }))
vi.mock('@/lib/stripe', () => ({ getOrCreatePaymentIntent: mocks.intent, isStripeEnabled: vi.fn(), stripe: {}, retrieveOwnedPaymentIntent: vi.fn() }))
vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn(() => Promise.resolve(null)) }))
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: (props: { children: React.ReactNode; options: unknown }) => { mocks.elements(props.options); return props.children },
  useStripe: () => ({}), useElements: () => ({}), PaymentElement: () => null,
}))
import CheckoutPage from '@/app/(public)/checkout/[orderId]/page'
import ConfirmationPage from '@/app/(public)/checkout/[orderId]/confirmation/page'

beforeEach(() => {
  vi.stubEnv('OWNED_PAYMENT_DATA_ENABLED', 'true')
  mocks.enabled.mockResolvedValue(true)
  mocks.intent.mockResolvedValue({ clientSecret: 'offline-fixture-secret' })
})

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

describe('restaurant payment theme', () => {
  it.each([
    ['#184D3B', '#E94560'], ['#F5D662', '#2A9D8F'],
  ])('keeps tenant %s primary through Stripe, pay action and confirmation', async (primary, accent) => {
    const order = { id: randomUUID(), tenant_id: randomUUID(), status: 'awaiting_payment', total: 12.5, tip_cents: 0,
      currency: 'usd', payment_intent_id: null, order_items: [],
      tenants: { slug: 'fixture', name: 'Fixture', tenant_settings: { currency: 'usd', primary_color: primary, accent_color: accent } } }
    mocks.checkout.mockResolvedValue(order)
    const theme = checkoutTheme(order.tenants)
    expect(theme.primary).toBe(primary)
    expect(theme.accent).toBe(accent)
    expect(contrastRatio(theme.onPrimary, primary)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(theme.accentText, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    const page = await CheckoutPage({ params: Promise.resolve({ orderId: order.id }) })
    const html = renderToStaticMarkup(page as ReactElement)
    expect(html).toContain(`background-color:${primary}`)
    expect(html).toContain(`color:${theme.onPrimary}`)
    expect(html).not.toMatch(/635BFF|indigo-/i)
    expect(mocks.elements).toHaveBeenLastCalledWith(expect.objectContaining({ appearance: expect.objectContaining({ variables: expect.objectContaining({ colorPrimary: primary, accessibleColorOnColorPrimary: theme.onPrimary }) }) }))
    expect(mocks.intent).toHaveBeenLastCalledWith({ tenantId: order.tenant_id, orderId: order.id, amountDollars: 12.5, tipCents: 0, currency: 'usd' })
    mocks.checkout.mockResolvedValue({ ...order, status: 'paid' })
    const confirmation = renderToStaticMarkup(await ConfirmationPage({ params: Promise.resolve({ orderId: order.id }) }) as ReactElement)
    expect(confirmation).toContain(`background-color:${primary}`)
    expect(confirmation).toContain('Return to Menu')
  })

  it('loads legacy embedded palette fields without replacing the tenant colour', async () => {
    vi.stubEnv('OWNED_PAYMENT_DATA_ENABLED', 'false')
    const order = { id: randomUUID(), status: 'paid', total: 12.5, tenants: { slug: 'legacy-fixture', name: 'Fixture',
      tenant_settings: { currency: 'usd', primary_color: '#F5D662', accent_color: '#2A9D8F' } } }
    const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: order }) }
    chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain)
    mocks.legacy.mockReturnValue({ from: vi.fn().mockReturnValue(chain) })
    const html = renderToStaticMarkup(await ConfirmationPage({ params: Promise.resolve({ orderId: order.id }) }) as ReactElement)
    expect(chain.select).toHaveBeenCalledWith('*, tenants(slug, name, tenant_settings(currency, primary_color, accent_color))')
    expect(html).toContain('background-color:#F5D662')
    expect(html).not.toMatch(/635BFF|indigo-/i)
    expect(mocks.intent).not.toHaveBeenCalled()
  })

  it('normalizes embedded settings and uses a safe fallback without a tenant', () => {
    expect(checkoutTheme([{ tenant_settings: [{ primary_color: '#184D3B', accent_color: '#E94560' }] }]).primary).toBe('#184D3B')
    expect(checkoutTheme(null).primary).toBe('#283F32')
    expect(checkoutTheme({ tenant_settings: { primary_color: 'url(unsafe)' } }).primary).toBe('#283F32')
  })

  it('projects owned checkout colours from the order tenant without altering money', async () => {
    const id = randomUUID(), tenant = randomUUID()
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id, tenant_id: tenant, status: 'paid', total: '12.50', currency: 'eur' }] })
      .mockResolvedValueOnce({ rows: [{ slug: 'fixture', name: 'Fixture', currency: 'eur', primary_color: '#184D3B', accent_color: '#E94560' }] })
      .mockResolvedValueOnce({ rows: [] })
    const result = await new OwnedPaymentRepository(query).checkout(id)
    expect(query.mock.calls[1]).toEqual([expect.stringContaining('s.primary_color,s.accent_color'), [tenant]])
    expect(result?.tenants.tenant_settings).toEqual({ currency: 'eur', primary_color: '#184D3B', accent_color: '#E94560' })
    expect(result?.total).toBe('12.50')
  })
})
