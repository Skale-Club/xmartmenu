import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ effective: vi.fn(), store: vi.fn(), service: vi.fn(), domain: vi.fn(), verified: vi.fn() }))
vi.mock('@/lib/get-effective-tenant', () => ({ getEffectiveTenant: mocks.effective }))
vi.mock('@/lib/data/admin-store-settings-runtime', () => ({
  mutateOwnedStoreSettings: mocks.store,
  mutateOwnedServiceSettings: mocks.service,
  mutateOwnedCustomDomain: mocks.domain,
  markOwnedCustomDomainVerified: mocks.verified,
}))

import { ownedCustomDomainHttp, ownedCustomDomainVerificationHttp, ownedServiceSettingsHttp, ownedStoreSettingsHttp } from '@/lib/admin/owned-store-settings-http'
import { LockedServiceSettingsError } from '@/lib/data/admin-store-settings'

const tenantId = '1d8f5270-73e3-42ee-95f0-b849c26dbb4d'
const request = (method: string, path: string, body?: unknown, origin = 'https://menu.example.test') => new Request(`https://menu.example.test${path}`, {
  method,
  headers: { host: 'menu.example.test', origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

beforeEach(() => {
  mocks.effective.mockResolvedValue({ tenantId, role: 'store-admin' })
  mocks.store.mockResolvedValue({ settings: { currency: 'USD' }, capabilities: {} })
  mocks.service.mockResolvedValue({ settings: { orders_enabled: true }, capabilities: {} })
  mocks.domain.mockResolvedValue({ custom_domain: 'shop.example.test', custom_domain_verified: false })
  mocks.verified.mockResolvedValue({ custom_domain: 'shop.example.test', custom_domain_verified: true })
})
afterEach(() => vi.resetAllMocks())

describe('owned Store settings HTTP boundary', () => {
  it('requires same-origin owner mutations and derives tenant identity from the session', async () => {
    expect((await ownedStoreSettingsHttp(request('PATCH', '/api/admin/store-settings', { currency: 'USD' }, 'https://evil.test'))).status).toBe(403)
    expect(mocks.store).not.toHaveBeenCalled()
    const response = await ownedStoreSettingsHttp(request('PATCH', '/api/admin/store-settings', { currency: 'USD' }))
    expect(response.status).toBe(200)
    expect(mocks.store).toHaveBeenCalledWith({ tenantId, role: 'store-admin' }, { currency: 'USD' })
  })

  it('returns the locked service keys used by the Store UI', async () => {
    mocks.service.mockRejectedValueOnce(new LockedServiceSettingsError(['delivery_enabled']))
    const response = await ownedServiceSettingsHttp(request('PATCH', '/api/admin/service-settings', { delivery_enabled: true }))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: 'Not included in your plan', locked: ['delivery_enabled'] })
  })

  it('cannot update another tenant domain and only marks a verified domain after server DNS validation', async () => {
    expect((await ownedCustomDomainHttp(request('PATCH', `/api/admin/tenants/${tenantId}`, { custom_domain: 'shop.example.test' }), 'other-tenant')).status).toBe(403)
    const saved = await ownedCustomDomainHttp(request('PATCH', `/api/admin/tenants/${tenantId}`, { custom_domain: 'shop.example.test' }), tenantId)
    expect(saved.status).toBe(200)
    const verified = await ownedCustomDomainVerificationHttp(request('POST', `/api/admin/tenants/${tenantId}/verify-domain`), tenantId, 'shop.example.test', 'CNAME matches platform host')
    expect(verified.status).toBe(200)
    expect(mocks.verified).toHaveBeenCalledWith({ tenantId, role: 'store-admin' }, tenantId, 'shop.example.test', true)
  })
})
