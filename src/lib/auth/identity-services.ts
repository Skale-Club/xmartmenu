import { sharedPoolForConfig } from '../data/shared-pool'
import { IdentityStore } from './identity-store'
import { identityRuntimeConfig } from './identity-runtime-config'
import { createGoogleAccountStatusReader } from './provider-account-status'
import { readGoogleRuntimeAdc } from './google-runtime-adc'
import { getGoogleX509AccessToken } from './google-x509-access-token'
import { createGoogleCustomerAccountReader } from './google-customer-account'

let services: ReturnType<typeof createServices> | undefined

function createServices() {
  if (process.env.GOOGLE_AUTH_ENABLED !== 'true') throw new Error('Identity provider is unavailable')
  const config = identityRuntimeConfig()
  // Shared by the existing identity pilot and the core principal/profile reads,
  // and — when the URLs match — by every other owned repository (shared-pool.ts).
  const pool = sharedPoolForConfig(config)
  const accessToken = async (signal: AbortSignal) => {
    const current = identityRuntimeConfig()
    if (current.web.projectId !== config.web.projectId || current.projectNumber !== config.projectNumber) throw new Error('Identity project changed')
    const credential = readGoogleRuntimeAdc({ application: 'xmartmenu', projectId: current.web.projectId,
      projectNumber: current.projectNumber, production: process.env.NODE_ENV === 'production' })
    return getGoogleX509AccessToken(credential, signal)
  }
  const lookup = createGoogleAccountStatusReader(accessToken)
  const metadata = createGoogleCustomerAccountReader(accessToken)
  const status = async (identity: Parameters<typeof lookup>[0]) => {
    if (process.env.GOOGLE_AUTH_ENABLED !== 'true' || identity.projectId !== identityRuntimeConfig().web.projectId) throw new Error('Identity project mismatch')
    return lookup(identity)
  }
  const customerAccount = async (identity: Parameters<typeof metadata>[0]) => {
    if (process.env.GOOGLE_AUTH_ENABLED !== 'true' || identity.projectId !== config.web.projectId || identity.projectId !== identityRuntimeConfig().web.projectId) throw new Error('Identity project mismatch')
    return metadata(identity)
  }
  return { config, pool, customerAccount, store: new IdentityStore(pool, status,customerAccount) }
}

export function getIdentityServices() {
  if (process.env.GOOGLE_AUTH_ENABLED !== 'true') throw new Error('Identity provider is unavailable')
  services ??= createServices()
  return services
}
