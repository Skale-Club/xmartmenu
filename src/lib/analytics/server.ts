import { createServiceClient } from '@/lib/supabase/server'

export type TrustedOrderAnalyticsEvent =
  | 'order_created'
  | 'order_completed'
  | 'order_cancelled'

/**
 * Record a trusted order lifecycle event without allowing analytics failures to
 * affect the order/payment path. A stable server_event_key makes webhook and
 * status-update retries idempotent.
 */
export async function recordTrustedOrderAnalyticsEvent(
  orderId: string,
  eventName: TrustedOrderAnalyticsEvent,
): Promise<void> {
  try {
    const service = createServiceClient()
    const { data: order, error: orderError } = await service
      .from('orders')
      .select('id, tenant_id, total, analytics_session_id')
      .eq('id', orderId)
      .maybeSingle()

    if (orderError) {
      console.error('analytics.order_lookup_error', orderError)
      return
    }
    if (!order?.analytics_session_id) return

    const { data: session, error: sessionError } = await service
      .from('menu_sessions')
      .select('id, tenant_id, menu_id, location_id')
      .eq('id', order.analytics_session_id)
      .eq('tenant_id', order.tenant_id)
      .maybeSingle()

    if (sessionError) {
      console.error('analytics.order_session_lookup_error', sessionError)
      return
    }
    if (!session) return

    const { error: eventError } = await service
      .from('menu_events')
      .upsert({
        client_event_id: crypto.randomUUID(),
        server_event_key: `order:${order.id}:${eventName}`,
        tenant_id: order.tenant_id,
        session_id: session.id,
        menu_id: session.menu_id,
        location_id: session.location_id,
        order_id: order.id,
        event_name: eventName,
        occurred_at: new Date().toISOString(),
        amount: eventName === 'order_cancelled' ? null : Number(order.total),
        source: 'checkout',
      }, { onConflict: 'server_event_key', ignoreDuplicates: true })

    if (eventError) {
      console.error('analytics.order_event_error', eventError)
    }
  } catch (error) {
    console.error('analytics.order_event_unexpected_error', error)
  }
}
