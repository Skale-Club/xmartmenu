/**
 * A restaurant on its own verified domain (EX-05): the menu at "/", its pages
 * under the root, platform routes (orders, checkout) reaching their handlers,
 * and the canonical domain indexable by default.
 */
import { expect, test } from '@playwright/test'

const HOST = 'menu.test-domain.test'
const headers = { host: HOST }

test.describe('custom domain', () => {
  test('"/" is the restaurant menu', async ({ request }) => {
    const response = await request.get('/', { headers })
    expect(response.status()).toBe(200)
    const html = await response.text()
    expect(html).toContain('Domain Burger')
    // Its canonical is the custom domain, and it is not noindexed for having one.
    expect(html).toContain(`https://${HOST}`)
    expect(html).not.toMatch(/<meta name="robots" content="noindex/)
  })

  test('a menu slug under the root resolves', async ({ request }) => {
    const response = await request.get('/main', { headers })
    expect(response.status()).toBe(200)
    expect(await response.text()).toContain('Domain Burger')
  })

  test('POST /api/orders reaches the order handler, not a tenant 404', async ({ request }) => {
    const response = await request.post('/api/orders', { headers, data: {} })
    // The handler validates the (empty) body: a JSON 400, not the rewritten 404 page.
    expect(response.status()).toBe(400)
    expect(response.headers()['content-type']).toContain('application/json')
  })

  test('checkout keeps its global path', async ({ request }) => {
    const response = await request.get('/checkout/00000000-0000-4000-8000-000000000000', { headers })
    expect(response.status()).toBe(200)
    expect(await response.text()).toContain('Order Not Found')
  })

  test('robots.txt on the custom domain allows indexing', async ({ request }) => {
    const body = await (await request.get('/robots.txt', { headers })).text()
    expect(body).toContain('Allow: /')
  })
})
