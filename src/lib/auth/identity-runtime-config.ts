import { assertConnectionQuery, developmentConfig } from '../../../scripts/lib/database-target.mjs'

/** Legacy proof reads use the isolated provider in dev, even outside npm dev. */
export function identityLegacyProofConfig(env: Record<string, string | undefined> = process.env) {
  if (env.NODE_ENV !== 'production') {
    const dev = developmentConfig(env)
    return { url: dev.url, anonKey: dev.anonKey }
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Legacy account proof unavailable')
  return { url, anonKey }
}

export function identityRuntimeConfig(env: Record<string, string | undefined> = process.env) {
  const production = env.NODE_ENV === 'production'
  const productionId = env.GOOGLE_AUTH_PROJECT_ID || 'skaleclub'
  const productionNumber = env.GOOGLE_AUTH_PROJECT_NUMBER || (productionId === 'skaleclub' ? '937861185231' : '')
  const projectId = (production ? env.GOOGLE_AUTH_PROJECT_ID : env.DEV_GOOGLE_AUTH_PROJECT_ID) ?? ''
  const projectNumber = (production ? productionNumber : env.DEV_GOOGLE_AUTH_PROJECT_NUMBER) ?? ''
  const apiKey = (production ? env.GOOGLE_AUTH_WEB_API_KEY : env.DEV_GOOGLE_AUTH_WEB_API_KEY) ?? ''
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) || !apiKey) throw new Error('Identity provider configuration required')
  if (!/^[1-9]\d{5,19}$/.test(projectNumber)) throw new Error('Explicit identity project number required')
  if (!production && (projectId === 'skaleclub' || projectId === productionId || projectNumber === '937861185231'
    || projectNumber === productionNumber || apiKey === env.GOOGLE_AUTH_WEB_API_KEY)) throw new Error('Development identity must use a separate Google project')
  if (env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Identity emulator is not permitted')
  let origin: URL
  try { origin = new URL(env.IDENTITY_ORIGIN ?? '') } catch { throw new Error('Explicit identity origin required') }
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || (origin.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && origin.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) throw new Error('Invalid identity origin')
  let connectionString: string
  let ssl: false | { rejectUnauthorized: true }
  if (env.NODE_ENV !== 'production') {
    connectionString = developmentConfig(env).databaseUrl
    ssl = { rejectUnauthorized: true }
  } else {
    let target: URL
    try { target = new URL(env.IDENTITY_DATABASE_URL ?? '') } catch { throw new Error('Explicit identity database required') }
    assertConnectionQuery(target)
    if (!['postgres:', 'postgresql:'].includes(target.protocol) || !env.PROD_DATABASE_HOST || !env.PROD_DATABASE_NAME
      || target.hostname !== env.PROD_DATABASE_HOST || decodeURIComponent(target.pathname.slice(1)) !== env.PROD_DATABASE_NAME
      || /supabase\.(co|com)$/.test(target.hostname) || target.port === '6543') throw new Error('Identity database must match the independent production target')
    if (env.IDENTITY_DATABASE_SSL && !['require', 'disable'].includes(env.IDENTITY_DATABASE_SSL)) throw new Error('Invalid identity database TLS setting')
    connectionString = target.href
    ssl = env.IDENTITY_DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: true }
  }
  const database = new URL(connectionString)
  // pg connection-string sslmode options otherwise override the explicit TLS
  // decision above, including the mandatory TLS for isolated Supabase dev.
  for (const key of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslpassword']) database.searchParams.delete(key)
  return { origin: origin.origin, connectionString: database.href, ssl, projectNumber,
    web: { projectId, apiKey, authDomain: `${projectId}.firebaseapp.com` } }
}
