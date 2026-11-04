import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { readAdminChatSettings, writeAdminChatSettings, readAdminChatThread, type AdminChatContext } from '@/lib/data/admin-chat'
const state = vi.hoisted(() => ({ principal: vi.fn(), legacy: vi.fn(), context: vi.fn() }))
vi.mock('@/lib/auth/owned-principal-runtime', () => ({ getOwnedPrincipal: state.principal }))
vi.mock('@/lib/supabase/server', () => ({ createClient: state.legacy }))
vi.mock('@/lib/observability/context', () => ({ getRequestContext: state.context }))
import { adminChatContext } from '@/lib/admin/chat-context'
const tenantId = randomUUID(), actorId = randomUUID(), context: AdminChatContext = { tenantId, actorId, role: 'store-admin' }
const profile = { id: actorId, role: 'store-admin', tenant_id: tenantId, must_change_password: false, disabled_at: null }
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })
it('SSR native context resolves the current verified principal without relying on API log context or legacy Auth', async () => {
  vi.stubEnv('OWNED_AUTH_ENABLED', 'true'); state.context.mockReturnValue(undefined); state.principal.mockResolvedValue({ userId: actorId, role: 'store-admin', tenantId, mustChangePassword: false })
  expect(await adminChatContext(context)).toEqual(context); expect(state.legacy).not.toHaveBeenCalled()
})
it('native principal denial/mismatch is terminal and never falls back to legacy Auth', async () => {
  vi.stubEnv('OWNED_AUTH_ENABLED', 'true')
  for (const principal of [null, { userId: actorId, role: 'store-admin', tenantId: randomUUID() }, { userId: actorId, role: 'store-staff', tenantId }]) {
    state.principal.mockResolvedValue(principal); await expect(adminChatContext(context)).rejects.toMatchObject({ status: 401 })
  }
  expect(state.legacy).not.toHaveBeenCalled()
})
it('configuration reads use a fixed projection excluding both encrypted-key columns', async () => {
  const query = vi.fn().mockResolvedValueOnce({ rows: [profile] }).mockResolvedValueOnce({ rows: [{ enabled: true }] }).mockResolvedValueOnce({ rows: [{ chat_addon_active: true, chat_addon_available: true }] }).mockResolvedValueOnce({ rows: [{ enabled: true }] })
  expect(await readAdminChatSettings(query, context)).toMatchObject({ settings: { enabled: true }, status: { enabled: true } })
  expect(query.mock.calls[1][0]).not.toMatch(/openrouter_api_key|audio_api_key|SELECT \*/)
  expect(query.mock.calls[1][1]).toEqual([tenantId])
})
it('settings writes clamp the limit, use fixed fields and ignore supplied credentials/tenant IDs', async () => {
  const query = vi.fn().mockResolvedValueOnce({ rows: [profile] }).mockResolvedValue({ rows: [] })
  await writeAdminChatSettings(query, context, { enabled: true, rate_limit_per_phone_per_day: 999.5, tenant_id: randomUUID(), openrouter_api_key: 'excluded', audio_api_key: 'excluded' })
  const [sql, values] = query.mock.calls[1]
  expect(sql).toContain('ON CONFLICT(tenant_id)'); expect(sql).not.toMatch(/openrouter_api_key|audio_api_key/); expect(values[0]).toBe(tenantId); expect(values).toContain(500); expect(values).not.toContain('excluded')
})
it('current SQL role/account/tenant controls supersede a stale caller context', async () => {
  for (const row of [{ ...profile, role: 'customer' }, { ...profile, tenant_id: randomUUID() }, { ...profile, disabled_at: new Date() }, { ...profile, must_change_password: true }]) {
    const query = vi.fn().mockResolvedValue({ rows: [row] })
    await expect(writeAdminChatSettings(query, context, {})).rejects.toMatchObject({ status: 403 }); expect(query).toHaveBeenCalledTimes(1)
  }
})
it('foreign conversation identity stops thread reads before any message projection', async () => {
  const query = vi.fn().mockResolvedValueOnce({ rows: [profile] }).mockResolvedValueOnce({ rows: [] })
  await expect(readAdminChatThread(query, context, randomUUID())).rejects.toMatchObject({ status: 404 }); expect(query).toHaveBeenCalledTimes(2)
  expect(query.mock.calls[1][1][1]).toBe(tenantId)
})
