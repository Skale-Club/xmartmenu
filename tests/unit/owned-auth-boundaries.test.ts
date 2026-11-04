import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ server: vi.fn(), service: vi.fn(), cookies: vi.fn() }))
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.server }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.service }))
vi.mock('next/headers', () => ({ cookies: mocks.cookies }))
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.stubEnv('OWNED_AUTH_ENABLED', 'true') })
afterEach(() => vi.unstubAllEnvs())

it('fails closed before constructing any legacy server or service client', async () => {
  const { createClient, createServiceClient } = await import('@/lib/supabase/server')
  await expect(createClient()).rejects.toThrow('temporarily unavailable')
  expect(() => createServiceClient()).toThrow('temporarily unavailable')
  expect(mocks.cookies).not.toHaveBeenCalled(); expect(mocks.server).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled()
})

it('bypasses legacy refresh in owned mode while preserving custom-domain rewrite', async () => {
  const { updateSession } = await import('@/lib/supabase/middleware')
  const request = new NextRequest('https://xmartmenu.test/dashboard')
  const response = await updateSession(request)
  expect(response.headers.get('x-middleware-next')).toBe('1')
  const rewrite = await updateSession(request, new URL('https://xmartmenu.test/fixture/menu'))
  expect(rewrite.headers.get('x-middleware-rewrite')).toBe('https://xmartmenu.test/fixture/menu')
  expect(mocks.server).not.toHaveBeenCalled()
})

it('keeps both legacy client factories functional when explicitly off', async () => {
  vi.stubEnv('OWNED_AUTH_ENABLED', 'false')
  mocks.cookies.mockResolvedValue({ getAll: () => [], set: vi.fn() })
  mocks.server.mockReturnValue({ legacy: true }); mocks.service.mockReturnValue({ service: true })
  const { createClient, createServiceClient } = await import('@/lib/supabase/server')
  expect(await createClient()).toEqual({ legacy: true }); expect(createServiceClient()).toEqual({ service: true })
})
