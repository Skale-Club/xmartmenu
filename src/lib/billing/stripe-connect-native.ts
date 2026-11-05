import { headers } from 'next/headers'
import { getIdentityServices } from '../auth/identity-services'
import { ownedAuthSelected, ownedSessionToken } from '../auth/owned-principal'
import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { stripe } from '../stripe'
import { getEffectiveTenant } from '../get-effective-tenant'
import { adminChatContext } from '../admin/chat-context'
import { AdminMenuError } from '../data/admin-menus'
import { claimOwnedStripeOAuth, connectOwnedStripe, disconnectOwnedStripe, readOwnedStripeOwnerState, refuseOwnedStripeOAuth } from '../data/stripe-connect-runtime'
import { signOwnedStripeState, verifyOwnedStripeState } from '../stripe-owned-state'
import { publishPendingNativeTenantEffects } from '../tenant-effects/publish-pending'

const OPTIONS = Object.freeze({ timeout: 6000, maxNetworkRetries: 0 })
const base = () => process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
const redirect = (result: string) => NextResponse.redirect(new URL(`${base()}/settings/store?stripe=${result}`))
function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof AdminMenuError ? error.message : 'Stripe connection is unavailable' }, { status: error instanceof AdminMenuError ? error.status : 503 })
}
async function actor() {
  if (!ownedAuthSelected()) throw new AdminMenuError(503, 'Native browser authentication is required')
  const effective = await getEffectiveTenant()
  if (!effective) throw new AdminMenuError(401, 'Unauthorized')
  if (effective.role !== 'store-admin' && effective.role !== 'superadmin') throw new AdminMenuError(403, 'Forbidden')
  const context = await adminChatContext(effective), current = await headers(), { config, store } = getIdentityServices()
  const token = ownedSessionToken(current.get('cookie'), new URL(config.origin).protocol === 'https:')
  if (!token) throw new AdminMenuError(401, 'Sign in again')
  const session = await store.session(token)
  if (!session || session.userId !== context.actorId) throw new AdminMenuError(403, 'Current browser session is required')
  return { ...context, sessionHash: createHash('sha256').update(token).digest('hex') }
}
export async function startOwnedStripeConnect() {
  try {
    const context = await actor(), state = await readOwnedStripeOwnerState(context)
    if (!state.feature) return redirect('feature_not_available')
    if (state.connection) return redirect('already_connected')
    const clientId = process.env.STRIPE_CLIENT_ID
    if (!clientId || !process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })
    const params = new URLSearchParams({ response_type: 'code', client_id: clientId, scope: 'read_write', redirect_uri: `${base()}/api/stripe/connect/callback`, state: signOwnedStripeState(context.actorId, state.tenantId) })
    return NextResponse.redirect(new URL(`https://connect.stripe.com/oauth/authorize?${params}`))
  } catch (error) {
    if (error instanceof AdminMenuError && error.status === 401) return NextResponse.redirect(new URL('/auth/login', base()))
    return errorResponse(error)
  }
}
export async function finishOwnedStripeConnect(request: Request) {
  const params = new URL(request.url).searchParams
  if (params.get('error') === 'access_denied') return redirect('access_denied')
  const code = params.get('code'), encoded = params.get('state')
  if (!code) return redirect('missing_code')
  if (!encoded) return redirect('invalid_state')
  try {
    const signed = verifyOwnedStripeState(encoded)
    if (!signed) return redirect('invalid_state')
    const context = await actor()
    if (context.actorId !== signed.actorId || context.tenantId !== signed.tenantId) return redirect('invalid_state')
    const before = await readOwnedStripeOwnerState(context)
    if (!before.feature) return redirect('feature_not_available')
    const proof = { nonceHash: signed.nonceHash, codeHash: createHash('sha256').update(code).digest('hex'), expiresAt: signed.expiresAt }
    const claimed = await claimOwnedStripeOAuth(context, proof)
    if (claimed === 'connected') return redirect('connected')
    if (claimed !== 'claimed') return redirect('invalid_state')
    if (Date.now() > signed.expiresAt) { await refuseOwnedStripeOAuth(context, proof); return redirect('invalid_state') }
    let accountId: string | undefined
    let grantedScope: string | undefined
    try {
      const response = await stripe.oauth.token({ grant_type: 'authorization_code', code }, OPTIONS)
      accountId = response.stripe_user_id
      grantedScope = response.scope
    } catch { await refuseOwnedStripeOAuth(context, proof); return redirect('exchange_failed') }
    if (grantedScope !== 'read_write') {
      await refuseOwnedStripeOAuth(context, proof, typeof accountId === 'string' && /^acct_[A-Za-z0-9]+$/.test(accountId) ? accountId : undefined)
      return redirect('exchange_failed')
    }
    if (typeof accountId !== 'string' || !/^acct_[A-Za-z0-9]+$/.test(accountId)) { await refuseOwnedStripeOAuth(context, proof); return redirect('exchange_failed') }
    try {
      const current = await actor()
      if (current.actorId !== context.actorId || current.tenantId !== context.tenantId || current.sessionHash !== context.sessionHash) throw new AdminMenuError(403, 'Stripe actor changed')
      await connectOwnedStripe(current, accountId, proof)
    }
    catch (error) {
      await refuseOwnedStripeOAuth(context, proof, accountId)
      if (error instanceof AdminMenuError && error.status === 403) return error.message === 'Stripe feature is unavailable' ? redirect('feature_not_available') : errorResponse(error)
      return redirect('db_error')
    }
    await publishPendingNativeTenantEffects(signed.tenantId).catch(() => {})
    return redirect('connected')
  } catch (error) { return errorResponse(error) }
}
export async function stopOwnedStripeConnect() {
  try {
    const context = await actor(), connection = await disconnectOwnedStripe(context)
    // Source .single() rejects a zero-row update; retain that response.
    if (!connection) return NextResponse.json({ error: 'Failed to disconnect Stripe account' }, { status: 500 })
    if (context.tenantId) await publishPendingNativeTenantEffects(context.tenantId).catch(() => {})
    const clientId = process.env.STRIPE_CLIENT_ID
    if (clientId) {
      try { await stripe.oauth.deauthorize({ client_id: clientId, stripe_user_id: connection.accountId }, OPTIONS) }
      catch { /* The authorized local disconnect has already committed. */ }
    }
    return NextResponse.json({ success: true, disconnected: true })
  } catch (error) { return errorResponse(error) }
}
