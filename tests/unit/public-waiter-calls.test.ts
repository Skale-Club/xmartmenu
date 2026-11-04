import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { createPublicWaiterCall } from '@/lib/data/public-waiter-calls'
import { AdminMenuError } from '@/lib/data/admin-menus'

const tenantId = randomUUID(), tableId = randomUUID(), callId = randomUUID()
const state = vi.hoisted(() => ({ source: vi.fn(), owned: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: state.source }))
vi.mock('@/lib/data/public-waiter-calls-runtime', () => ({ createOwnedPublicWaiterCall: state.owned }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => '127.0.0.1' }))
vi.mock('@/lib/observability/with-api', () => ({ withApi: (_: string, handler: unknown) => handler }))
vi.mock('@/lib/observability/log', () => ({ log: { error: vi.fn(), info: vi.fn() } }))
import { POST } from '@/app/api/public/waiter-call/[slug]/route'

const fixture = (open = false) => vi.fn()
  .mockResolvedValueOnce({ rows: [{ id: tenantId }] })
  .mockResolvedValueOnce({ rows: [{ orders_enabled: true, table_management_enabled: true, direct_orders_enabled: false }] })
  .mockResolvedValueOnce({ rows: [{ status: 'active', features: ['orders'] }] })
  .mockResolvedValueOnce({ rows: [{ id: tableId, name: 'Table 1' }] })
  .mockResolvedValueOnce({ rows: open ? [{ id: callId }] : [] })
  .mockResolvedValueOnce({ rows: [{ id: callId }] })
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })

it('serializes creation on the tenant-scoped active table and inserts only trusted table metadata', async () => {
  const query = fixture()
  expect(await createPublicWaiterCall(query, 'restaurant', tableId, 'bill')).toEqual({ status: 201, body: { id: callId, repeated: false } })
  expect(query.mock.calls[3]).toEqual([expect.stringContaining('tenant_id=$2 AND is_active=true LIMIT 2 FOR UPDATE'), [tableId, tenantId]])
  expect(query.mock.calls[5][1]).toEqual([tenantId, tableId, 'Table 1', 'bill'])
})
it('reopens only a recent non-done call with the same tuple and clears its previous acknowledgment', async () => {
  const query = fixture(true), now = new Date('2026-11-04T20:00:00Z')
  expect(await createPublicWaiterCall(query, 'restaurant', tableId, 'unknown', now)).toEqual({ status: 200, body: { id: callId, repeated: true } })
  expect(query.mock.calls[4][0]).toContain("reason=$3 AND status<>'done' AND created_at>=$4")
  expect(query.mock.calls[4][1]).toEqual([tenantId, tableId, 'waiter', '2026-11-04T18:00:00.000Z'])
  expect(query.mock.calls[5][0]).toContain('acknowledged_at=NULL,acknowledged_by=NULL')
  expect(query.mock.calls[5][1]).toEqual([callId, tenantId, tableId, now.toISOString()])
})
it('refuses a revoked plan before touching tables or calls', async () => {
  const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: tenantId }] }).mockResolvedValueOnce({ rows: [{ orders_enabled: true, table_management_enabled: true }] }).mockResolvedValueOnce({ rows: [{ status: 'cancelled', features: ['orders', 'payments'] }] })
  await expect(createPublicWaiterCall(query, 'restaurant', tableId, 'bill')).rejects.toMatchObject({ status: 403 })
  expect(query).toHaveBeenCalledTimes(3)
})
it('rejects missing tenants or invalid tables without guessing a target', async () => {
  const query = vi.fn().mockResolvedValue({ rows: [] })
  await expect(createPublicWaiterCall(query, 'missing', tableId, 'bill')).rejects.toMatchObject({ status: 404 })
  query.mockClear()
  await expect(createPublicWaiterCall(query, 'restaurant', 'invalid', 'bill')).rejects.toMatchObject({ status: 400 })
  expect(query).not.toHaveBeenCalled()
})
const request = () => new Request('http://localhost/api/public/waiter-call/restaurant', { method: 'POST', body: JSON.stringify({ table_id: tableId, reason: 'bill', table_name: 'untrusted' }) })
const context = () => ({ params: Promise.resolve({ slug: 'restaurant' }) })
it('native route resolves before any source or source-backed plan reader', async () => {
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true'); state.owned.mockResolvedValue({ status: 201, body: { id: callId, repeated: false } })
  const response = await POST(request(), context())
  expect(response.status).toBe(201); expect(await response.json()).toEqual({ id: callId, repeated: false })
  expect(state.owned).toHaveBeenCalledWith('restaurant', tableId, 'bill'); expect(state.source).not.toHaveBeenCalled()
})
it('native rejection never falls back to a source mutation', async () => {
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true'); state.owned.mockRejectedValue(new AdminMenuError(503, 'Service information is unavailable'))
  expect((await POST(request(), context())).status).toBe(503); expect(state.source).not.toHaveBeenCalled()
})
