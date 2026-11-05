import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ service: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: mocks.service }))
vi.mock('@/lib/observability/log', () => ({ log: { error: mocks.error, warn: vi.fn(), info: vi.fn() } }))

import { recordTrustedOrderAnalyticsEvent } from '@/lib/analytics/server'

const id = '11111111-1111-4111-8111-111111111111'

describe('recordTrustedOrderAnalyticsEvent (legacy path guard, M10)', () => {
  beforeEach(() => {
    mocks.service.mockReset(); mocks.error.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

  for (const flag of ['OWNED_ORDER_DATA_ENABLED', 'OWNED_AUTH_ENABLED']) {
    it(`${flag}=true never builds the Supabase client and leaves a searchable error`, async () => {
      vi.stubEnv(flag, 'true')
      mocks.service.mockImplementation(() => { throw new Error('Legacy client must not be used in owned mode') })
      await recordTrustedOrderAnalyticsEvent(id, 'order_completed')
      expect(mocks.service).not.toHaveBeenCalled()
      expect(mocks.error).toHaveBeenCalledWith('analytics.order_event_legacy_path_in_owned_mode', { order_id: id, event_name: 'order_completed' })
      expect(console.error).not.toHaveBeenCalled()
    })
  }

  it('keeps the legacy behaviour when no owned flag is on', async () => {
    vi.stubEnv('OWNED_ORDER_DATA_ENABLED', 'false'); vi.stubEnv('OWNED_AUTH_ENABLED', 'false')
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const maybeSingle = vi.fn()
      .mockResolvedValueOnce({ data: { id, tenant_id: 't', total: '12.50', analytics_session_id: 's' }, error: null })
      .mockResolvedValueOnce({ data: { id: 's', tenant_id: 't', menu_id: 'm', location_id: null }, error: null })
    const chain: Record<string, unknown> = { select: () => chain, eq: () => chain, maybeSingle }
    mocks.service.mockReturnValue({ from: (table: string) => (table === 'menu_events' ? { upsert } : chain) })
    await recordTrustedOrderAnalyticsEvent(id, 'order_created')
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][0]).toMatchObject({ server_event_key: `order:${id}:order_created`, event_name: 'order_created', amount: 12.5 })
    expect(mocks.error).not.toHaveBeenCalled()
  })
})
