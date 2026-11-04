import { cache } from 'react'
import { getIdentityServices } from './identity-services'
import { OwnedShellRepository } from './owned-shell'
import type { OwnedPrincipal } from './owned-principal'

export function ownedShellRepository() {
  const { pool } = getIdentityServices()
  return new OwnedShellRepository((text, values) => pool.query(text, values))
}
export const getOwnedShellPlatform = cache(async () => {
  try { return await ownedShellRepository().platform() }
  catch { throw new Error('Panel appearance is temporarily unavailable') }
})
export const getOwnedShellTenant = cache(async (principal: OwnedPrincipal, tenantId: string) => {
  try { return await ownedShellRepository().tenant(principal, tenantId) }
  catch { throw new Error('Panel context is temporarily unavailable') }
})
