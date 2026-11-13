import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ limit: vi.fn(), storage: vi.fn(), respond: vi.fn() }))
vi.mock('@/lib/storage', () => ({ getStorageClient: () => ({ getPublicUrl: mocks.storage }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.limit, getClientIp: () => 'test-client' }))
vi.mock('@/lib/ar/scaled-model-response', () => ({ scaledModelResponse: mocks.respond }))
import { GET } from '@/app/api/ar/scaled-model/route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.limit.mockResolvedValue({ ok: true })
  mocks.storage.mockReturnValue('https://images.example/')
  mocks.respond.mockResolvedValue(new Response('model'))
})

describe('public scaled-model route admission', () => {
  it('uses the configured storage prefix after client and shared rate limits', async () => {
    const request = new Request('https://menu.example/api/ar/scaled-model')
    expect((await GET(request)).status).toBe(200)
    expect(mocks.limit.mock.calls).toEqual([
      ['ar-scaled-model', 'test-client', 30, '1 m'], ['ar-scaled-model-global', 'all', 60, '1 m'],
    ])
    expect(mocks.respond).toHaveBeenCalledExactlyOnceWith(request, 'https://images.example/')
  })
  it.each([1, 2])('rejects rate limit %s without reading storage or downloading', async denied => {
    if (denied === 1) mocks.limit.mockResolvedValueOnce({ ok: false })
    else mocks.limit.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false })
    const result = await GET(new Request('https://menu.example/api/ar/scaled-model'))
    expect(result.status).toBe(429)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(mocks.storage).not.toHaveBeenCalled()
    expect(mocks.respond).not.toHaveBeenCalled()
  })
  it('fails closed when the storage provider is unavailable', async () => {
    mocks.storage.mockImplementationOnce(() => { throw new Error('private configuration') })
    const result = await GET(new Request('https://menu.example/api/ar/scaled-model'))
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain('private configuration')
    expect(mocks.respond).not.toHaveBeenCalled()
  })
})
