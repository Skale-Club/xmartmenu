import { cache } from 'react'
import { headers } from 'next/headers'
import { getIdentityServices } from './identity-services'
import { getOwnedPrincipal } from './owned-principal-runtime'
import { OwnedAuthenticationUnavailable, ownedAuthSelected, ownedSessionToken } from './owned-principal'
import { readOwnedCustomer } from './owned-customer'

export const getOwnedCustomer = cache(async () => {
  if (!ownedAuthSelected()) return null
  try {
    const principal = await getOwnedPrincipal()
    if (!principal) return null
    const { config,pool,customerAccount } = getIdentityServices(), current = await headers()
    const token = ownedSessionToken(current.get('cookie'),new URL(config.origin).protocol === 'https:')
    return readOwnedCustomer(principal,token,(text,values) => pool.query(text,values),customerAccount)
  } catch { throw new OwnedAuthenticationUnavailable() }
})
