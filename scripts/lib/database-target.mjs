// Never let a developer command inherit the production DATABASE_URL.
/** The Supabase project that was production until the 2026-11-06 cutover to the owned PostgreSQL. */
export const SOURCE_SUPABASE_PROJECT = 'ktogbpqookfcqilqvici'
/**
 * Owner decision 2026-11-07: production lives only in the owned PostgreSQL, and the retired
 * source project above is now the Supabase DEVELOPMENT project (`npm run dev`, `db:pull`).
 * XmartMenu had no paying customers at the cutover, so the old data is not protected data.
 */
export const DEVELOPMENT_SUPABASE_PROJECT = SOURCE_SUPABASE_PROJECT
/**
 * Supabase projects that serve real customers today. None: production is the owned
 * PostgreSQL. Add a ref here the moment a Supabase project serves customers again.
 * @type {string[]}
 */
export const PRODUCTION_PROJECT_REFS = []

/** The known production ref found anywhere in `value` (a ref, host or URL), if any. */
export function findProductionProjectRef(value, refs = PRODUCTION_PROJECT_REFS) {
  const lower = String(value).toLowerCase()
  return refs.find(ref => lower.includes(ref))
}

/** node-postgres query fields can override URL host/user/port or read SSL files. */
export function assertConnectionQuery(url) {
  const seen = new Set()
  for (const [key, value] of url.searchParams) {
    if (!['sslmode', 'application_name'].includes(key) || seen.has(key)) {
      throw new Error('Unsupported PostgreSQL connection option (credentials omitted)')
    }
    if (key === 'sslmode' && !['disable', 'require', 'verify-full'].includes(value)) {
      throw new Error('Unsupported PostgreSQL TLS option (credentials omitted)')
    }
    seen.add(key)
  }
}

function parseUrl(value) {
  try {
    const url = new URL(value)
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) throw new Error()
    assertConnectionQuery(url)
    return url
  } catch { throw new Error('Invalid PostgreSQL target (credentials omitted)') }
}

/**
 * Only the database half of the development target: the declared Supabase development
 * project and a DEV_DATABASE_URL that belongs to it. Used by `npm run db:pull`, which needs
 * no API keys. Never falls back to DATABASE_URL or any production alias.
 * @param {Record<string, string | undefined>} [env]
 */
export function developmentDatabaseTarget(env = process.env) {
  const ref = env.DEV_SUPABASE_PROJECT_REF?.trim()
  if (!ref || !/^[a-z]{20}$/.test(ref) || findProductionProjectRef(ref)) {
    throw new Error('Set DEV_SUPABASE_PROJECT_REF to an isolated development project, distinct from the production source')
  }
  const database = parseUrl(env.DEV_DATABASE_URL)
  const direct = database.hostname === `db.${ref}.supabase.co`
  const pooler = /\.pooler\.supabase\.com$/.test(database.hostname) && decodeURIComponent(database.username) === `postgres.${ref}`
  if ((!direct && !pooler) || database.pathname !== '/postgres' || findProductionProjectRef(database.href)) {
    throw new Error('Development database must match the isolated Supabase project')
  }
  database.searchParams.set('sslmode', 'verify-full')
  return { ref, databaseUrl: database.href, host: database.hostname }
}

/** @param {Record<string, string | undefined>} [env] */
export function developmentConfig(env = process.env) {
  const ref = env.DEV_SUPABASE_PROJECT_REF?.trim()
  if (!ref || !/^[a-z]{20}$/.test(ref) || findProductionProjectRef(ref)) {
    throw new Error('Set DEV_SUPABASE_PROJECT_REF to an isolated development project, distinct from the production source')
  }
  let api
  try { api = new URL(env.DEV_SUPABASE_URL) } catch { throw new Error('DEV_SUPABASE_URL is required') }
  if (api.protocol !== 'https:' || api.hostname !== `${ref}.supabase.co` || api.port || api.username || api.password) {
    throw new Error('Development API must match DEV_SUPABASE_PROJECT_REF')
  }
  const database = parseUrl(env.DEV_DATABASE_URL)
  const direct = database.hostname === `db.${ref}.supabase.co`
  const pooler = /\.pooler\.supabase\.com$/.test(database.hostname) && decodeURIComponent(database.username) === `postgres.${ref}`
  if ((!direct && !pooler) || database.pathname !== '/postgres') throw new Error('Development database must match the isolated Supabase project')
  database.searchParams.set('sslmode', 'verify-full')
  if (!env.DEV_SUPABASE_ANON_KEY || !env.DEV_SUPABASE_SERVICE_ROLE_KEY) throw new Error('Explicit development API keys are required')
  // JWT keys must belong to the selected project. New opaque sb_* keys are
  // scoped by Supabase itself; the API hostname remains pinned above.
  for (const key of [env.DEV_SUPABASE_ANON_KEY, env.DEV_SUPABASE_SERVICE_ROLE_KEY]) {
    if (key.startsWith('eyJ')) {
      let claims
      try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()) } catch { throw new Error('Invalid development API key') }
      if (claims.ref !== ref) throw new Error('Development API key belongs to another project')
    }
  }
  return { ref, url: api.origin, databaseUrl: database.href, anonKey: env.DEV_SUPABASE_ANON_KEY, serviceKey: env.DEV_SUPABASE_SERVICE_ROLE_KEY }
}

/** @param {Record<string, string | undefined>} [env] */
export function migrationTarget(env = process.env, target = 'development') {
  if (target === 'development') {
    const dev = developmentConfig({ ...env, DEV_DATABASE_URL: env.DEV_MIGRATION_DATABASE_URL || env.DEV_DATABASE_URL })
    if (new URL(dev.databaseUrl).port === '6543') throw new Error('Development migrations require the direct connection or session pooler on port 5432')
    return dev.databaseUrl
  }
  if (target !== 'production') throw new Error('Target must be development or production')
  const url = parseUrl(env.PROD_MIGRATION_DATABASE_URL)
  if (!env.PROD_DATABASE_HOST || !env.PROD_DATABASE_NAME || url.hostname !== env.PROD_DATABASE_HOST || decodeURIComponent(url.pathname.slice(1)) !== env.PROD_DATABASE_NAME) {
    throw new Error('Production migration requires an explicit matching PROD_DATABASE_HOST and PROD_DATABASE_NAME')
  }
  if (/supabase\.(co|com)$/.test(url.hostname)) throw new Error('Production target must be independent PostgreSQL')
  if (url.port === '6543') throw new Error('Do not run DDL through a transaction pooler')
  return url.href
}
