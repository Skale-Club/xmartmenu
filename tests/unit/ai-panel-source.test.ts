import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AdminMenuError } from '@/lib/data/admin-menus'
const state = vi.hoisted(() => ({ effective: vi.fn(), superadmin: vi.fn(), source: vi.fn(), context: vi.fn(), tenantPayload: vi.fn(), globalPayload: vi.fn(), tenantWrite: vi.fn(), globalWrite: vi.fn(), assert: vi.fn(), usage: vi.fn(), unbilled: vi.fn() }))
vi.mock('@/lib/get-effective-tenant', () => ({ getEffectiveTenant: state.effective }))
vi.mock('@/lib/superadmin-auth', () => ({ assertSuperadmin: state.superadmin }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: state.source }))
vi.mock('@/lib/admin/chat-context', async () => ({ adminChatContext: state.context, adminChatError: (error: unknown) => new Response('{}', { status: error instanceof AdminMenuError ? error.status : 503 }) }))
vi.mock('@/lib/data/ai-panel-runtime', () => ({ assertOwnedAiActor: state.assert, writeOwnedAiTenantSettings: state.tenantWrite, writeOwnedAiPlatformSettings: state.globalWrite, readOwnedAiUsageSummary: state.usage, readOwnedAiUnbilledCharge: state.unbilled }))
vi.mock('@/lib/ai/native-panel', () => ({ nativeAiTenantPayload: state.tenantPayload, nativeAiGlobalPayload: state.globalPayload }))
vi.mock('@/lib/ai/access', () => ({ loadPlatformAiSettings: vi.fn(), loadTenantAiSettings: vi.fn() }))
vi.mock('@/lib/ai/billing', () => ({ billAiUsage: vi.fn() }))
vi.mock('@/lib/observability/with-api', () => ({ withApi: (_: string, handler: unknown) => handler }))
import { GET as ownerGet, PUT as ownerPut } from '@/app/api/admin/ai/route'
import { GET as globalGet, PUT as globalPut } from '@/app/api/superadmin/ai/settings/route'
import { GET as tenantGet } from '@/app/api/superadmin/tenants/[id]/ai/route'
import { usageByTenant, unbilledChargeUsd } from '@/lib/ai/settings-service'
const tenantId = randomUUID(), actorId = randomUUID(), context = { tenantId, actorId, role: 'store-admin' }
beforeEach(() => { vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true'); state.effective.mockResolvedValue(context); state.context.mockResolvedValue(context); state.superadmin.mockResolvedValue({ mode: 'owned', principal: { userId: actorId, role: 'superadmin' } }); state.tenantPayload.mockResolvedValue({ openrouter_api_key: 'aaaa••••bbbb' }); state.globalPayload.mockResolvedValue({ settings: {} }) })
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })
it('owner GET/PUT select native masked payload and scoped writes without Source clients', async () => {
  expect((await ownerGet(new Request('http://localhost/api/admin/ai'), undefined)).status).toBe(200)
  expect((await ownerPut(new Request('http://localhost/api/admin/ai', { method: 'PUT', body: '{}' }), undefined)).status).toBe(200)
  expect(state.tenantWrite).toHaveBeenCalledWith(context, {}, true); expect(state.source).not.toHaveBeenCalled()
})
it('superadmin global/tenant panels carry verified actor UID and no fabricated global tenant', async () => {
  expect((await globalGet(new Request('http://localhost/api/superadmin/ai/settings'), undefined)).status).toBe(200)
  expect((await globalPut(new Request('http://localhost/api/superadmin/ai/settings', { method: 'PUT', body: '{}' }), undefined)).status).toBe(200)
  expect(state.globalWrite).toHaveBeenCalledWith({ actorId, role: 'superadmin' }, {})
  expect((await tenantGet(new Request('http://localhost'), { params: Promise.resolve({ id: tenantId }) })).status).toBe(200)
  expect(state.tenantPayload).toHaveBeenCalledWith({ actorId, tenantId, role: 'superadmin' }, true); expect(state.source).not.toHaveBeenCalled()
})
it('native SQL rejection is terminal and leaves the Source factory unused', async () => {
  state.tenantWrite.mockRejectedValue(new AdminMenuError(403, 'Forbidden'))
  expect((await ownerPut(new Request('http://localhost', { method: 'PUT', body: '{}' }), undefined)).status).toBe(403); expect(state.source).not.toHaveBeenCalled()
})
it('shared usage/unbilled helpers select native aggregation and do not instantiate row-limited Source queries', async () => {
  state.usage.mockResolvedValue(new Map()); state.unbilled.mockResolvedValue(0.13)
  expect(await usageByTenant('2026-11-01', tenantId)).toEqual(new Map()); expect(await unbilledChargeUsd(tenantId)).toBe(0.13)
  expect(state.usage).toHaveBeenCalledWith('2026-11-01', tenantId); expect(state.source).not.toHaveBeenCalled()
})
