import pg from 'pg'
import { cache } from 'react'
import { postgresRuntimeConfig } from './database-config'
import { sharedRuntimePool } from './shared-pool'
import { readPlatformAppearance, selectPlatformAppearance } from './platform-appearance'
import { ownedAuthSelected } from '../auth/owned-principal'
import { getIdentityServices } from '../auth/identity-services'

let pool: pg.Pool | undefined
export function createPlatformAppearancePool(env: Record<string, string | undefined>) {
  const config = postgresRuntimeConfig(env, 'PLATFORM_APPEARANCE')
  const created = new pg.Pool({ ...config, max: 2, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 10_000,
    statement_timeout: 5_000, query_timeout: 6_000,
    options: '-c default_transaction_read_only=on -c lock_timeout=2000', application_name: 'xmartmenu-platform-appearance' })
  // Idle connection errors must not crash the process or log credential details.
  created.on('error', () => {})
  return created
}
function ownedPool() {
  pool ??= sharedRuntimePool('PLATFORM_APPEARANCE')
  return pool
}

// React request cache deduplicates metadata, viewport and layout, without a
// shared TTL that could conceal an operator's appearance/configuration change.
export const getPlatformAppearance = cache(() => ownedAuthSelected()
  ? readPlatformAppearance(text => getIdentityServices().pool.query(text))
  : selectPlatformAppearance(process.env, {
  owned: () => readPlatformAppearance(text => ownedPool().query(text)),
  legacy: async () => {
    const { createServiceClient } = await import('../supabase/server')
    const { data } = await createServiceClient().from('platform_settings').select('cta_color, favicon_url').single()
    return data
  },
}))
