import { assertOwnedModeStorage, ownedModeActive, type OwnedModeEnv } from './owned-mode'
import { postgresRuntimeConfig } from './database-config'
import { assertSingleSharedPoolTarget } from './shared-pool'

/**
 * Boot-time gate (instrumentation.ts). With any OWNED_* flag on, the server
 * refuses to start unless it has S3 storage, an explicit valid back-office
 * PostgreSQL target, and a single database/role behind every runtime URL.
 * Nothing runs while every flag is off.
 */
export function assertOwnedModeStartup(env: OwnedModeEnv = process.env): void {
  if (!ownedModeActive(env)) return
  assertOwnedModeStorage(env)
  postgresRuntimeConfig(env, 'ADMIN_MENUS')
  assertSingleSharedPoolTarget(env)
}
