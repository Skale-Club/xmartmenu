import pg from 'pg'
import { postgresRuntimeConfig } from './database-config'
import { sharedRuntimePool } from './shared-pool'
import { PaymentDataError, OwnedPaymentRepository, type PaymentQuery, paymentsDataOwned } from './payments'

let pool: pg.Pool | undefined, configuration: string | undefined
export function createPaymentsPool(env: Record<string, string | undefined>) {
  const created = new pg.Pool({ ...postgresRuntimeConfig(env, 'PAYMENTS'), max: 2,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, statement_timeout: 5000, query_timeout: 6000,
    options: '-c default_transaction_read_only=on -c lock_timeout=2000', application_name: 'xprout-payments' })
  created.on('error', () => {})
  return created
}
function ownedPool() {
  if (!paymentsDataOwned() || process.env.OWNED_ORDER_DATA_ENABLED !== 'true') throw new PaymentDataError(503, 'Independent orders and payments must be enabled together')
  const current = JSON.stringify(postgresRuntimeConfig(process.env, 'PAYMENTS'))
  if (configuration && configuration !== current) throw new PaymentDataError(503, 'Payment configuration changed; restart required')
  if (!pool) { pool = sharedRuntimePool('PAYMENTS'); configuration = current }
  return pool
}
/** Short SQL-only transactions. Provider calls occur outside these leases. */
export async function paymentTransaction<T>(source: Pick<pg.Pool, 'connect'>, write: boolean, operation: (query: PaymentQuery) => Promise<T>, timeoutMs = 8000): Promise<T> {
  let client: pg.PoolClient | undefined, released = false, expired = false
  const unavailable = () => new PaymentDataError(503, 'Payment service is unavailable')
  const destroy = () => { if (client && !released) { released = true; client.release(true) } }
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { expired = true; destroy(); reject(unavailable()) }, Number.isFinite(timeoutMs) ? Math.max(1, Math.min(timeoutMs, 8000)) : 8000)
  })
  const transaction = async () => {
    try {
      const acquired = await source.connect(); client = acquired
      if (expired) { destroy(); throw unavailable() }
      const query: PaymentQuery = (text, values) => { if (expired) throw unavailable(); return acquired.query(text, values) }
      await query(write ? 'BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const result = await operation(query)
      await query('COMMIT')
      return result
    } catch (error) {
      if (client && !released) await client.query('ROLLBACK').catch(() => {})
      if (error instanceof PaymentDataError) throw error
      throw unavailable()
    }
  }
  try { return await Promise.race([transaction(), deadline]) }
  finally { clearTimeout(timer); if (client && !released) { released = true; client.release() } }
}
export const withOwnedPayments = <T>(write: boolean, operation: (repository: OwnedPaymentRepository) => Promise<T>) =>
  paymentTransaction(ownedPool(), write, query => operation(new OwnedPaymentRepository(query)))

export const loadOwnedPaymentCheckout=(id:string)=>withOwnedPayments(false,repo=>repo.checkout(id))
export const ownedStripeEnabled=(tenantId:string)=>withOwnedPayments(false,async repo=>{const config=await repo.configuration(tenantId);return config.stripe&&!!config.stripe_account_id})
