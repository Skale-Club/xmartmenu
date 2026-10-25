-- What sold because of "Complete your order" and the AI chat.
--
-- order_items.added_via marks a line the guest added from the upsell sequence
-- ('upsell') or that the AI assistant put in the cart ('chat'). The menu sends
-- it with the order; it only feeds analytics, never prices.
--
-- get_order_attribution: real revenue (orders that went through, i.e. not
-- cancelled, unpaid or failed), not the estimate from cart events.

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS added_via TEXT CHECK (added_via IS NULL OR added_via IN ('upsell', 'chat'));

CREATE INDEX IF NOT EXISTS order_items_added_via_idx ON public.order_items (order_id) WHERE added_via IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_order_attribution(
  p_tenant_id UUID,
  p_started_at TIMESTAMPTZ,
  p_ended_at TIMESTAMPTZ,
  p_location_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped_orders AS (
    SELECT id
    FROM orders
    WHERE tenant_id = p_tenant_id
      AND created_at >= p_started_at
      AND created_at < p_ended_at
      AND status NOT IN ('cancelled', 'payment_failed', 'awaiting_payment')
      AND (p_location_id IS NULL OR location_id = p_location_id)
  ),
  lines AS (
    SELECT oi.order_id, oi.added_via, oi.quantity, oi.quantity * oi.unit_price AS value
    FROM order_items oi
    JOIN scoped_orders o ON o.id = oi.order_id
  ),
  by_source AS (
    SELECT added_via,
           COUNT(DISTINCT order_id) AS orders,
           SUM(quantity) AS items,
           SUM(value) AS revenue
    FROM lines
    WHERE added_via IS NOT NULL
    GROUP BY added_via
  )
  SELECT jsonb_build_object(
    'orders', (SELECT COUNT(*) FROM scoped_orders),
    'items_revenue', COALESCE((SELECT SUM(value) FROM lines), 0),
    'upsell', COALESCE((SELECT jsonb_build_object('orders', orders, 'items', items, 'revenue', revenue) FROM by_source WHERE added_via = 'upsell'), jsonb_build_object('orders', 0, 'items', 0, 'revenue', 0)),
    'chat', COALESCE((SELECT jsonb_build_object('orders', orders, 'items', items, 'revenue', revenue) FROM by_source WHERE added_via = 'chat'), jsonb_build_object('orders', 0, 'items', 0, 'revenue', 0))
  );
$$;

REVOKE ALL ON FUNCTION public.get_order_attribution(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_attribution(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO service_role;
