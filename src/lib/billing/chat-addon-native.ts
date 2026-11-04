import { stripe } from '../stripe'
import { AdminMenuError } from '../data/admin-menus'
import type { AdminActorContext } from '../data/admin-actor'
import { readOwnedChatAddonBilling } from '../data/chat-addon-billing-runtime'

/** SQL admission finishes before the existing Stripe mutation starts. */
export async function createOwnedChatAddonCheckout(context: AdminActorContext) {
  const metadata = await readOwnedChatAddonBilling(context, true)
  if (!metadata.status?.available) throw new AdminMenuError(403, 'The AI chat add-on is not available on your plan')
  const priceId = process.env.STRIPE_CHAT_ADDON_PRICE_ID
  if (!priceId) throw new AdminMenuError(503, 'Addon price not configured')
  if (metadata.active) throw new AdminMenuError(409, 'The AI Chat Addon is already active.')
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription', line_items: [{ price: priceId, quantity: 1 }], customer: metadata.customerId ?? undefined,
    metadata: { tenant_id: context.tenantId!, addon: 'chat' }, subscription_data: { metadata: { tenant_id: context.tenantId!, addon: 'chat' } },
    success_url: `${baseUrl}/settings/chat?addon=success`, cancel_url: `${baseUrl}/settings/chat?addon=cancelled`,
  })
  return { url: session.url }
}
export async function cancelOwnedChatAddon(context: AdminActorContext) {
  const metadata = await readOwnedChatAddonBilling(context, false)
  if (!metadata.customerId) throw new AdminMenuError(400, 'No active subscription')
  const subscriptions = await stripe.subscriptions.list({ customer: metadata.customerId, status: 'active', limit: 100 })
  const addons = subscriptions.data.filter(subscription => subscription.metadata?.addon === 'chat')
  if (!addons.length) throw new AdminMenuError(404, 'Addon subscription not found')
  // Preserve cancellation of every matching active addon, including historical
  // duplicates; paid-active remains unchanged until the lifecycle webhook.
  for (const addon of addons) await stripe.subscriptions.update(addon.id, { cancel_at_period_end: true })
  return { ok: true }
}
