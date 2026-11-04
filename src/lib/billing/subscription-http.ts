import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getEffectiveTenant } from '../get-effective-tenant'
import { adminChatContext } from '../admin/chat-context'
import { assertSuperadmin } from '../superadmin-auth'
import { AdminMenuError } from '../data/admin-menus'
import { readOwnedSubscriptionApi, readOwnedSuperSubscription, subscriptionTransactions } from '../data/subscription-billing-runtime'
import { validateSubscriptionPatch, type SubscriptionActor } from '../data/subscription-billing'
import { enqueueXphereSync } from '../xphere/queue'
import { subscriptionGateway } from './subscription-provider'
import { changeNativeSubscription, nativeSubscriptionPortal } from './subscription-native'
import { PlanChangeError } from './plan-change-model'

export async function subscriptionActor(effective?: Awaited<ReturnType<typeof getEffectiveTenant>>): Promise<SubscriptionActor> {
  const value = effective ?? await getEffectiveTenant()
  if (!value) throw new AdminMenuError(401, 'Unauthorized')
  return adminChatContext(value)
}
async function superActor(tenantId: string): Promise<SubscriptionActor> {
  const authorization = await assertSuperadmin()
  if (!authorization) throw new AdminMenuError(401, 'Unauthorized')
  return { actorId: authorization.principal.userId, tenantId, role: 'superadmin' }
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
    revalidatePath('/tenants')
    if (output.slug) revalidatePath(`/${output.slug}`, 'layout')
    if (output.sync) await enqueueXphereSync(output.sync.tenantId, output.sync.reason)
    return NextResponse.json(output.body)
  } catch (error) { return errorResponse(error) }
}
