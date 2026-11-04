import { AdminMenuError, type AdminMenuQuery } from './admin-menus'
import { authorizeAdminActor, type AdminActorContext } from './admin-actor'
import { readNativeTenantPlan } from './tenant-plan'
import { planCeiling } from '../service-modes'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const unavailable = () => new AdminMenuError(503, 'Stripe connection is unavailable')
export interface NativeStripeConnection {
  id: string; tenant_id: string; stripe_account_id: string; scope: string; is_active: boolean
  connected_at: string | null; disconnected_at: string | null; created_at: string | null; updated_at: string | null
}
export interface NativeStripeOAuthAttempt { nonceHash: string; codeHash: string; expiresAt: number }
function attempt(value: NativeStripeOAuthAttempt, now: Date, fresh = false) {
  if (!/^[a-f0-9]{64}$/.test(value.nonceHash) || !/^[a-f0-9]{64}$/.test(value.codeHash) || !Number.isFinite(now.getTime())
    || !Number.isSafeInteger(value.expiresAt) || (fresh && (value.expiresAt < now.getTime() || value.expiresAt - now.getTime() > 16 * 60 * 1000))) throw unavailable()
}
function timestamp(value: unknown): string | null {
  if (value === null) return null
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value
  throw unavailable()
}
function tenant(value: string) { if (!UUID.test(value)) throw unavailable(); return value }
async function owner(query: AdminMenuQuery, context: AdminActorContext, write = false): Promise<string> {
  if (!context.tenantId) throw new AdminMenuError(403, 'Forbidden')
  const id = tenant(context.tenantId)
  if (write && !(await query('SELECT id FROM public.tenants WHERE id=$1 FOR NO KEY UPDATE', [id])).rows.length) throw unavailable()
  await authorizeAdminActor(query, context, write)
  return id
}
/** Trusted server callers already scope the tenant; no Auth or provider API. */
export async function readNativeStripeConnection(query: AdminMenuQuery, tenantId: string): Promise<NativeStripeConnection | null> {
  const result = await query(`SELECT id,tenant_id,stripe_account_id,scope,is_active,connected_at,disconnected_at,created_at,updated_at
    FROM public.stripe_connections WHERE tenant_id=$1 AND is_active=true LIMIT 2`, [tenant(tenantId)])
  if (result.rows.length > 1) throw unavailable()
  const row = result.rows[0]
  if (!row) return null
  if (typeof row.id !== 'string' || !UUID.test(row.id) || row.tenant_id !== tenantId || typeof row.stripe_account_id !== 'string'
    || !row.stripe_account_id || row.stripe_account_id.length > 255 || typeof row.scope !== 'string' || row.is_active !== true) throw unavailable()
  return { id: row.id, tenant_id: tenantId, stripe_account_id: row.stripe_account_id, scope: row.scope, is_active: true,
    connected_at: timestamp(row.connected_at), disconnected_at: timestamp(row.disconnected_at), created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at) }
}
export async function readNativeStripeAvailability(query: AdminMenuQuery, tenantId: string) {
  const feature = await readNativeStripeFeature(query, tenantId)
  return { feature, connection: feature ? await readNativeStripeConnection(query, tenantId) : null }
}
export async function readNativeStripeFeature(query: AdminMenuQuery, tenantId: string) {
  return planCeiling((await readNativeTenantPlan(query, tenant(tenantId)))?.features ?? []).stripe
}
export async function readNativeStripeCurrency(query: AdminMenuQuery, tenantId: string) {
  const result = await query('SELECT currency FROM public.tenant_settings WHERE tenant_id=$1 LIMIT 2', [tenant(tenantId)])
  if (result.rows.length > 1) throw unavailable()
  const currency = result.rows[0]?.currency
  if (currency == null || currency === '') return 'usd'
  if (typeof currency !== 'string' || !/^[a-z]{3}$/i.test(currency)) throw unavailable()
  return currency.toLowerCase()
}
export async function readNativeStripeOwnerState(query: AdminMenuQuery, context: AdminActorContext) {
  const id = await owner(query, context)
  return { tenantId: id, ...await readNativeStripeAvailability(query, id) }
}
/** Persist after exchange, rechecking actor and current plan in this transaction. */
export async function connectNativeStripe(query: AdminMenuQuery, context: AdminActorContext, accountId: string, now = new Date()) {
  const id = await owner(query, context, true)
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId) || accountId.length > 255 || !Number.isFinite(now.getTime())) throw unavailable()
  if (!planCeiling((await readNativeTenantPlan(query, id, true))?.features ?? []).stripe) throw new AdminMenuError(403, 'Stripe feature is unavailable')
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,190739))', [accountId])
  const other = await query('SELECT tenant_id FROM public.stripe_connections WHERE stripe_account_id=$1 AND tenant_id<>$2 LIMIT 1', [accountId, id])
  if (other.rows.length) throw new AdminMenuError(409, 'Stripe account is already associated with another tenant')
  await query(`INSERT INTO public.stripe_connections(tenant_id,stripe_account_id,scope,connected_at,disconnected_at,is_active)
    VALUES($1,$2,'read_write',$3,NULL,true) ON CONFLICT(tenant_id) DO UPDATE SET stripe_account_id=EXCLUDED.stripe_account_id,
    scope=EXCLUDED.scope,connected_at=EXCLUDED.connected_at,disconnected_at=NULL,is_active=true`, [id, accountId, now.toISOString()])
}
export async function disconnectNativeStripe(query: AdminMenuQuery, context: AdminActorContext, now = new Date()) {
  const id = await owner(query, context, true)
  if (!Number.isFinite(now.getTime())) throw unavailable()
  const result = await query('UPDATE public.stripe_connections SET is_active=false,disconnected_at=$2 WHERE tenant_id=$1 AND is_active=true RETURNING id,stripe_account_id', [id, now.toISOString()])
  if (result.rows.length > 1) throw unavailable()
  const row = result.rows[0]
  if (!row) return null
  if (typeof row.stripe_account_id !== 'string' || !row.stripe_account_id) throw unavailable()
  return { accountId: row.stripe_account_id }
}

/** OAuth token exchange is not idempotent: commit this claim before network. */
export async function claimNativeStripeOAuth(query: AdminMenuQuery, context: AdminActorContext, proof: NativeStripeOAuthAttempt, now = new Date()): Promise<'claimed' | 'connected' | 'refused'> {
  attempt(proof, now, true)
  const id = await owner(query, context, true)
  if (!await readNativeStripeFeature(query, id)) throw new AdminMenuError(403, 'Stripe feature is unavailable')
  const result = await query('SELECT * FROM public.app_stripe_oauth_attempts WHERE nonce_hash=$1 OR code_hash=$2 LIMIT 3 FOR UPDATE', [proof.nonceHash, proof.codeHash])
  if (result.rows.length) {
    if (result.rows.length !== 1) return 'refused'
    const row = result.rows[0]
    if (row.nonce_hash !== proof.nonceHash || row.code_hash !== proof.codeHash || row.actor_id !== context.actorId || row.tenant_id !== id
      || row.original_actor_id !== context.actorId || row.original_tenant_id !== id || row.state !== 'connected') return 'refused'
    const connection = await readNativeStripeConnection(query, id)
    return connection?.stripe_account_id === row.stripe_account_id ? 'connected' : 'refused'
  }
  await query(`INSERT INTO public.app_stripe_oauth_attempts(nonce_hash,code_hash,actor_id,tenant_id,original_actor_id,original_tenant_id,created_at,expires_at,state)
    VALUES($1,$2,$3,$4,$3,$4,$5,$6,'claimed')`, [proof.nonceHash, proof.codeHash, context.actorId, id, now.toISOString(), new Date(proof.expiresAt).toISOString()])
  return 'claimed'
}
export async function completeNativeStripeOAuth(query: AdminMenuQuery, context: AdminActorContext, proof: NativeStripeOAuthAttempt, accountId: string, now = new Date()) {
  attempt(proof, now)
  const id = await owner(query, context, true)
  const claimed = await query(`SELECT nonce_hash FROM public.app_stripe_oauth_attempts WHERE nonce_hash=$1 AND code_hash=$2 AND actor_id=$3 AND tenant_id=$4
    AND original_actor_id=$3 AND original_tenant_id=$4 AND state='claimed' FOR UPDATE`, [proof.nonceHash, proof.codeHash, context.actorId, id])
  if (claimed.rows.length !== 1) throw unavailable()
  await connectNativeStripe(query, context, accountId, now)
  await query("UPDATE public.app_stripe_oauth_attempts SET state='connected',stripe_account_id=$2,completed_at=$3 WHERE nonce_hash=$1", [proof.nonceHash, accountId, now.toISOString()])
}
/** State-only cleanup stays possible after actor/tenant deletion or revocation. */
export async function refuseNativeStripeOAuth(query: AdminMenuQuery, context: AdminActorContext, proof: NativeStripeOAuthAttempt, accountId?: string) {
  attempt(proof, new Date())
  if (accountId !== undefined && (!/^acct_[A-Za-z0-9]+$/.test(accountId) || accountId.length > 255)) throw unavailable()
  await query(`UPDATE public.app_stripe_oauth_attempts SET state='reconcile_required',stripe_account_id=$5,completed_at=NULL
    WHERE nonce_hash=$1 AND code_hash=$2 AND original_actor_id=$3 AND original_tenant_id=$4 AND state='claimed'`, [proof.nonceHash, proof.codeHash, context.actorId, context.tenantId, accountId ?? null])
}
