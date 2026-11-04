import { AdminMenuError, type AdminMenuQuery } from './admin-menus'
import { authorizeAdminActor, type AdminActorContext } from './admin-actor'
import { readPublicChatAddon } from './public-chat-session'

export async function readChatAddonBilling(query: AdminMenuQuery, context: AdminActorContext, checkout: boolean) {
  await authorizeAdminActor(query, context)
  if (!context.tenantId) throw new AdminMenuError(403, 'Forbidden')
  const status = checkout ? (await readPublicChatAddon(query, context.tenantId)).status : null
  const result = await query('SELECT stripe_customer_id,chat_addon_active FROM public.tenant_subscriptions WHERE tenant_id=$1 LIMIT 2', [context.tenantId])
  if (result.rows.length > 1) throw new AdminMenuError(503, 'Subscription information is unavailable')
  const row = result.rows[0]
  return { status, customerId: typeof row?.stripe_customer_id === 'string' ? row.stripe_customer_id : null, active: row?.chat_addon_active === true }
}
export async function writeChatAddonOverride(query: AdminMenuQuery, context: AdminActorContext, override: unknown) {
  if (context.role !== 'superadmin' || !context.tenantId) throw new AdminMenuError(403, 'Forbidden')
  await authorizeAdminActor(query, context, true)
  if (override !== true && override !== false && override !== null) throw new AdminMenuError(400, 'override must be true, false, or null')
  // Preserve the existing update-only/no-row success contract; never create a
  // subscription or alter its plan, paid-active state, periods or Stripe IDs.
  await query('UPDATE public.tenant_subscriptions SET chat_addon_override=$2 WHERE tenant_id=$1', [context.tenantId, override])
  return { ok: true }
}
