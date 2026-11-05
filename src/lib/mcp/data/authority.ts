import { AdminMenuError, type AdminMenuQuery } from '../../data/admin-menus'
import { UUID } from '../../auth/owned-principal'
import { assertProviderAccountActive, type ProviderAccountStatusReader } from '../../auth/provider-account-status'

export type McpOAuthCapability = Readonly<{ tokenHash: string; requiredScope: 'mcp:admin' }>
export type NativeAdminAuthority = { sessionHash: string; oauth?: never } | { sessionHash?: never; oauth: McpOAuthCapability }
export interface McpActor { actorId: string; oauth: McpOAuthCapability }
export interface McpIdentity {
  userId: string; clientId: string; grantId: string; resource: string; projectId: string; subject: string
  authenticatedAt: number; expiresAt: number; role: 'superadmin'; scopes: string[]; clientOrigins:string[]
}
type Proof = { identity: McpIdentity; checkedAt: number; issuer: McpCapabilityIssuer }
const proofs = new WeakMap<McpOAuthCapability, Proof>()
const HASH = /^[a-f0-9]{64}$/
function refuse(): never { throw new AdminMenuError(403, 'Current MCP administrator authority is required') }
const seconds = (value: unknown) => {
  const time = value instanceof Date ? value.getTime() : new Date(String(value)).getTime()
  if (!Number.isFinite(time)) refuse()
  return Math.floor(time / 1000)
}
function identity(rows: Record<string,unknown>[], resource: string): McpIdentity {
  const row = rows[0]
  if (rows.length !== 1 || !row || typeof row.id !== 'string' || !UUID.test(row.id)
    || typeof row.grant_id !== 'string' || !UUID.test(row.grant_id) || typeof row.client_id !== 'string'
    || row.resource !== resource || typeof row.project_id !== 'string' || typeof row.subject !== 'string'
    || !Array.isArray(row.scopes) || row.scopes.some(scope => scope !== 'mcp:admin') || !Array.isArray(row.redirect_uris) || !row.redirect_uris.length) refuse()
  const clientOrigins=[...new Set(row.redirect_uris.map(value=>{ if(typeof value!=='string') return refuse(); try { return new URL(value).origin } catch { return refuse() } }))]
  return { userId: row.id, clientId: row.client_id, grantId: row.grant_id, resource, projectId: row.project_id,
    subject: row.subject, authenticatedAt: seconds(row.authenticated_at), expiresAt: seconds(row.expires_at), role: 'superadmin', scopes: row.scopes,clientOrigins }
}
export async function readMcpGrant(query: AdminMenuQuery, grantId: string, resource: string, lock = false): Promise<McpIdentity> {
  if (!UUID.test(grantId)) refuse()
  return identity((await query(`SELECT p.id,g.id AS grant_id,g.client_id,g.resource,g.project_id,g.subject,g.authenticated_at,g.expires_at,g.scopes,c.redirect_uris
    FROM public.app_mcp_grants g JOIN public.app_mcp_clients c ON c.id=g.client_id
    JOIN public.app_accounts a ON a.id=g.user_id JOIN public.profiles p ON p.id=a.id
    JOIN public.app_identity_bindings b ON b.user_id=a.id AND b.project_id=g.project_id AND b.subject=g.subject
    WHERE g.id=$1 AND g.resource=$2 AND g.expires_at>now() AND g.revoked_at IS NULL AND c.disabled_at IS NULL
      AND g.scopes @> ARRAY['mcp:admin']::text[] AND g.session_version=a.session_version
      AND a.disabled_at IS NULL AND b.disabled_at IS NULL AND NOT coalesce(p.must_change_password,false)
      AND p.role IN ('superadmin','super-admin') ${lock ? 'FOR SHARE OF p,a,b,c,g' : ''}`, [grantId,resource])).rows,resource)
}

/** SQL is repeated inside every domain phase. No browser session is created. */
export async function readMcpIdentity(query: AdminMenuQuery, tokenHash: string, resource: string, lock = false): Promise<McpIdentity> {
  if (!HASH.test(tokenHash)) refuse()
  const rows = (await query(`SELECT p.id,p.role,p.tenant_id,p.must_change_password,a.disabled_at,
      g.id AS grant_id,g.client_id,g.resource,g.project_id,g.subject,g.authenticated_at,t.expires_at,g.scopes,c.redirect_uris
    FROM public.app_mcp_tokens t JOIN public.app_mcp_grants g ON g.id=t.grant_id
    JOIN public.app_mcp_clients c ON c.id=g.client_id JOIN public.app_accounts a ON a.id=g.user_id
    JOIN public.profiles p ON p.id=a.id
    JOIN public.app_identity_bindings b ON b.user_id=a.id AND b.project_id=g.project_id AND b.subject=g.subject
    WHERE t.token_hash=$1 AND t.kind='access' AND t.consumed_at IS NULL AND t.expires_at>now()
      AND g.resource=$2 AND g.expires_at>now() AND g.revoked_at IS NULL AND c.disabled_at IS NULL
      AND g.scopes @> ARRAY['mcp:admin']::text[] AND g.session_version=a.session_version
      AND a.disabled_at IS NULL AND b.disabled_at IS NULL AND NOT coalesce(p.must_change_password,false)
      AND p.role IN ('superadmin','super-admin') ${lock ? 'FOR SHARE OF p,a,b,c,g,t' : ''}`, [tokenHash, resource])).rows
  return identity(rows,resource)
}

/** Only this server-issued object carries a current provider-read proof. A JSON
 * payload with matching fields is not an authority object. The reader is
 * injected in offline tests; production uses the existing bounded Google read. */
export class McpCapabilityIssuer {
  constructor(private readonly read: (hash: string) => Promise<McpIdentity>, private readonly provider: ProviderAccountStatusReader,
    private readonly clock: () => number = Date.now) {}
  async issue(tokenHash: string): Promise<McpActor> {
    const identity = await this.read(tokenHash)
    assertProviderAccountActive(await this.provider(identity), identity.authenticatedAt)
    const oauth = Object.freeze({ tokenHash, requiredScope: 'mcp:admin' as const })
    proofs.set(oauth, { identity, checkedAt: this.clock(), issuer: this })
    return { actorId: identity.userId, oauth }
  }
  async refresh(oauth: McpOAuthCapability) {
    const proof = proofs.get(oauth)
    if (!proof || proof.issuer !== this) refuse()
    const age = this.clock() - proof.checkedAt
    if (age >= 0 && age < 5000) return
    const identity = await this.read(oauth.tokenHash)
    if (identity.userId !== proof.identity.userId || identity.grantId !== proof.identity.grantId || identity.clientId !== proof.identity.clientId
      || identity.projectId !== proof.identity.projectId || identity.subject !== proof.identity.subject || identity.authenticatedAt !== proof.identity.authenticatedAt) refuse()
    assertProviderAccountActive(await this.provider(identity), identity.authenticatedAt)
    proofs.set(oauth, { identity, checkedAt: this.clock(), issuer: this })
  }
}
export function currentMcpIdentity(oauth: McpOAuthCapability): McpIdentity {
  const proof = proofs.get(oauth), age = proof ? Date.now() - proof.checkedAt : Infinity
  if (!proof || age < 0 || age > 10000 || oauth.requiredScope !== 'mcp:admin') refuse()
  return proof.identity
}
export async function refreshMcpCapability(oauth: McpOAuthCapability) {
  const proof = proofs.get(oauth)
  if (!proof) refuse()
  await proof.issuer.refresh(oauth)
}
/** Closed authority union: both/neither is refused at runtime as well as TS. */
export function oauthAuthority(context: NativeAdminAuthority): McpOAuthCapability | undefined {
  const browser = context.sessionHash !== undefined, oauth = context.oauth !== undefined
  if (browser === oauth) refuse()
  if (oauth) { currentMcpIdentity(context.oauth!); return context.oauth }
  return undefined
}
export async function requireMcpAuthority(query: AdminMenuQuery, context: McpActor, write = false) {
  const proof = currentMcpIdentity(context.oauth)
  if (!UUID.test(context.actorId) || context.actorId !== proof.userId) refuse()
  if (write) await query("SELECT pg_advisory_xact_lock(hashtextextended('xmartmenu-account-authority',0))")
  const identity = await readMcpIdentity(query, context.oauth.tokenHash, proof.resource, write)
  if (identity.userId !== context.actorId || identity.grantId !== proof.grantId || identity.clientId !== proof.clientId
    || identity.projectId !== proof.projectId || identity.subject !== proof.subject || identity.authenticatedAt !== proof.authenticatedAt) refuse()
  return { id: identity.userId, role: identity.role, tenant_id: null, must_change_password: false,
    disabled_at: null, authenticated_at: new Date(identity.authenticatedAt * 1000) }
}
