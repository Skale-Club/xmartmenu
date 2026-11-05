import { assertConnectionQuery, developmentConfig } from '../../../scripts/lib/database-target.mjs'

export type RuntimePrefix = 'IDENTITY' | 'PLATFORM_APPEARANCE' | 'PUBLIC_MENU' | 'ADMIN_MENUS' | 'ORDERS' | 'PAYMENTS'

/** Runtime repositories never inherit legacy production SQL aliases. */
export function postgresRuntimeConfig(env: Record<string, string | undefined>, prefix: RuntimePrefix) {
  let connectionString: string
  let ssl: false | { rejectUnauthorized: true }
  if (env.NODE_ENV !== 'production') {
    connectionString = developmentConfig(env).databaseUrl
    ssl = { rejectUnauthorized: true }
  } else {
    let target: URL
    try {
      target = new URL(env[`${prefix}_DATABASE_URL`] ?? '')
      assertConnectionQuery(target)
      if (!['postgres:', 'postgresql:'].includes(target.protocol) || !env.PROD_DATABASE_HOST || !env.PROD_DATABASE_NAME
        || target.hostname !== env.PROD_DATABASE_HOST || decodeURIComponent(target.pathname.slice(1)) !== env.PROD_DATABASE_NAME
        || /supabase\.(co|com)$/.test(target.hostname) || target.port === '6543' || target.hash) throw new Error()
    } catch { throw new Error('Explicit matching independent PostgreSQL target required') }
    const mode = env[`${prefix}_DATABASE_SSL`]
    if (mode && !['require', 'disable'].includes(mode)) throw new Error('Invalid PostgreSQL TLS setting')
    connectionString = target.href
    ssl = mode === 'disable' ? false : { rejectUnauthorized: true }
  }
  const database = new URL(connectionString)
  // pg connection-string TLS options otherwise override the explicit decision.
  database.searchParams.delete('sslmode')
  return { connectionString: database.href, ssl }
}
