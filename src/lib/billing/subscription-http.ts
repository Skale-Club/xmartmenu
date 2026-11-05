import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { getEffectiveTenant } from '../get-effective-tenant'
import { getOwnedPrincipal } from '../auth/owned-principal-runtime'
import { ownedAuthSelected, ownedSessionToken } from '../auth/owned-principal'
import { getIdentityServices } from '../auth/identity-services'
import { assertSuperadmin } from '../superadmin-auth'
import { AdminMenuError } from '../data/admin-menus'
import { readOwnedSubscriptionApi, readOwnedSuperSubscription, subscriptionTransactions } from '../data/subscription-billing-runtime'
import { validateSubscriptionPatch, type SubscriptionActor } from '../data/subscription-billing'
import { subscriptionGateway } from './subscription-provider'
import { changeNativeSubscription, nativeSubscriptionPortal } from './subscription-native'
import { PlanChangeError } from './plan-change-model'

export async function subscriptionActor(effective?: Awaited<ReturnType<typeof getEffectiveTenant>>): Promise<SubscriptionActor> {
  const value = effective ?? await getEffectiveTenant()
  if (!value) throw new AdminMenuError(401, 'Unauthorized')
  const { principal, sessionHash } = await subscriptionSession()
  if (principal.role !== value.role || (principal.role !== 'superadmin' && principal.tenantId !== value.tenantId)) throw new AdminMenuError(403, 'Forbidden')
  return { actorId: principal.userId, tenantId: value.tenantId, role: value.role, sessionHash }
}
async function subscriptionSession() {
  if (!ownedAuthSelected()) throw new AdminMenuError(503, 'Native account authentication is required')
  const principal = await getOwnedPrincipal()
  if (!principal || principal.mustChangePassword) throw new AdminMenuError(401, 'Unauthorized')
  const current = await headers(), { config } = getIdentityServices()
  const token = ownedSessionToken(current.get('cookie'), new URL(config.origin).protocol === 'https:')
  if (!token) throw new AdminMenuError(401, 'Sign in again')
  return { principal, sessionHash: createHash('sha256').update(token).digest('hex') }
}
async function superActor(tenantId: string): Promise<SubscriptionActor> {
  const authorization = await assertSuperadmin()
  if (!authorization) throw new AdminMenuError(401, 'Unauthorized')
  const { principal, sessionHash } = await subscriptionSession()
  if (authorization.mode !== 'owned' || principal.userId !== authorization.principal.userId || principal.role !== 'superadmin') throw new AdminMenuError(403, 'Forbidden')
  return { actorId: principal.userId, tenantId, role: 'superadmin', sessionHash }
}
const dependencies = () => ({ database: subscriptionTransactions, gateway: subscriptionGateway, baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000' })
function errorResponse(error: unknown, portal = false) {
  const status = error instanceof AdminMenuError || error instanceof PlanChangeError ? error.status : 503
  return NextResponse.json({ error: error instanceof AdminMenuError || error instanceof PlanChangeError ? error.message : 'Subscription service is unavailable', ...(portal && error instanceof PlanChangeError ? { portal: status === 409 } : {}) }, { status })
}
export async function nativeSubscriptionGet() {
  try { return NextResponse.json(await readOwnedSubscriptionApi(await subscriptionActor())) } catch (error) { return errorResponse(error) }
}
export async function nativeSubscriptionCycle(request: Request) {
  try {
    const context = await subscriptionActor(), body = await request.json().catch(() => null)
    if (context.role !== 'store-admin' && context.role !== 'superadmin') throw new AdminMenuError(403, 'Forbidden')
    if (body?.billing_cycle !== 'monthly' && body?.billing_cycle !== 'annual') throw new AdminMenuError(400, 'Invalid billing_cycle value')
    const output = await changeNativeSubscription(context, { mode: 'cycle', cycle: body.billing_cycle }, dependencies())
    return NextResponse.json(output.body)
  } catch (error) { return errorResponse(error, true) }
}
export async function nativeSubscriptionCheckout(request: Request) {
  try {
    const context = await subscriptionActor(), body = await request.json().catch(() => ({}))
    if (context.role !== 'store-admin' && context.role !== 'superadmin') throw new AdminMenuError(403, 'Forbidden')
    const output = await changeNativeSubscription(context, { mode: 'checkout', cycle: body?.billing_cycle === 'annual' ? 'annual' : 'monthly', planId: typeof body?.plan_id === 'string' && body.plan_id ? body.plan_id : undefined }, dependencies())
    return NextResponse.json(output.body)
  } catch (error) { return errorResponse(error, true) }
}
export async function nativeSubscriptionPortalPost() {
  try { return NextResponse.json(await nativeSubscriptionPortal(await subscriptionActor(), dependencies())) } catch (error) { return errorResponse(error) }
}
export async function nativeSuperSubscriptionGet(tenantId: string) {
  try { return NextResponse.json(await readOwnedSuperSubscription(await superActor(tenantId))) } catch (error) { return errorResponse(error) }
}
export async function nativeSuperSubscriptionPut(tenantId: string, request: Request) {
  try {
    const context = await superActor(tenantId), body = await request.json().catch(() => null), patch = validateSubscriptionPatch(body)
    const output = await changeNativeSubscription(context, { mode: 'admin', patch, planId: patch.plan_id, cycle: patch.billing_cycle }, dependencies())
    // The CRM intention committed with the subscription. Cache invalidation
    // cannot turn an already committed billing change into a false 503.
    try {
      revalidatePath('/tenants')
      if (output.slug) revalidatePath(`/${output.slug}`, 'layout')
    } catch { /* A later read observes the committed state. */ }
    return NextResponse.json(output.body)
  } catch (error) { return errorResponse(error) }
}
