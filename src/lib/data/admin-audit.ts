import type { UserRole } from '@/types/database'
import { AdminMenuError, type AdminMenuQuery } from './admin-menus'
import { TABLE_LABELS } from '../observability/audit-format'

export const OWNER_AUDIT_TABLES = [
  'tenant_settings', 'menus', 'categories', 'products', 'product_option_groups', 'product_options',
  'product_media', 'ingredients', 'product_ingredients', 'restaurant_tables', 'locations',
  'delivery_zones', 'chat_addon_settings', 'tenant_ai_settings', 'qr_codes', 'profiles', 'orders',
  'tenant_subscriptions', 'tenants',
] as const

export const OWNER_AUDIT_PAGE_SIZE = 50
export const PLATFORM_AUDIT_PAGE_SIZE = 100

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BIGINT = 9_223_372_036_854_775_807n

export type AuditFilters = {
  table?: string
  actor?: string
  tenant?: string
  request?: string
  days?: number
  before?: string
}

export interface OwnerAuditRow {
  id: string
  occurred_at: Date | string
  actor_id: string | null
  via: string
  table_name: string
  action: 'insert' | 'update' | 'delete'
  changes: Record<string, unknown>
  actor_name: string | null
  actor_role: UserRole | null
  actor_external: boolean
}

export interface PlatformAuditRow {
  id: string
  occurred_at: Date | string
  tenant_id: string | null
  actor_id: string | null
  via: string
  table_name: string
  record_id: string | null
  action: 'insert' | 'update' | 'delete'
  changes: Record<string, unknown>
  request_id: string | null
}

export interface AuditTenant { id: string; name: string; slug: string }
export interface AuditPerson { id: string; full_name: string | null; role: string }

function daysWindow(value: number | undefined, fallback: number) {
  return [1, 7, 30, 90].includes(Number(value)) ? Number(value) : fallback
}

function beforeId(value: string | undefined) {
  if (!value || !/^[1-9][0-9]{0,18}$/.test(value)) return undefined
  try { return BigInt(value) <= MAX_BIGINT ? value : undefined } catch { return undefined }
}

function appendFilter(clauses: string[], values: unknown[], clause: (placeholder: string) => string, value: unknown) {
  values.push(value)
  clauses.push(clause(`$${values.length}`))
}

function validateOwner(context: { tenantId: string; role: UserRole }) {
  if (!UUID.test(context.tenantId) || !['store-admin', 'superadmin'].includes(context.role)) throw new AdminMenuError(403, 'Forbidden')
}

function validatePlatform(context: { role: UserRole }) {
  if (context.role !== 'superadmin') throw new AdminMenuError(403, 'Forbidden')
}

export async function readOwnerAuditPage(
  query: AdminMenuQuery,
  context: { tenantId: string; role: UserRole },
  filters: AuditFilters,
) {
  validateOwner(context)
  const days = daysWindow(filters.days, 30)
  const values: unknown[] = [context.tenantId, OWNER_AUDIT_TABLES, new Date(Date.now() - days * 86_400_000)]
  const clauses = ['e.tenant_id=$1', 'e.table_name=ANY($2::text[])', 'e.occurred_at >= $3']
  if (filters.table && (OWNER_AUDIT_TABLES as readonly string[]).includes(filters.table)) {
    appendFilter(clauses, values, p => `e.table_name=${p}`, filters.table)
  }
  if (filters.actor && UUID.test(filters.actor)) appendFilter(clauses, values, p => `e.actor_id=${p}::uuid`, filters.actor)
  const before = beforeId(filters.before)
  if (before) appendFilter(clauses, values, p => `e.id < ${p}::bigint`, before)
  values.push(OWNER_AUDIT_PAGE_SIZE)

  const result = await query(`SELECT e.id::text AS id,e.occurred_at,e.actor_id,e.via,e.table_name,e.action,e.changes,
      p.full_name AS actor_name,p.role AS actor_role,
      EXISTS(SELECT 1 FROM public.profiles external_profile WHERE external_profile.id=e.actor_id
        AND external_profile.tenant_id IS DISTINCT FROM e.tenant_id) AS actor_external
    FROM public.audit_events e
    LEFT JOIN public.profiles p ON p.id=e.actor_id AND p.tenant_id=e.tenant_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY e.id DESC LIMIT $${values.length}`, values)
  return result.rows as unknown as OwnerAuditRow[]
}

export async function readPlatformAuditPage(
  query: AdminMenuQuery,
  context: { role: UserRole },
  filters: AuditFilters,
) {
  validatePlatform(context)
  const days = daysWindow(filters.days, 7)
  const values: unknown[] = [new Date(Date.now() - days * 86_400_000)]
  const clauses = ['e.occurred_at >= $1']
  if (filters.tenant && UUID.test(filters.tenant)) appendFilter(clauses, values, p => `e.tenant_id=${p}::uuid`, filters.tenant)
  if (filters.table && Object.hasOwn(TABLE_LABELS, filters.table)) appendFilter(clauses, values, p => `e.table_name=${p}`, filters.table)
  if (filters.actor && UUID.test(filters.actor)) appendFilter(clauses, values, p => `e.actor_id=${p}::uuid`, filters.actor)
  if (filters.request) appendFilter(clauses, values, p => `e.request_id=${p}`, filters.request.slice(0, 128))
  const before = beforeId(filters.before)
  if (before) appendFilter(clauses, values, p => `e.id < ${p}::bigint`, before)
  values.push(PLATFORM_AUDIT_PAGE_SIZE)

  const [events, tenants] = await Promise.all([
    query(`SELECT e.id::text AS id,e.occurred_at,e.tenant_id,e.actor_id,e.via,e.table_name,e.record_id,e.action,e.changes,e.request_id
      FROM public.audit_events e WHERE ${clauses.join(' AND ')} ORDER BY e.id DESC LIMIT $${values.length}`, values),
    query('SELECT id,name,slug FROM public.tenants ORDER BY name'),
  ])
  const rows = events.rows as unknown as PlatformAuditRow[]
  const actorIds = [...new Set(rows.map(row => row.actor_id).filter((id): id is string => !!id))]
  const people = actorIds.length
    ? (await query('SELECT id,full_name,role FROM public.profiles WHERE id=ANY($1::uuid[])', [actorIds])).rows as unknown as AuditPerson[]
    : []
  return { rows, tenants: tenants.rows as unknown as AuditTenant[], people }
}
