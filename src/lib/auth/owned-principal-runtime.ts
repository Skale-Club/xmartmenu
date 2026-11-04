import { cache } from 'react'
import { headers } from 'next/headers'
import { getIdentityServices } from './identity-services'
import { ownedAuthSelected, ownedSessionToken, OwnedPrincipalRepository, readOwnedPrincipal, OwnedAuthenticationUnavailable } from './owned-principal'
export { OwnedAuthenticationUnavailable } from './owned-principal'

export function ownedPrincipalRepository() {
  const { pool } = getIdentityServices()
  return new OwnedPrincipalRepository((text, values) => pool.query(text, values))
}

export const getOwnedPrincipal = cache(async () => {
  if (!ownedAuthSelected()) return null
  try {
    const current = await headers(), { config, store } = getIdentityServices()
    const origin = new URL(config.origin)
    if (current.get('host')?.toLowerCase() !== origin.host.toLowerCase()) return null
    return await readOwnedPrincipal(ownedSessionToken(current.get('cookie'), origin.protocol === 'https:'), store, ownedPrincipalRepository())
  } catch { throw new OwnedAuthenticationUnavailable() }
})
