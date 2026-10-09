-- Visual feed rollout controls and tenant-safe dashboard aggregates.

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS analytics_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS visual_feed_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS menu_default_view TEXT NOT NULL DEFAULT 'list',
  ADD COLUMN IF NOT EXISTS feed_autoplay_videos BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_settings_menu_default_view_check'
  ) THEN
    ALTER TABLE tenant_settings
      ADD CONSTRAINT tenant_settings_menu_default_view_check
      CHECK (menu_default_view IN ('list', 'feed'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION get_menu_analytics_overview(
  p_tenant_id UUID,
  p_started_at TIMESTAMPTZ,
  p_ended_at TIMESTAMPTZ,
  p_menu_id UUID DEFAULT NULL,
  p_location_id UUID DEFAULT NULL
)
RETURNS TABLE (
  sessions BIGINT,
  engaged_sessions BIGINT,
  detail_sessions BIGINT,
  cart_sessions BIGINT,
  checkout_sessions BIGINT,
  completed_orders BIGINT,
  cancelled_orders BIGINT,
  revenue NUMERIC,
  avg_order_value NUMERIC,
  revenue_per_session NUMERIC,
  median_time_to_order_seconds NUMERIC
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped_sessions AS (
    SELECT id, started_at
    FROM menu_sessions
    WHERE tenant_id = p_tenant_id
      AND is_test = FALSE
      AND started_at >= p_started_at
      AND started_at < p_ended_at
      AND (p_menu_id IS NULL OR menu_id = p_menu_id)
      AND (p_location_id IS NULL OR location_id = p_location_id)
  ),
  scoped_events AS (
    SELECT e.*
    FROM menu_events e
    JOIN scoped_sessions s ON s.id = e.session_id
    WHERE e.tenant_id = p_tenant_id
      AND e.occurred_at >= p_started_at
      AND e.occurred_at < p_ended_at
  ),
  event_totals AS (
    SELECT
      COUNT(DISTINCT session_id) FILTER (WHERE event_name IN (
        'product_engagement', 'product_detail_opened', 'media_started',
        'media_completed', 'media_swiped', 'product_customization_started',
        'add_to_cart', 'checkout_started', 'order_created', 'order_completed'
      )) AS engaged_sessions,
      COUNT(DISTINCT session_id) FILTER (WHERE event_name IN (
        'product_detail_opened', 'product_customization_started'
      )) AS detail_sessions,
      COUNT(DISTINCT session_id) FILTER (WHERE event_name = 'add_to_cart') AS cart_sessions,
      COUNT(DISTINCT session_id) FILTER (WHERE event_name = 'checkout_started') AS checkout_sessions,
      COUNT(DISTINCT order_id) FILTER (WHERE event_name = 'order_completed') AS completed_orders,
      COUNT(DISTINCT order_id) FILTER (WHERE event_name = 'order_cancelled') AS cancelled_orders,
      COALESCE(SUM(amount) FILTER (WHERE event_name = 'order_completed'), 0) AS revenue
    FROM scoped_events
  ),
  time_to_order AS (
    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (completed.occurred_at - sessions.started_at))
    ) AS seconds
    FROM (
      SELECT session_id, MIN(occurred_at) AS occurred_at
      FROM scoped_events
      WHERE event_name = 'order_completed'
      GROUP BY session_id
    ) completed
    JOIN scoped_sessions sessions ON sessions.id = completed.session_id
  ),
  session_totals AS (
    SELECT COUNT(*)::BIGINT AS sessions FROM scoped_sessions
  )
  SELECT
    session_totals.sessions,
    event_totals.engaged_sessions,
    event_totals.detail_sessions,
    event_totals.cart_sessions,
    event_totals.checkout_sessions,
    event_totals.completed_orders,
    event_totals.cancelled_orders,
    event_totals.revenue,
    CASE WHEN event_totals.completed_orders > 0
      THEN event_totals.revenue / event_totals.completed_orders ELSE 0 END,
    CASE WHEN session_totals.sessions > 0
      THEN event_totals.revenue / session_totals.sessions ELSE 0 END,
    COALESCE(time_to_order.seconds, 0)
  FROM session_totals CROSS JOIN event_totals CROSS JOIN time_to_order;
$$;

CREATE OR REPLACE FUNCTION get_menu_product_analytics(
  p_tenant_id UUID,
  p_started_at TIMESTAMPTZ,
  p_ended_at TIMESTAMPTZ,
  p_menu_id UUID DEFAULT NULL,
  p_location_id UUID DEFAULT NULL
)
RETURNS TABLE (
  product_id UUID,
  product_name TEXT,
  impression_sessions BIGINT,
  engaged_sessions BIGINT,
  detail_sessions BIGINT,
  add_sessions BIGINT,
  remove_sessions BIGINT,
  attention_ms BIGINT,
  purchased_sessions BIGINT,
  purchased_quantity BIGINT,
  revenue NUMERIC
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped_sessions AS (
    SELECT id
    FROM menu_sessions
    WHERE tenant_id = p_tenant_id
      AND is_test = FALSE
      AND started_at >= p_started_at
      AND started_at < p_ended_at
      AND (p_menu_id IS NULL OR menu_id = p_menu_id)
      AND (p_location_id IS NULL OR location_id = p_location_id)
  ),
  scoped_events AS (
    SELECT e.*
    FROM menu_events e
    JOIN scoped_sessions s ON s.id = e.session_id
    WHERE e.tenant_id = p_tenant_id
      AND e.occurred_at >= p_started_at
      AND e.occurred_at < p_ended_at
  ),
  event_metrics AS (
    SELECT
      product_id,
      COUNT(DISTINCT session_id) FILTER (WHERE event_name = 'product_impression') AS impression_sessions,
      COUNT(DISTINCT session_id) FILTER (WHERE event_name IN (
        'product_engagement', 'product_detail_opened', 'media_started',
        'media_completed', 'media_swiped', 'product_customization_started',
        'add_to_cart'
      )) AS engaged_sessions,
      COUNT(DISTINCT session_id) FILTER (WHERE event_name IN (
        'product_detail_opened', 'product_customization_started'
      )) AS detail_sessions,
      COUNT(DISTINCT session_id) FILTER (WHERE event_name = 'add_to_cart') AS add_sessions,
      COUNT(DISTINCT session_id) FILTER (WHERE event_name = 'remove_from_cart') AS remove_sessions,
      COALESCE(SUM(duration_ms) FILTER (WHERE event_name = 'product_engagement'), 0)::BIGINT AS attention_ms
    FROM scoped_events
    WHERE product_id IS NOT NULL
    GROUP BY product_id
  ),
  completed_orders AS (
    SELECT DISTINCT order_id, session_id
    FROM scoped_events
    WHERE event_name = 'order_completed' AND order_id IS NOT NULL
  ),
  purchase_metrics AS (
    SELECT
      oi.product_id,
      COUNT(DISTINCT co.session_id)::BIGINT AS purchased_sessions,
      COALESCE(SUM(oi.quantity), 0)::BIGINT AS purchased_quantity,
      COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue
    FROM completed_orders co
    JOIN order_items oi ON oi.order_id = co.order_id
    GROUP BY oi.product_id
  ),
  relevant_products AS (
    SELECT p.id, p.name
    FROM products p
    WHERE p.tenant_id = p_tenant_id
      AND (p_menu_id IS NULL OR p.menu_id = p_menu_id)
  )
  SELECT
    p.id,
    p.name,
    COALESCE(e.impression_sessions, 0),
    COALESCE(e.engaged_sessions, 0),
    COALESCE(e.detail_sessions, 0),
    COALESCE(e.add_sessions, 0),
    COALESCE(e.remove_sessions, 0),
    COALESCE(e.attention_ms, 0),
    COALESCE(pm.purchased_sessions, 0),
    COALESCE(pm.purchased_quantity, 0),
    COALESCE(pm.revenue, 0)
  FROM relevant_products p
  LEFT JOIN event_metrics e ON e.product_id = p.id
  LEFT JOIN purchase_metrics pm ON pm.product_id = p.id
  WHERE e.product_id IS NOT NULL OR pm.product_id IS NOT NULL
  ORDER BY COALESCE(pm.revenue, 0) DESC, COALESCE(e.impression_sessions, 0) DESC;
$$;

REVOKE ALL ON FUNCTION get_menu_analytics_overview(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_menu_product_analytics(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_menu_analytics_overview(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION get_menu_product_analytics(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID) TO service_role;

COMMENT ON FUNCTION get_menu_analytics_overview IS
  'Service-role-only tenant analytics aggregate. Caller must authorize tenant access.';
COMMENT ON FUNCTION get_menu_product_analytics IS
  'Service-role-only product performance aggregate. Caller must authorize tenant access.';
