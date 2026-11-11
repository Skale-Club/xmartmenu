/**
 * The menu staging preview: /<slug>/preview/<token> (docs/product/menu-staging.md).
 *
 * Anyone holding the link sees the hidden staging copy exactly as guests will
 * see it after the publish (same dishes, photos, 3D models, prices and
 * languages), but as a showcase: no cart, checkout, waiter calls, WhatsApp
 * orders or chat, and no analytics, so a review never creates an order, a
 * call or a visit in the restaurant's numbers. The order API refuses dishes
 * of a hidden menu anyway (orders.ts); this keeps the page from offering it.
 *
 * Never cached and never indexed: the page is dynamic, says noindex/nofollow,
 * and next.config.ts adds X-Robots-Tag and Referrer-Policy: no-referrer so the
 * token does not leak to the sites the page loads files from.
 */
import type { TenantCapabilities } from '@/lib/service-modes'
import { publicMenuSource } from '@/lib/data/public-menu'
import type { PublicMenuData, PublicMenuResult } from './public-menu-data'

export const PREVIEW_TOKEN = /^[A-Za-z0-9_-]{32,128}$/

/** Browse-only: everything that would act on the restaurant is off. */
export function previewCapabilities(capabilities: TenantCapabilities): TenantCapabilities {
  return {
    ...capabilities,
    guestOrdering: false,
    waiterOrdering: false,
    showcase: true,
    waiterCalls: false,
    whatsappOrders: false,
    tips: false,
    dineIn: false,
    pickup: false,
    delivery: false,
    upsell: false,
    itemNotes: false,
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- tenant rows are untyped, as in public-menu-data */
export function asStagingPreview<T extends Omit<PublicMenuData, 'table' | 'privateAccess'>>(data: T): T {
  const tenant = data.tenant as any
  return {
    ...data,
    tenant: { ...tenant, tenant_settings: tenant?.tenant_settings ? { ...tenant.tenant_settings, analytics_enabled: false } : tenant?.tenant_settings },
    capabilities: previewCapabilities(data.capabilities),
    deliveryZones: [],
    chatAddonEnabled: false,
    chatAddonAudioEnabled: false,
    chatAddonTextEnabled: false,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * The staging menu a preview link opens, shaped like a public menu result
 * (kind 'menu'), or not_found. Only on the owned database: the legacy source
 * has no staging.
 */
export async function loadStagingPreview(slug: string, token: string): Promise<PublicMenuResult> {
  if (!PREVIEW_TOKEN.test(token) || publicMenuSource(process.env) !== 'owned-v1') return { kind: 'not_found' }
  const { loadOwnedPreviewMenuBase } = await import('@/lib/data/public-menu-runtime')
  const base = await loadOwnedPreviewMenuBase(slug, token)
  if (base.kind !== 'menu') return { kind: 'not_found' }
  const { tables: _tables, ...data } = base
  void _tables
  // The link is the access: a private menu's staging shows without a guest sign-in.
  return { ...asStagingPreview(data), table: null, privateAccess: true }
}
