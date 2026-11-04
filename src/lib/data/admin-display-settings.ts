import type { AdminMenuContext, AdminMenuQuery } from './admin-menus'
import { AdminMenuError } from './admin-menus'
import { planCeiling } from '../service-modes'

export type DisplaySettingsView = 'branding' | 'seo' | 'menu-display'

export function hasSameOriginAdminMutation(request: Request) {
  const target = new URL(request.url)
  return request.headers.get('origin') === `${target.protocol}//${request.headers.get('host') ?? target.host}`
}

const COLUMNS: Record<DisplaySettingsView, readonly string[]> = {
  branding: ['primary_color', 'accent_color', 'instagram', 'tagline', 'whatsapp', 'logo_url', 'banner_url'],
  seo: ['seo_title', 'seo_description', 'seo_keywords', 'seo_og_image_url', 'seo_noindex', 'tagline', 'about', 'primary_color'],
  'menu-display': ['analytics_enabled', 'visual_feed_enabled', 'menu_default_view', 'feed_autoplay_videos', 'upsell_enabled'],
}
const WRITABLE_COLUMNS: Record<DisplaySettingsView, readonly string[]> = {
  branding: ['primary_color', 'accent_color', 'instagram', 'tagline', 'whatsapp', 'logo_url', 'banner_url'],
  seo: ['seo_title', 'seo_description', 'seo_keywords', 'seo_og_image_url', 'seo_noindex'],
  'menu-display': ['analytics_enabled', 'visual_feed_enabled', 'menu_default_view', 'feed_autoplay_videos', 'upsell_enabled'],
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function assertContext(context: AdminMenuContext, write = false) {
  if (!UUID.test(context.tenantId) || !['superadmin', 'store-admin', 'store-staff'].includes(context.role)) {
    throw new AdminMenuError(403, 'Forbidden')
  }
  if (write && context.role === 'store-staff') throw new AdminMenuError(403, 'Forbidden')
}

function columns(view: DisplaySettingsView) {
  return COLUMNS[view].map(column => `s.${column}`).join(', ')
}

export async function readAdminDisplaySettings(query: AdminMenuQuery, context: AdminMenuContext, view: DisplaySettingsView) {
  assertContext(context)
  const selected = columns(view)
  const result = await query(`SELECT ${selected} FROM public.tenant_settings s WHERE s.tenant_id=$1 LIMIT 1`, [context.tenantId])
  return result.rows[0] ?? null
}

export async function readAdminSeoSettingsPage(query: AdminMenuQuery, context: AdminMenuContext) {
  assertContext(context)
  const result = await query(`SELECT s.tenant_id IS NOT NULL AS has_settings, s.seo_title, s.seo_description, s.seo_keywords,
      s.seo_og_image_url, s.seo_noindex, s.tagline, s.about, s.primary_color,
      t.slug, t.custom_domain, t.custom_domain_verified
    FROM public.tenants t LEFT JOIN public.tenant_settings s ON s.tenant_id=t.id
    WHERE t.id=$1 LIMIT 1`, [context.tenantId])
  const row = result.rows[0]
  if (!row) return { settings: null, tenant: null }
  const { has_settings, slug, custom_domain, custom_domain_verified, ...settings } = row
  return {
    settings: has_settings === true ? settings : null,
    tenant: {
      slug: typeof slug === 'string' ? slug : null,
      custom_domain: typeof custom_domain === 'string' ? custom_domain : null,
      custom_domain_verified: custom_domain_verified === true,
    },
  }
}

async function paymentsEntitlement(query: AdminMenuQuery, tenantId: string, lock = false) {
  const result = await query(`SELECT s.status,p.features FROM public.tenant_subscriptions s
    JOIN public.plans p ON p.id=s.plan_id WHERE s.tenant_id=$1 LIMIT 2${lock ? ' FOR SHARE OF s,p' : ''}`, [tenantId])
  if (result.rows.length > 1) throw new AdminMenuError(503, 'Plan information is unavailable')
  const row = result.rows[0]
  if (!row || !['active', 'trial'].includes(String(row.status))) return false
  if (!Array.isArray(row.features) || row.features.some(feature => typeof feature !== 'string')) throw new AdminMenuError(503, 'Plan information is unavailable')
  return planCeiling(row.features).payments
}

export async function readAdminMenuDisplayPage(query: AdminMenuQuery, context: AdminMenuContext) {
  assertContext(context)
  const settings = await readAdminDisplaySettings(query, context, 'menu-display')
  const upsellAvailable = await paymentsEntitlement(query, context.tenantId)
  return { settings, upsellAvailable }
}

/** Writes only the fixed settings columns used by the three owner settings screens. */
export async function mutateAdminDisplaySettings(
  query: AdminMenuQuery,
  context: AdminMenuContext,
  view: DisplaySettingsView,
  input: Record<string, unknown>,
) {
  assertContext(context, true)
  const allowed = WRITABLE_COLUMNS[view]
  const entries = Object.entries(input)
  if (!entries.length || entries.some(([key]) => !allowed.includes(key))) throw new AdminMenuError(400, 'Invalid settings')

  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`xmartmenu-display-settings:${context.tenantId}`])
  if (view === 'menu-display' && input.upsell_enabled === true && !(await paymentsEntitlement(query, context.tenantId, true))) {
    throw new AdminMenuError(403, 'Order suggestions are part of the Menu + Payments plan')
  }
  const fields = entries.map(([key]) => key)
  const values = entries.map(([, value]) => value)
  const insertColumns = ['tenant_id', ...fields, 'updated_at']
  const insertValues = ['$1', ...fields.map((_, index) => `$${index + 2}`), 'now()']
  const updates = fields.map(field => `${field}=EXCLUDED.${field}`).concat('updated_at=now()')
  const sql = `INSERT INTO public.tenant_settings AS s (${insertColumns.join(', ')}) VALUES (${insertValues.join(', ')})
    ON CONFLICT (tenant_id) DO UPDATE SET ${updates.join(', ')} RETURNING ${columns(view)}`
  const result = await query(sql, [context.tenantId, ...values])
  const row = result.rows[0]
  if (!row) throw new Error('Settings write failed')
  return row
}
