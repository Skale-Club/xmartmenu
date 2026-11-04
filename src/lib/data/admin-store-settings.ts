import type { TenantSettings, Tenant, UserRole, StripeConnection } from '@/types/database'
import { AdminMenuError, type AdminMenuQuery } from './admin-menus'
import { planCeiling, resolveTenantCapabilities, type ServiceSettings } from '../service-modes'
import { SERVICE_SETTINGS_KEYS, validateServiceSettingsPatch } from '../service-settings'

export type AdminStoreContext = { tenantId: string; role: UserRole }
export class LockedServiceSettingsError extends AdminMenuError {
  constructor(public locked: string[]) { super(403, 'Not included in your plan') }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STORE_COLUMNS = [
  'currency', 'language', 'address', 'phone', 'city', 'region', 'postal_code', 'country',
  'latitude', 'longitude', 'price_range', 'tip_percentage_1', 'tip_percentage_2', 'tip_percentage_3', 'business_hours',
  ...SERVICE_SETTINGS_KEYS,
].join(', ')

function assertContext(context: AdminStoreContext, write = false) {
  if (!UUID.test(context.tenantId) || !['superadmin', 'store-admin', 'store-staff'].includes(context.role)) throw new AdminMenuError(403, 'Forbidden')
  if (write && context.role === 'store-staff') throw new AdminMenuError(403, 'Forbidden')
}

function parseFeatures(value: unknown): string[] | null {
  if (value === null || value === undefined) return null
  if (!Array.isArray(value) || value.some(feature => typeof feature !== 'string')) throw new AdminMenuError(503, 'Plan information is unavailable')
  return value
}

async function loadPlan(query: AdminMenuQuery, tenantId: string, lock = false) {
  const result = await query(`SELECT s.status, p.features FROM public.tenant_subscriptions s
    JOIN public.plans p ON p.id=s.plan_id WHERE s.tenant_id=$1 LIMIT 2${lock ? ' FOR SHARE OF s,p' : ''}`, [tenantId])
  if (result.rows.length > 1) throw new AdminMenuError(503, 'Plan information is unavailable')
  const row = result.rows[0]
  if (!row || !['active', 'trial'].includes(String(row.status))) return null
  return parseFeatures(row.features)
}

export async function readAdminStorePage(query: AdminMenuQuery, context: AdminStoreContext) {
  assertContext(context)
  const [settingsResult, tenantResult, stripeResult, features] = await Promise.all([
    query(`SELECT ${STORE_COLUMNS} FROM public.tenant_settings WHERE tenant_id=$1 LIMIT 1`, [context.tenantId]),
    query('SELECT custom_domain,custom_domain_verified FROM public.tenants WHERE id=$1 LIMIT 1', [context.tenantId]),
    query(`SELECT id,tenant_id,stripe_account_id,scope,connected_at,is_active,disconnected_at,created_at,updated_at
      FROM public.stripe_connections WHERE tenant_id=$1 AND is_active=true ORDER BY connected_at DESC LIMIT 2`, [context.tenantId]),
    loadPlan(query, context.tenantId),
  ])
  const tenant = tenantResult.rows[0]
  if (!tenant) throw new AdminMenuError(404, 'Tenant not found')
  if (stripeResult.rows.length > 1) throw new AdminMenuError(503, 'Store connection information is unavailable')
  const settings = (settingsResult.rows[0] ?? null) as unknown as TenantSettings | null
  return {
    settings,
    tenant: { custom_domain: tenant.custom_domain ?? null, custom_domain_verified: tenant.custom_domain_verified === true } as Pick<Tenant, 'custom_domain' | 'custom_domain_verified'>,
    stripeConnection: (stripeResult.rows[0] ?? null) as unknown as StripeConnection | null,
    capabilities: resolveTenantCapabilities(features, settings as ServiceSettings | null),
  }
}

const REGIONAL_COLUMNS = [
  'currency', 'language', 'address', 'phone', 'city', 'region', 'postal_code', 'country', 'latitude', 'longitude',
  'price_range', 'tip_percentage_1', 'tip_percentage_2', 'tip_percentage_3', 'business_hours',
] as const

function validateRegionalPatch(input: unknown, payments: boolean, current: Record<string, unknown> | null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AdminMenuError(400, 'Invalid settings')
  const body = input as Record<string, unknown>
  const allowed = new Set(REGIONAL_COLUMNS)
  if (Object.keys(body).length === 0 || Object.keys(body).some(key => !allowed.has(key as typeof REGIONAL_COLUMNS[number]))) throw new AdminMenuError(400, 'Invalid settings')
  const patch: Record<string, unknown> = {}
  for (const key of REGIONAL_COLUMNS) {
    if (!(key in body)) continue
    const value = body[key]
    if (['latitude', 'longitude'].includes(key)) {
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new AdminMenuError(400, `Invalid ${key}`)
      patch[key] = value
      continue
    }
    if (key === 'business_hours') {
      if (value !== null && (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(item => typeof item !== 'string'))) throw new AdminMenuError(400, 'Invalid business hours')
      patch[key] = value
      continue
    }
    if (key.startsWith('tip_percentage_')) {
      if (!payments) {
        if (current?.[key] !== value) throw new AdminMenuError(403, 'Tip presets are part of the Menu + Payments plan')
      }
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) throw new AdminMenuError(400, `Invalid ${key}`)
      patch[key] = value
      continue
    }
    if (['currency', 'language'].includes(key) ? typeof value !== 'string' : value !== null && typeof value !== 'string') throw new AdminMenuError(400, `Invalid ${key}`)
    if (['city', 'region', 'postal_code', 'country', 'price_range'].includes(key)) {
      patch[key] = typeof value === 'string' ? value.trim() || null : null
    } else if (key === 'currency') {
      if (typeof value !== 'string') throw new AdminMenuError(400, 'Invalid currency')
      patch[key] = value.trim().toUpperCase()
    } else {
      patch[key] = value
    }
  }
  return patch
}

export async function mutateAdminStoreSettings(query: AdminMenuQuery, context: AdminStoreContext, input: unknown) {
  assertContext(context, true)
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`xmartmenu-store-settings:${context.tenantId}`])
  const features = await loadPlan(query, context.tenantId, true)
  const currentResult = await query(`SELECT ${STORE_COLUMNS} FROM public.tenant_settings WHERE tenant_id=$1 LIMIT 1 FOR UPDATE`, [context.tenantId])
  const current = currentResult.rows[0] ?? null
  const patch = validateRegionalPatch(input, planCeiling(features).payments, current)
  const fields = Object.keys(patch)
  const result = await query(`INSERT INTO public.tenant_settings AS s (tenant_id,${fields.join(',')},updated_at)
    VALUES ($1,${fields.map((_, index) => `$${index + 2}`).join(',')},now())
    ON CONFLICT (tenant_id) DO UPDATE SET ${fields.map(field => `${field}=EXCLUDED.${field}`).join(',')},updated_at=now()
    RETURNING ${STORE_COLUMNS}`, [context.tenantId, ...fields.map(field => patch[field])])
  if (!result.rows[0]) throw new AdminMenuError(503, 'Settings could not be saved')
  const settings = result.rows[0] as unknown as TenantSettings
  return { settings, capabilities: resolveTenantCapabilities(features, settings as ServiceSettings) }
}

export async function mutateAdminServiceSettings(query: AdminMenuQuery, context: AdminStoreContext, input: unknown) {
  assertContext(context, true)
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`xmartmenu-service-settings:${context.tenantId}`])
  const features = await loadPlan(query, context.tenantId, true)
  const currentResult = await query(`SELECT tenant_id,${SERVICE_SETTINGS_KEYS.join(',')} FROM public.tenant_settings WHERE tenant_id=$1 LIMIT 1 FOR UPDATE`, [context.tenantId])
  const current = currentResult.rows[0] ?? null
  const capabilities = resolveTenantCapabilities(features, current as ServiceSettings | null)
  const { patch, locked, errors } = validateServiceSettingsPatch(input, capabilities, current)
  if (errors.length) throw new AdminMenuError(400, errors[0]!)
  if (locked.length) throw new LockedServiceSettingsError(locked)
  const fields = Object.keys(patch)
  if (!fields.length) throw new AdminMenuError(400, 'Invalid settings')
  const result = await query(`INSERT INTO public.tenant_settings AS s (tenant_id,${fields.join(',')},updated_at)
    VALUES ($1,${fields.map((_, index) => `$${index + 2}`).join(',')},now())
    ON CONFLICT (tenant_id) DO UPDATE SET ${fields.map(field => `${field}=EXCLUDED.${field}`).join(',')},updated_at=now()
    RETURNING ${SERVICE_SETTINGS_KEYS.join(',')}`, [context.tenantId, ...fields.map(field => patch[field as keyof typeof patch])])
  if (!result.rows[0]) throw new AdminMenuError(503, 'Settings could not be saved')
  const settings = result.rows[0] as ServiceSettings
  return { settings, capabilities: resolveTenantCapabilities(features, settings) }
}

export async function mutateAdminCustomDomain(query: AdminMenuQuery, context: AdminStoreContext, tenantId: string, value: unknown) {
  assertContext(context, true)
  if (tenantId !== context.tenantId) throw new AdminMenuError(403, 'Forbidden')
  if (typeof value !== 'string') throw new AdminMenuError(400, 'Invalid custom domain')
  const domain = value.trim().toLowerCase() || null
  try {
    const result = await query(`UPDATE public.tenants SET custom_domain=$1,custom_domain_verified=false,updated_at=now()
      WHERE id=$2 RETURNING custom_domain,custom_domain_verified`, [domain, context.tenantId])
    if (!result.rows[0]) throw new AdminMenuError(404, 'Tenant not found')
    return result.rows[0]
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') throw new AdminMenuError(409, 'This custom domain is already in use')
    throw error
  }
}

export async function markAdminCustomDomainVerified(query: AdminMenuQuery, context: AdminStoreContext, tenantId: string, domain: string, verified: boolean) {
  assertContext(context, true)
  if (tenantId !== context.tenantId || context.role === 'store-staff') throw new AdminMenuError(403, 'Forbidden')
  const result = await query(`UPDATE public.tenants SET custom_domain=$1,custom_domain_verified=$2,updated_at=now()
    WHERE id=$3 RETURNING custom_domain,custom_domain_verified`, [domain, verified, context.tenantId])
  if (!result.rows[0]) throw new AdminMenuError(404, 'Tenant not found')
  return result.rows[0]
}
