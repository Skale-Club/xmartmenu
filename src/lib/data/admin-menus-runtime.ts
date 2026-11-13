import pg from 'pg'
import { postgresRuntimeConfig } from './database-config'
import { sharedRuntimePool } from './shared-pool'
import { AdminMenuError, findAdminMenu, mutateAdminMenu, readAdminMenus, type AdminMenuContext, type AdminMenuMutation, type AdminMenuQuery } from './admin-menus'

let pool: pg.Pool | undefined, configuration: string | undefined
export function createAdminMenusPool(env: Record<string, string | undefined>) {
  const created = new pg.Pool({ ...postgresRuntimeConfig(env, 'ADMIN_MENUS'), max: 2,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, statement_timeout: 5000, query_timeout: 6000,
    options: '-c default_transaction_read_only=on -c lock_timeout=2000', application_name: 'xprout-admin-menus' })
  created.on('error', () => {})
  return created
}
function ownedPool() {
  const current = JSON.stringify(postgresRuntimeConfig(process.env, 'ADMIN_MENUS'))
  if (configuration && configuration !== current) throw new AdminMenuError(503, 'Menu configuration changed; restart required')
  if (!pool) { pool = sharedRuntimePool('ADMIN_MENUS'); configuration = current }
  return pool
}
/** No mutation retries: an interrupted COMMIT can have an ambiguous outcome. */
export async function adminMenuTransaction<T>(source: Pick<pg.Pool, 'connect'>, write: boolean, operation: (query: AdminMenuQuery) => Promise<T>, timeoutMs = 8000): Promise<T> {
  let client: pg.PoolClient | undefined, released = false, expired = false
  const unavailable = () => new AdminMenuError(503, 'Menu service is unavailable')
  const destroy = () => { if (client && !released) { released = true; client.release(true) } }
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { expired = true; destroy(); reject(unavailable()) }, Number.isFinite(timeoutMs) ? Math.max(1, Math.min(timeoutMs, 8000)) : 8000)
  })
  const transaction = async () => {
    try {
      const acquired = await source.connect(); client = acquired
      if (expired) { destroy(); throw unavailable() }
      const query: AdminMenuQuery = (text, values) => {
        if (expired) throw unavailable()
        return acquired.query(text, values)
      }
      await query(write ? 'BEGIN READ WRITE' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const result = await operation(query)
      await query('COMMIT')
      return result
    } catch (error) {
      if (client && !released) await client.query('ROLLBACK').catch(() => {})
      throw error instanceof AdminMenuError ? error : unavailable()
    }
  }
  try { return await Promise.race([transaction(), deadline]) }
  finally { clearTimeout(timer); if (client && !released) { released = true; client.release() } }
}
export const listOwnedAdminMenus = (context: AdminMenuContext) => adminMenuTransaction(ownedPool(), false, query => readAdminMenus(query, context))
export const findOwnedAdminMenu = (context: AdminMenuContext, id: string) => adminMenuTransaction(ownedPool(), false, query => findAdminMenu(query, context, id))
export const mutateOwnedAdminMenu = (context: AdminMenuContext, mutation: AdminMenuMutation) => adminMenuTransaction(ownedPool(), true, query => mutateAdminMenu(query, context, mutation))
/** Other back-office repositories share this pool and its connection budget. */
export const ownedAdminTransaction = <T>(write: boolean, operation: (query: AdminMenuQuery) => Promise<T>, timeoutMs?: number) => adminMenuTransaction(ownedPool(), write, operation, timeoutMs)
