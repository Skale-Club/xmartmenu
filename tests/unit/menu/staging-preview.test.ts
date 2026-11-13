import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { resolveTenantCapabilities } from '@/lib/service-modes'
import { asStagingPreview, loadStagingPreview, previewCapabilities, PREVIEW_TOKEN } from '@/lib/menu/staging-preview'
import { mutateMenuStaging, newPreviewToken, suffixedSlug } from '@/lib/data/menu-staging'
import type { AdminMenuQuery } from '@/lib/data/admin-menus'

const full = resolveTenantCapabilities(['payments', 'orders'], {
  orders_enabled: true, direct_orders_enabled: true, table_management_enabled: true, delivery_enabled: true, pickup_enabled: true,
  tips_enabled: true, item_notes_enabled: true, ingredient_customization_enabled: true, whatsapp_orders_enabled: true, whatsapp: '+1 555 0100',
} as never)

describe('menu staging preview', () => {
  it('is browse-only: nothing a reviewer does reaches the kitchen, the waiters or WhatsApp', () => {
    expect(full.guestOrdering).toBe(true)
    const preview = previewCapabilities(full)
    for (const key of ['guestOrdering', 'waiterOrdering', 'waiterCalls', 'whatsappOrders', 'tips', 'dineIn', 'pickup', 'delivery', 'upsell', 'itemNotes'] as const) {
      expect(preview[key]).toBe(false)
    }
    expect(preview.showcase).toBe(true)
    // What the dish looks like stays: ingredients shown, plan ceiling unchanged.
    expect(preview.ingredientCustomization).toBe(full.ingredientCustomization)
    expect(preview.plan).toEqual(full.plan)
  })

  it('turns analytics, chat and delivery zones off without touching the dishes', () => {
    const data = {
      tenant: { id: 't', slug: 's', tenant_settings: { analytics_enabled: true, primary_color: '#123456' } },
      footerBrand: 'Xprout', menu: { id: 'm' }, location: null, categories: [{ id: 'c' }], products: [{ id: 'p' }],
      capabilities: full, optionGroupsByProductId: {}, productIngredientsByProductId: {}, productMediaByProductId: {},
      productArModelByProductId: { p: { product_id: 'p', glb_url: 'https://cdn.example/p.glb' } },
      deliveryZones: [{ id: 'z' }], chatAddonEnabled: true, chatAddonAudioEnabled: true, chatAddonTextEnabled: true,
    }
    const preview = asStagingPreview(data as never) as typeof data
    expect(preview.tenant.tenant_settings).toEqual({ analytics_enabled: false, primary_color: '#123456' })
    expect(data.tenant.tenant_settings.analytics_enabled).toBe(true) // not mutated
    expect(preview.chatAddonEnabled || preview.chatAddonAudioEnabled || preview.chatAddonTextEnabled).toBe(false)
    expect(preview.deliveryZones).toEqual([])
    expect(preview.products).toBe(data.products)
    expect(preview.productArModelByProductId).toBe(data.productArModelByProductId)
  })

  it('refuses malformed tokens and the legacy source before any read', async () => {
    expect(PREVIEW_TOKEN.test(newPreviewToken())).toBe(true)
    expect(newPreviewToken()).not.toBe(newPreviewToken())
    expect(PREVIEW_TOKEN.test("' OR true --")).toBe(false)
    expect(PREVIEW_TOKEN.test('short')).toBe(false)
    expect(await loadStagingPreview('slug', 'short')).toEqual({ kind: 'not_found' })
    // OWNED_PUBLIC_MENU_ENABLED is not set in unit tests: legacy source, no staging.
    expect(await loadStagingPreview('slug', newPreviewToken())).toEqual({ kind: 'not_found' })
  })
})

describe('menu staging writer', () => {
  it('keeps suffixed slugs readable and inside the column', () => {
    expect(suffixedSlug('main', 'staging-abc')).toBe('main-staging-abc')
    const long = suffixedSlug('x'.repeat(400), 'v123')
    expect(long.length).toBeLessThanOrEqual(180)
    expect(long.endsWith('-v123')).toBe(true)
  })

  it('denies staff and foreign scopes before any query, and refuses before the schema step', async () => {
    const calls: string[] = []
    const query: AdminMenuQuery = async text => { calls.push(text); return { rows: [{ n: 0 }] } }
    await expect(mutateMenuStaging(query, { tenantId: randomUUID(), role: 'store-staff' }, { kind: 'create', liveId: randomUUID() })).rejects.toMatchObject({ status: 403 })
    await expect(mutateMenuStaging(query, { tenantId: 'not-a-uuid', role: 'store-admin' }, { kind: 'create', liveId: randomUUID() })).rejects.toMatchObject({ status: 403 })
    expect(calls).toEqual([])
    await expect(mutateMenuStaging(query, { tenantId: randomUUID(), role: 'store-admin' }, { kind: 'publish', id: randomUUID() })).rejects.toMatchObject({ status: 503 })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('information_schema.columns')
  })
})
