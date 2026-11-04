import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AdminMenuError } from '@/lib/data/admin-menus'
const state = vi.hoisted(() => ({ effective: vi.fn(), principal: vi.fn(), source: vi.fn(), legacy: vi.fn(), settings: vi.fn(), save: vi.fn(), block: vi.fn(), thread: vi.fn(), status: vi.fn() }))
vi.mock('@/lib/get-effective-tenant', () => ({ getEffectiveTenant: state.effective }))
vi.mock('@/lib/auth/owned-principal-runtime', () => ({ getOwnedPrincipal: state.principal }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: state.source, createClient: state.legacy }))
vi.mock('@/lib/data/admin-chat-runtime', () => ({ readOwnedAdminChatSettings: state.settings, writeOwnedAdminChatSettings: state.save, blockOwnedAdminChatPhone: state.block, readOwnedAdminChatThread: state.thread, readOwnedChatAddonStatus: state.status }))
vi.mock('@/lib/observability/context', () => ({ getRequestContext: () => undefined }))
vi.mock('@/lib/observability/with-api', () => ({ withApi: (_: string, handler: unknown) => handler }))
vi.mock('@/lib/observability/log', () => ({ log: { error: vi.fn() } }))
import { GET, PUT } from '@/app/api/admin/chat-addon/settings/route'
import { POST as block } from '@/app/api/admin/chat-addon/conversations/[id]/block/route'
import { GET as thread } from '@/app/api/admin/chat-addon/conversations/[id]/route'
import { getChatAddonStatus } from '@/lib/chat-addon'
const tenantId = randomUUID(), actorId = randomUUID(), conversationId = randomUUID()
beforeEach(() => {
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true'); vi.stubEnv('OWNED_AUTH_ENABLED', 'true')
  state.effective.mockResolvedValue({ tenantId, role: 'store-admin' }); state.principal.mockResolvedValue({ userId: actorId, role: 'store-admin', tenantId, mustChangePassword: false })
})
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })
const params = () => ({ params: Promise.resolve({ id: conversationId }) })
it('native settings GET/PUT use the current principal context before any source client', async () => {
  state.settings.mockResolvedValue({ settings: null, status: { enabled: false } }); state.save.mockResolvedValue({ ok: true })
  expect((await GET(new Request('http://localhost/api/admin/chat-addon/settings'), undefined)).status).toBe(200)
  expect((await PUT(new Request('http://localhost/api/admin/chat-addon/settings', { method: 'PUT', body: JSON.stringify({ enabled: true }) }), undefined)).status).toBe(200)
  expect(state.save).toHaveBeenCalledWith({ tenantId, actorId, role: 'store-admin' }, { enabled: true }); expect(state.source).not.toHaveBeenCalled(); expect(state.legacy).not.toHaveBeenCalled()
})
it('native moderation attributes the verified profile UID and performs no legacy Auth getUser', async () => {
  state.block.mockResolvedValue({ ok: true })
  expect((await block(new Request('http://localhost/api/admin/chat-addon/conversations/id/block', { method: 'POST', body: JSON.stringify({ reason: 'spam' }) }), params())).status).toBe(200)
  expect(state.block).toHaveBeenCalledWith({ tenantId, actorId, role: 'store-admin' }, conversationId, { reason: 'spam' }); expect(state.legacy).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
})
it('native thread errors are terminal and do not switch to source reads', async () => {
  state.thread.mockRejectedValue(new AdminMenuError(404, 'Conversation not found'))
  expect((await thread(new Request('http://localhost'), params())).status).toBe(404); expect(state.source).not.toHaveBeenCalled()
})
it('shared addon status selects native reads so the unchanged inbox SSR also leaves Source', async () => {
  state.status.mockResolvedValue({ available: true, active: true, enabled: true, overrideApplied: false })
  expect(await getChatAddonStatus(tenantId)).toMatchObject({ available: true, enabled: true }); expect(state.status).toHaveBeenCalledWith(tenantId); expect(state.source).not.toHaveBeenCalled()
})
it('a denied owned principal prevents native mutation and every legacy fallback', async () => {
  state.principal.mockResolvedValue(null)
  expect((await block(new Request('http://localhost', { method: 'POST', body: '{}' }), params())).status).toBe(401)
  expect(state.block).not.toHaveBeenCalled(); expect(state.legacy).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
})
