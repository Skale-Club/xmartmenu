import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

const mocks = vi.hoisted(() => ({
  effective: vi.fn(), service: vi.fn(), capabilities: vi.fn(), mutate: vi.fn(), readMenuPage: vi.fn(),
}))
vi.mock('@/lib/get-effective-tenant', () => ({ getEffectiveTenant: mocks.effective }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: mocks.service, createClient: mocks.service }))
vi.mock('@/lib/tenant-plan', () => ({ getTenantCapabilities: mocks.capabilities }))
vi.mock('@/lib/data/admin-display-settings-runtime', () => ({
  mutateOwnedDisplaySettings: mocks.mutate,
  readOwnedMenuDisplayPage: mocks.readMenuPage,
}))
vi.mock('@/lib/observability/with-api', () => ({ withApi: (_name: string, handler: unknown) => handler }))
vi.mock('@/lib/observability/log', () => ({ log: { error: vi.fn() } }))
vi.mock('@/app/(admin)/settings/menu-display/MenuDisplayClient', () => ({ default: () => null }))

import { PATCH as menuDisplayPATCH } from '@/app/api/admin/analytics/settings/route'
import MenuDisplayPage from '@/app/(admin)/settings/menu-display/page'

const tenantId = randomUUID()
const menuSettings = {
  analytics_enabled: true,
  visual_feed_enabled: true,
  menu_default_view: 'list',
  feed_autoplay_videos: true,
  upsell_enabled: true,
}

beforeEach(() => {
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true')
  mocks.effective.mockResolvedValue({ tenantId, role: 'store-admin', slug: 'restaurant' })
  mocks.service.mockImplementation(() => { throw new Error('Supabase must not be used for owned display settings') })
  mocks.capabilities.mockImplementation(() => { throw new Error('Legacy plan lookup must not be used for owned display settings') })
  mocks.readMenuPage.mockResolvedValue({ settings: menuSettings, upsellAvailable: true })
  mocks.mutate.mockResolvedValue({ ...menuSettings })
})
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })

describe('owned menu display setting source', () => {
  it('renders settings and plan ceiling from owned SQL without constructing Supabase', async () => {
    await MenuDisplayPage()
    expect(mocks.readMenuPage).toHaveBeenCalledWith({ tenantId, role: 'store-admin' })
    expect(mocks.service).not.toHaveBeenCalled()
    expect(mocks.capabilities).not.toHaveBeenCalled()
  })

  it('routes upsell writes through owned SQL without the legacy SDK or plan helper', async () => {
    const request = new Request('https://menu.example.test/api/admin/analytics/settings', {
      method: 'PATCH',
      headers: { host: 'menu.example.test', origin: 'https://menu.example.test', 'content-type': 'application/json' },
      body: JSON.stringify({
        analytics_enabled: true,
        visual_feed_enabled: true,
        menu_default_view: 'list',
        feed_autoplay_videos: true,
        upsell_enabled: true,
      }),
    })
    const response = await menuDisplayPATCH(request, undefined)
    expect(response.status).toBe(200)
    expect(mocks.mutate).toHaveBeenCalledWith({ tenantId, role: 'store-admin' }, 'menu-display', {
      analytics_enabled: true,
      visual_feed_enabled: true,
      menu_default_view: 'list',
      feed_autoplay_videos: true,
      upsell_enabled: true,
    })
    expect(mocks.service).not.toHaveBeenCalled()
    expect(mocks.capabilities).not.toHaveBeenCalled()
  })
})
