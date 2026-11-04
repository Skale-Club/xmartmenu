import { Pool } from 'pg'
import { IdentityStore } from './identity-store'
import { identityRuntimeConfig } from './identity-runtime-config'
import { createGoogleAccountStatusReader } from './provider-account-status'
import { readGoogleRuntimeAdc } from './google-runtime-adc'
import { getGoogleX509AccessToken } from './google-x509-access-token'

let services: ReturnType<typeof createServices> | undefined

function createServices() {
  if (process.env.GOOGLE_AUTH_ENABLED !== 'true') throw new Error('Identity provider is unavailable')
  const config = identityRuntimeConfig()
  // Shared by the existing identity pilot and the core principal/profile reads.
  const pool = new Pool({ connectionString: config.connectionString, ssl: config.ssl,
    max: 2, connectionTimeoutMillis: 5_000, statement_timeout: 5_000, query_timeout: 6_000, idleTimeoutMillis: 30_000 })
  pool.on('error', () => {})
  const lookup = createGoogleAccountStatusReader(async signal => {
    const current = identityRuntimeConfig()
    if (current.web.projectId !== config.web.projectId || current.projectNumber !== config.projectNumber) throw new Error('Identity project changed')
    const credential = readGoogleRuntimeAdc({ application: 'xmartmenu', projectId: current.web.projectId,
      projectNumber: current.projectNumber, production: process.env.NODE_ENV === 'production' })
    return getGoogleX509AccessToken(credential, signal)
  })
  const status = async (identity: Parameters<typeof lookup>[0]) => {
    if (process.env.GOOGLE_AUTH_ENABLED !== 'true' || identity.projectId !== identityRuntimeConfig().web.projectId) throw new Error('Identity project mismatch')
    return lookup(identity)
  }
  return { config, pool, store: new IdentityStore(pool, status) }
}

export function getIdentityServices() {
  if (process.env.GOOGLE_AUTH_ENABLED !== 'true') throw new Error('Identity provider is unavailable')
  services ??= createServices()
  return services
}
