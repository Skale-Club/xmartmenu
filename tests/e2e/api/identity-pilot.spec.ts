import { expect, test } from '@playwright/test'

test.describe('identity pilot disabled by default', () => {
  test('API does not activate provider credentials, browser challenges or sessions', async ({ request }) => {
    for (const operation of ['config', 'session']) {
      const response = await request.get(`/api/identity/${operation}`)
      expect(response.status()).toBe(404)
      expect(response.headers()['cache-control']).toBe('no-store')
      expect(response.headers()['set-cookie'] ?? '').not.toContain('xm_identity')
    }
    const response = await request.post('/api/identity/challenge', { data: {} })
    expect(response.status()).toBe(404)
    expect(response.headers()['set-cookie'] ?? '').not.toContain('xm_identity')
  })

  test('the phone and Google page stays unavailable until explicitly enabled', async ({ request }) => {
    const response = await request.get('/identity')
    expect(response.status()).toBe(404)
  })
})
