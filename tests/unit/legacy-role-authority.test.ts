import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), event: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: state.client, createServiceClient: state.service }))
vi.mock('@/lib/observability', () => ({ captureSecurityEvent: state.event }))
vi.mock('@/lib/site-url', () => ({ getRequestOrigin: (request: Request) => new URL(request.url).origin }))
const id = randomUUID()
let upsert: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.stubEnv('SUPERADMIN_EMAILS', 'owner@example.test')
  upsert = vi.fn()
  const user = { id, email: 'owner@example.test' }
  state.client.mockResolvedValue({ auth: { exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }), getUser: vi.fn().mockResolvedValue({ data: { user } }) } })
  state.service.mockReturnValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { role: 'customer' } }), upsert }) })
})
afterEach(() => vi.unstubAllEnvs())

it('legacy OAuth callback neither promotes nor redirects by configured email', async () => {
  const { GET } = await import('@/app/auth/callback/route')
  const result = await GET(new Request('https://fixture.test/auth/callback?code=fixture'))
  expect(result.headers.get('location')).toBe('https://fixture.test/')
  expect(upsert).not.toHaveBeenCalled(); expect(state.event).not.toHaveBeenCalled()
})

it('legacy MCP gate denies configured email without a canonical superadmin profile', async () => {
  const { verifyMcpToken } = await import('@/lib/mcp/verify-token')
  expect(await verifyMcpToken(new Request('https://fixture.test/api/mcp'),'fixture-token')).toBeUndefined()
  expect(upsert).not.toHaveBeenCalled()
})

it('legacy MCP gate preserves access for the verified immutable UID and canonical role', async () => {
  const service = state.service()
  service.from.mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { role: 'superadmin' } }) })
  const { verifyMcpToken } = await import('@/lib/mcp/verify-token')
  expect(await verifyMcpToken(new Request('https://fixture.test/api/mcp'),'fixture-token')).toMatchObject({ clientId: id, scopes: ['mcp:admin'] })
})
