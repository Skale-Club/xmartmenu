import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { recordPublicScan } from '@/lib/data/public-scans'
import { AdminMenuError } from '@/lib/data/admin-menus'

const state = vi.hoisted(() => ({ source: vi.fn(), owned: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: state.source }))
vi.mock('@/lib/data/public-scans-runtime', () => ({ recordOwnedPublicScan: state.owned }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => '127.0.0.1' }))
import { POST } from '@/app/api/public/scan/route'

afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })
const request = (id: string) => new Request('http://localhost/api/public/scan', { method: 'POST', body: JSON.stringify({ tenant_id: id, qr_code_id: randomUUID(), scanned_at: 'untrusted' }) })

it('inserts only the active tenant ID through a bound parameter, leaving event metadata to defaults', async () => {
  const query = vi.fn().mockResolvedValue({ rows: [{ id: randomUUID() }] }), id = randomUUID()
  expect(await recordPublicScan(query, id)).toEqual({ ok: true })
  expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE id=$1 AND is_active=true RETURNING id'), [id])
  expect(query.mock.calls[0][0]).toContain('INSERT INTO public.scan_events(tenant_id)')
  expect(query.mock.calls[0][0]).not.toContain(id)
})
it('refuses absent/inactive tenants and malformed IDs without inventing scans', async () => {
  const query = vi.fn().mockResolvedValue({ rows: [] })
  await expect(recordPublicScan(query, randomUUID())).rejects.toMatchObject({ status: 404 })
  query.mockClear()
  await expect(recordPublicScan(query, "invalid' OR true")).rejects.toMatchObject({ status: 404 })
  await expect(recordPublicScan(query, '')).rejects.toMatchObject({ status: 400 })
  expect(query).not.toHaveBeenCalled()
})
it('selects native recording before creating a source client and forwards only tenant ID', async () => {
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true'); state.owned.mockResolvedValue({ ok: true })
  const id = randomUUID(), response = await POST(request(id))
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true })
  expect(state.owned).toHaveBeenCalledWith(id); expect(state.source).not.toHaveBeenCalled()
})
it('does not report success or fall back after a failed native transaction', async () => {
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true'); state.owned.mockRejectedValue(new AdminMenuError(503, 'Unavailable'))
  expect((await POST(request(randomUUID()))).status).toBe(503)
  expect(state.source).not.toHaveBeenCalled()
})
it('keeps the source lookup and distinct insert when the flag is absent', async () => {
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', '')
  const id = randomUUID(), single = vi.fn().mockResolvedValue({ data: { id } }), insert = vi.fn().mockResolvedValue({ error: null })
  const chain = { select: vi.fn(), eq: vi.fn(), single }; chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain)
  const from = vi.fn((table: string) => table === 'tenants' ? chain : { insert })
  state.source.mockResolvedValue({ from })
  expect((await POST(request(id))).status).toBe(200)
  expect(chain.eq).toHaveBeenCalledWith('is_active', true); expect(insert).toHaveBeenCalledWith({ tenant_id: id })
  expect(state.owned).not.toHaveBeenCalled()
})
