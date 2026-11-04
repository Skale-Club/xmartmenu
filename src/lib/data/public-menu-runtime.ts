import pg from 'pg'
import { postgresRuntimeConfig } from './database-config'
import { readOwnedPublicMenu } from './public-menu'

let pool: pg.Pool | undefined
let poolConfiguration: string | undefined
export function createPublicMenuPool(env: Record<string, string | undefined>) {
  const config = postgresRuntimeConfig(env, 'PUBLIC_MENU')
  const created = new pg.Pool({ ...config, max: 2, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 10_000,
    statement_timeout: 5_000, query_timeout: 6_000,
    options: '-c default_transaction_read_only=on -c lock_timeout=2000', application_name: 'xmartmenu-public-menu' })
  created.on('error', () => {})
  return created
}
/** Validate even a warmed cache; missing/new targets cannot reuse a legacy entry. */
export function assertPublicMenuTarget(env: Record<string, string | undefined> = process.env) {
  const config = postgresRuntimeConfig(env, 'PUBLIC_MENU')
  if (poolConfiguration && poolConfiguration !== JSON.stringify(config)) throw new Error('Public menu configuration changed; restart required')
  return config
}
export async function loadOwnedPublicMenuBase(slug: string, menuSlug: string | undefined) {
  const config = assertPublicMenuTarget()
  if (!pool) { pool = createPublicMenuPool(process.env); poolConfiguration = JSON.stringify(config) }
  return readPublicMenuSnapshot(pool, slug, menuSlug)
}
export async function readPublicMenuSnapshot(source: Pick<pg.Pool, 'connect'>, slug: string, menuSlug: string | undefined, timeoutMs = 8_000) {
  let client: pg.PoolClient | undefined
  let released = false
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const destroyClient = () => {
    if (client && !released) { released = true; client.release(true) }
  }
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Destroy the active connection, including its server-side snapshot, rather
      // than returning a timed-out transaction to the pool for another caller.
      expired = true
      destroyClient()
      reject(new Error('Public menu is unavailable'))
    }, Number.isFinite(timeoutMs) ? Math.max(1, Math.min(timeoutMs, 8_000)) : 8_000)
  })
  const transaction = async () => {
    try {
      const acquired = await source.connect()
      client = acquired
      // A pool admission may complete after the caller's deadline. Never start
      // a transaction on that late connection or return it as a healthy lease.
      if (expired) { destroyClient(); throw new Error('Public menu is unavailable') }
      const query = (text: string, values?: unknown[]) => {
        if (expired) throw new Error('Public menu is unavailable')
        return acquired.query(text, values)
      }
      await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const result = await readOwnedPublicMenu(query, slug, menuSlug)
      await query('COMMIT')
      return result
    } catch {
      if (client && !released) await client.query('ROLLBACK').catch(() => {})
      throw new Error('Public menu is unavailable')
    }
  }
  try {
    return await Promise.race([transaction(), deadline])
  } finally {
    clearTimeout(timer)
    if (client && !released) { released = true; client.release() }
  }
}
