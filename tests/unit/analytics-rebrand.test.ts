import { afterEach, describe, expect, it, vi } from 'vitest'
import { MenuAnalyticsTracker } from '@/lib/analytics/client'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('analytics session namespace transition', () => {
  it('continues an active pre-rebrand session and writes it under the new name', () => {
    vi.useFakeTimers()
    const id = '11111111-1111-4111-8111-111111111111'
    const data = new Map([['xmartmenu:analytics:tenant:menu:-:live', JSON.stringify({ id, lastSeenAt: Date.now() })]])
    vi.stubGlobal('window', {
      sessionStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } },
      matchMedia: () => ({ matches: false }), addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const tracker = new MenuAnalyticsTracker({ tenantId: 'tenant', menuId: 'menu' })
    expect(tracker.sessionId).toBe(id)
    expect(tracker.isNewSession).toBe(false)
    expect(JSON.parse(data.get('xprout:analytics:tenant:menu:-:live')!).id).toBe(id)
    tracker.destroy()
  })
})
