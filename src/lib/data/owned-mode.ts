/**
 * "Owned mode": production runs on the application's own PostgreSQL and own
 * login, with Supabase kept only as the development database.
 *
 * Migration is incremental, one `OWNED_*_ENABLED` flag per boundary. The
 * boundaries below were still reading (or, worse, WRITING) the old Supabase
 * copy even after other flags were on, so they follow the union of every flag:
 * once any boundary is owned, the Supabase copy of platform/tenant data is
 * stale and must not be trusted or written.
 *
 * Zero imports on purpose: this file is bundled into the Edge middleware.
 * Strictly `'true'` enables a flag, exactly like every individual selector.
 */
export const OWNED_MODE_FLAGS = [
  'OWNED_AUTH_ENABLED',
  'OWNED_PLATFORM_APPEARANCE_ENABLED',
  'OWNED_PUBLIC_MENU_ENABLED',
  'OWNED_ADMIN_MENUS_ENABLED',
  'OWNED_ADMIN_CATALOG_ENABLED',
  'OWNED_ORDER_DATA_ENABLED',
  'OWNED_PAYMENT_DATA_ENABLED',
  'OWNED_ACCOUNT_ADMIN_ENABLED',
  'OWNED_TENANT_ADMIN_ENABLED',
  'OWNED_TENANT_EFFECTS_ENABLED',
  'OWNED_MCP_ENABLED',
  'OWNED_REGISTRATION_ENABLED',
  'OWNED_ONBOARDING_ENABLED',
  'OWNED_ADMIN_WAITER_CALLS_ENABLED',
] as const

export type OwnedModeEnv = Record<string, string | undefined>

/** Owned mode never falls back to Supabase Storage: without S3 it refuses to start. */
export function assertOwnedModeStorage(env: OwnedModeEnv = process.env): void {
  if (ownedModeActive(env) && env.STORAGE_PROVIDER !== 's3') {
    throw new Error('Owned mode requires STORAGE_PROVIDER=s3 (no Supabase Storage fallback)')
  }
}

/** True when at least one boundary has moved to the application's own database. */
export function ownedModeActive(env: OwnedModeEnv = process.env): boolean {
  return OWNED_MODE_FLAGS.some(name => env[name] === 'true')
}
