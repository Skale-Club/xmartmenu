import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { verifyPublicProject } from '@/lib/auth/public-project-proof'

const config = { projectId: 'identity-development', projectNumber: '123456789012', apiKey: randomUUID(), origin: 'http://localhost:3000' }
const domains = ['identity-development.firebaseapp.com', 'localhost']

describe('API key-to-project proof before mutable Firebase initialization', () => {
  it.each([config.projectId, config.projectNumber])('accepts the exact reviewed ID/number only with the expected default and origin domains (%s)', async projectId => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ projectId, authorizedDomains: domains })))
    await expect(verifyPublicProject(config, request)).resolves.toBeUndefined()
    const [url, init] = request.mock.calls[0]
    expect(url).toBe('https://identitytoolkit.googleapis.com/v1/projects')
    expect(String(url)).not.toContain(config.apiKey)
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error', headers: { 'X-Goog-Api-Key': config.apiKey } })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })
  it.each([
    {}, { projectId: config.projectId }, { projectId: 123456789012, authorizedDomains: domains },
    { projectId: 'skaleclub', authorizedDomains: domains }, { projectId: '937861185231', authorizedDomains: domains },
    { projectId: 'another-project', authorizedDomains: domains },
    { projectId: config.projectNumber, authorizedDomains: ['localhost'] },
    { projectId: config.projectNumber, authorizedDomains: ['identity-development.firebaseapp.com'] },
    { projectId: config.projectNumber, authorizedDomains: [123] },
  ])('denies missing, substituted or ambiguous project proof %j', async body => {
    await expect(verifyPublicProject(config, async () => new Response(JSON.stringify(body)))).rejects.toEqual(new Error('Identity project configuration could not be verified'))
  })
  it('does not accept a different API key project even when the expected domain was authorized there', async () => {
    await expect(verifyPublicProject(config, async () => new Response(JSON.stringify({ projectId: 'another-production-project', authorizedDomains: domains })))).rejects.toThrow()
  })
  it('sanitizes network/provider errors and bounds stalled reads', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(verifyPublicProject(config, async () => { throw new Error(config.apiKey) })).rejects.toEqual(new Error('Identity project configuration could not be verified'))
      await expect(verifyPublicProject(config, async () => new Response(config.apiKey, { status: 403 }))).rejects.toThrow('Identity project configuration could not be verified')
      expect(log).not.toHaveBeenCalled()
      vi.useFakeTimers()
      const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}))
      const result = expect(verifyPublicProject(config, request)).rejects.toThrow('Identity project configuration could not be verified')
      await vi.advanceTimersByTimeAsync(8_001)
      await result
      expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true)
    } finally { vi.useRealTimers(); log.mockRestore() }
  })
})
