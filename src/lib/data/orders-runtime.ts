import pg from 'pg'
import { postgresRuntimeConfig } from './database-config'
import { OrderDataError, OwnedOrderRepository, type OrderQuery } from './orders'

let pool: pg.Pool | undefined, configuration: string | undefined
export function createOrdersPool(env: Record<string, string | undefined>) {
  const created = new pg.Pool({ ...postgresRuntimeConfig(env, 'ORDERS'), max: 2,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, statement_timeout: 5000, query_timeout: 6000,
    options: '-c default_transaction_read_only=on -c lock_timeout=2000', application_name: 'xmartmenu-orders' })
  created.on('error', () => {})
  return created
}
function ownedPool() {
  const current = JSON.stringify(postgresRuntimeConfig(process.env, 'ORDERS'))
  if (configuration && configuration !== current) throw new OrderDataError(503, 'Order configuration changed; restart required')
  if (!pool) { pool = createOrdersPool(process.env); configuration = current }
  return pool
}
/** READ COMMITTED preserves the restored function's concurrent idempotency conflict/replay semantics. */
export async function orderTransaction<T>(source: Pick<pg.Pool, 'connect'>, write: boolean, operation: (query: OrderQuery) => Promise<T>, timeoutMs = 8000): Promise<T> {
  let client: pg.PoolClient | undefined, released = false, expired = false
  const unavailable = () => new OrderDataError(503, 'Order service is unavailable')
  const destroy = () => { if (client && !released) { released = true; client.release(true) } }
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { expired = true; destroy(); reject(unavailable()) }, Number.isFinite(timeoutMs) ? Math.max(1, Math.min(timeoutMs, 8000)) : 8000)
  })
  const transaction = async () => {
    try {
      const acquired = await source.connect(); client = acquired
      if (expired) { destroy(); throw unavailable() }
      const query: OrderQuery = (text, values) => { if (expired) throw unavailable(); return acquired.query(text, values) }
      await query(write ? 'BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const result = await operation(query)
      await query('COMMIT')
      return result
    } catch (error) {
      if (client && !released) await client.query('ROLLBACK').catch(() => {})
      if (error instanceof OrderDataError) throw error
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P0409') throw new OrderDataError(409, 'This checkout was already used for a different order')
      throw unavailable()
    }
  }
  try { return await Promise.race([transaction(), deadline]) }
  finally { clearTimeout(timer); if (client && !released) { released = true; client.release() } }
}
export const withOwnedOrders = <T>(tenantId: string, write: boolean, operation: (repository: OwnedOrderRepository) => Promise<T>) =>
  orderTransaction(ownedPool(), write, query => operation(new OwnedOrderRepository(query, tenantId)))
