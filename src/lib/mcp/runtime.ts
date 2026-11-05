import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { ownedAdminTransaction } from '../data/admin-menus-runtime'
import { AdminMenuError } from '../data/admin-menus'
import { getOwnedPrincipal } from '../auth/owned-principal-runtime'
import { ownedAuthSelected, ownedSessionToken } from '../auth/owned-principal'
import { getIdentityServices } from '../auth/identity-services'
import { credential, mcpOrigin, nativeMcpSelected } from './oauth-model'
import { NativeMcpOAuthStore, type McpDatabase } from './data/oauth'
import { currentMcpIdentity, McpCapabilityIssuer, readMcpIdentity, refreshMcpCapability, requireMcpAuthority, type McpActor } from './data/authority'
import type { ToolExtra } from './helpers'

let pinnedOrigin:string|undefined
export function nativeMcpConfiguration() {
  if (!nativeMcpSelected() || !ownedAuthSelected()) throw new AdminMenuError(503,'Native MCP authentication is unavailable')
  const config=mcpOrigin(),identity=getIdentityServices()
  if (config.issuer!==identity.config.origin || (pinnedOrigin && pinnedOrigin!==config.issuer)) throw new AdminMenuError(503,'MCP configuration changed; restart required')
  pinnedOrigin=config.issuer
  return { ...config,identity }
}
export const nativeMcpOAuthStore = () => {
  const { issuer,resource,identity }=nativeMcpConfiguration()
  return new NativeMcpOAuthStore({ run:ownedAdminTransaction },identity.customerAccount,issuer,resource)
}
export async function nativeMcpBrowserActor() {
  const { identity }=nativeMcpConfiguration(),principal=await getOwnedPrincipal()
  if (!principal) throw new AdminMenuError(401,'Sign in again')
  if (principal.role!=='superadmin' || principal.mustChangePassword) throw new AdminMenuError(403,'Current platform administrator access is required')
  const token=ownedSessionToken((await headers()).get('cookie'),new URL(identity.config.origin).protocol==='https:')
  if (!token) throw new AdminMenuError(401,'Sign in again')
  return { actorId:principal.userId,sessionHash:createHash('sha256').update(token).digest('hex') }
}
export async function nativeMcpBearer(token:string):Promise<McpActor> {
  const hash=credential(token,'access'),{ resource,identity }=nativeMcpConfiguration()
  const issuer=new McpCapabilityIssuer(value=>ownedAdminTransaction(false,query=>readMcpIdentity(query,value,resource)),identity.customerAccount)
  return issuer.issue(hash)
}
export async function nativeMcpActor(extra:ToolExtra):Promise<McpActor> {
  const actor=extra.authInfo?.extra?.nativeMcpActor as McpActor|undefined
  if(actor) await refreshMcpCapability(actor.oauth)
  if (!actor || currentMcpIdentity(actor.oauth).userId!==actor.actorId) throw new AdminMenuError(401,'Current MCP authorization is required')
  return actor
}
export function nativeMcpDatabase(actor:McpActor):McpDatabase {
  return { async run(write,operation) {
    nativeMcpConfiguration()
    // Current provider lookup occurs outside SQL. The SQL capability/account/
    // binding/role guard is repeated inside each short phase as well.
    await refreshMcpCapability(actor.oauth)
    return ownedAdminTransaction(write,async query=>{ await requireMcpAuthority(query,actor,write); return operation(query) })
  } }
}
