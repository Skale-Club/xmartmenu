import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createLegacyOwnerReader } from '@/lib/auth/legacy-account-proof'

const config = { url: 'https://legacy-account.example.test', anonKey: randomUUID() }

describe('bounded online legacy account ownership', () => {
  it('requests only the current user and returns the exact UID, never profile contacts', async () => {
    const id = randomUUID(); const token = randomUUID()
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id, email: 'hint@example.test', user_metadata: { id: 'different-id', role: 'superadmin' } })))
    expect(await createLegacyOwnerReader(config, request)(token)).toBe(id)
    const [url, init] = request.mock.calls[0]
    expect(String(url)).toBe('https://legacy-account.example.test/auth/v1/user')
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store', headers: { Authorization: `Bearer ${token}`, apikey: config.anonKey } })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('denies provider rejection, malformed responses and transport errors without logging credentials', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const response of [new Response('{}', { status: 401 }), new Response('{}'), new Response('{"email":"hint@example.test"}')]) {
        expect(await createLegacyOwnerReader(config, async () => response)(randomUUID())).toBe(null)
      }
      expect(await createLegacyOwnerReader(config, async () => { throw new Error(randomUUID()) })(randomUUID())).toBe(null)
      expect(log).not.toHaveBeenCalled()
    } finally { log.mockRestore() }
  })

  it('times out a stalled lookup even when the transport ignores cancellation', async () => {
    vi.useFakeTimers()
    try {
      const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}))
      const pending = createLegacyOwnerReader(config, request)(randomUUID())
      await vi.advanceTimersByTimeAsync(8_001)
      expect(await pending).toBe(null)
      expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true)
    } finally { vi.useRealTimers() }
  })

  it('preserves caller cancellation and never follows redirects', async () => {
    const controller = new AbortController()
    const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}))
    const pending = createLegacyOwnerReader(config, request)(randomUUID(), controller.signal)
    controller.abort()
    expect(await pending).toBe(null)
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(request.mock.calls[0][1]?.redirect).toBe('error')
    const alreadyAborted = vi.fn<typeof fetch>()
    expect(await createLegacyOwnerReader(config, alreadyAborted)(randomUUID(), controller.signal)).toBe(null)
    expect(alreadyAborted).not.toHaveBeenCalled()
  })
})
