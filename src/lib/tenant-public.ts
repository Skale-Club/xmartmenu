/**
 * tenant-public.ts — strip internal/operational columns off a `tenants` row
 * before it is serialized to an anonymous client.
 *
 * Public menu pages select `*, tenant_settings(*)` and hand the whole tenant
 * object to the client `MenuPage`. The tenants row carries internal CRM sync
 * state (xphere_*) and raw sync-error strings that must never ship to menu
 * visitors. Rather than enumerate every safe column (and re-audit on each schema
 * change), we shallow-copy and delete the known-internal fields.
 */

const INTERNAL_TENANT_KEYS = [
  'xphere_account_id',
  'xphere_contact_id',
  'xphere_opportunity_id',
  'xphere_synced_at',
  'xphere_sync_error',
] as const

export function sanitizeTenantForClient<T extends Record<string, unknown>>(tenant: T): T {
  const copy = { ...tenant }
  for (const key of INTERNAL_TENANT_KEYS) {
    delete (copy as Record<string, unknown>)[key]
  }
  return copy
}
