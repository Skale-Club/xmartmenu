import { Pool } from 'pg'
import { postgresRuntimeConfig, type RuntimePrefix } from './database-config'
import { ownedModeActive } from './owned-mode'

/**
 * One PostgreSQL pool per distinct runtime target, shared by every owned
 * repository (identity, platform appearance, public menu, back office, orders,
 * payments).
 *
 * Budget (docs/xmartmenu-private-postgres-transport.md): the `xmartmenu_runtime`
 * role is limited to 12 connections, and the private SSH transport has 12
 * channel slots of which one is taken by its periodic heartbeat. Coolify's
 * rolling deployment keeps the old and the new container alive together, so
 *
 *     2 containers x SHARED_POOL_MAX + heartbeat <= 12   =>   SHARED_POOL_MAX = 5
 *
 * (2 x 5 + 1 = 11, one slot of headroom). Six pools of two connections would
 * have been 12 per container, 24 during a rollout.
 */
export const RUNTIME_ROLE_CONNECTION_LIMIT = 12
export const TRANSPORT_HEARTBEAT_SLOTS = 1
export const ROLLING_DEPLOY_CONTAINERS = 2
export const SHARED_POOL_MAX = Math.floor((RUNTIME_ROLE_CONNECTION_LIMIT - TRANSPORT_HEARTBEAT_SLOTS) / ROLLING_DEPLOY_CONTAINERS)

type RuntimeConfig = Pick<ReturnType<typeof postgresRuntimeConfig>, 'connectionString' | 'ssl'>

/**
 * Two URLs are "the same database" when protocol, credentials, host, port and
 * database name match (application_name is not identity). A different role
 * opens its own pool, as its connection limit is counted separately.
 */
export function sharedPoolKey(config: RuntimeConfig): string {
  let target: URL
  try { target = new URL(config.connectionString) } catch { return JSON.stringify([config.connectionString, config.ssl]) }
  return JSON.stringify([target.protocol, target.username, target.password, target.hostname, target.port, target.pathname, config.ssl])
}

// Route bundles can load this module more than once in one process; the
// connection budget only holds if every copy sees the same registry.
const REGISTRY = Symbol.for('xmartmenu.sharedRuntimePools')
function registry(): Map<string, Pool> {
  const holder = globalThis as unknown as Record<symbol, Map<string, Pool> | undefined>
  return (holder[REGISTRY] ??= new Map())
}

export function createSharedPool(config: RuntimeConfig) {
  const created = new Pool({ connectionString: config.connectionString, ssl: config.ssl, max: SHARED_POOL_MAX,
    connectionTimeoutMillis: 5_000, idleTimeoutMillis: 10_000, statement_timeout: 5_000, query_timeout: 6_000,
    options: '-c lock_timeout=2000', application_name: 'xmartmenu-runtime' })
  // Idle connection errors must not crash the process or log credential details.
  created.on('error', () => {})
  return created
}

export function sharedPoolForConfig(config: RuntimeConfig): Pool {
  const key = sharedPoolKey(config)
  const pools = registry()
  let pool = pools.get(key)
  // Owned mode serves one database through one pool; a second target would double the budget.
  if (!pool && pools.size > 0 && ownedModeActive()) throw new Error('Owned mode requires a single PostgreSQL runtime target')
  if (!pool) { pool = createSharedPool(config); pools.set(key, pool) }
  return pool
}

/** Resolves the prefix's explicit target, then reuses the pool of that database. */
export function sharedRuntimePool(prefix: RuntimePrefix, env: Record<string, string | undefined> = process.env): Pool {
  return sharedPoolForConfig(postgresRuntimeConfig(env, prefix))
}

export const RUNTIME_PREFIXES: readonly RuntimePrefix[] = ['IDENTITY', 'PLATFORM_APPEARANCE', 'PUBLIC_MENU', 'ADMIN_MENUS', 'ORDERS', 'PAYMENTS']

/** Startup check: every configured runtime URL must resolve to the same pool key. */
export function assertSingleSharedPoolTarget(env: Record<string, string | undefined> = process.env): void {
  const keys = new Set<string>()
  for (const prefix of RUNTIME_PREFIXES) {
    // Production prefixes are opt-in per feature; development always resolves the one DEV target.
    if (env.NODE_ENV === 'production' && !env[`${prefix}_DATABASE_URL`]) continue
    keys.add(sharedPoolKey(postgresRuntimeConfig(env, prefix)))
  }
  if (keys.size > 1) throw new Error('Owned mode requires every PostgreSQL runtime URL to target the same database and role')
}

/** Tests and graceful shutdown. */
export async function closeSharedRuntimePools() {
  const pools = [...registry().values()]
  registry().clear()
  await Promise.all(pools.map(pool => Promise.resolve().then(() => pool.end()).catch(() => {})))
}
