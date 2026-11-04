// Static SELECT translations of canonical SQL bodies and declared output types. No RPC execution or grants.
export const ANALYTICS_SQL = {
  overview: { source: "20261009010100_visual_feed_and_analytics_dashboard.sql", functionName: "get_menu_analytics_overview", bodySha256: "8dc876588f41e1f554d997ab30de4808376a853e5c4d720f31f63d00fee36fea", table: true, sql: String.raw`
SELECT coalesce(jsonb_agg(to_jsonb(typed_row)),'[]'::jsonb) AS data FROM (SELECT aggregate_row.sessions::bigint AS sessions, aggregate_row.engaged_sessions::bigint AS engaged_sessions, aggregate_row.detail_sessions::bigint AS detail_sessions, aggregate_row.cart_sessions::bigint AS cart_sessions, aggregate_row.checkout_sessions::bigint AS checkout_sessions, aggregate_row.completed_orders::bigint AS completed_orders, aggregate_row.cancelled_orders::bigint AS cancelled_orders, aggregate_row.revenue::numeric AS revenue, aggregate_row.avg_order_value::numeric AS avg_order_value, aggregate_row.revenue_per_session::numeric AS revenue_per_session, aggregate_row.median_time_to_order_seconds::numeric AS median_time_to_order_seconds FROM (WITH scoped_sessions AS (
    SELECT id, started_at
    FROM public.menu_sessions
    WHERE tenant_id = $1::uuid
      AND is_test = FALSE
      AND started_at >= $2::timestamptz
      AND started_at < $3::timestamptz
      AND ($4::uuid IS NULL OR menu_id = $4::uuid)
      AND ($5::uuid IS NULL OR location_id = $5::uuid)
  ),
  scoped_events AS (
    SELECT e.*
    FROM public.menu_events e
    JOIN scoped_sessions s ON s.id = e.session_id
    WHERE e.tenant_id = $1::uuid
      AND e.occurred_at >= $2::timestamptz
      AND e.occurred_at < $3::timestamptz
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
  FROM session_totals CROSS JOIN event_totals CROSS JOIN time_to_order) AS aggregate_row(sessions,engaged_sessions,detail_sessions,cart_sessions,checkout_sessions,completed_orders,cancelled_orders,revenue,avg_order_value,revenue_per_session,median_time_to_order_seconds)) typed_row
` },
  products: { source: "20261009010100_visual_feed_and_analytics_dashboard.sql", functionName: "get_menu_product_analytics", bodySha256: "c6b9e835c6ad2d3967d0b79eba985d4228d256b93c9775762366743ad2b849f5", table: true, sql: String.raw`
SELECT coalesce(jsonb_agg(to_jsonb(typed_row)),'[]'::jsonb) AS data FROM (SELECT aggregate_row.product_id::uuid AS product_id, aggregate_row.product_name::text AS product_name, aggregate_row.impression_sessions::bigint AS impression_sessions, aggregate_row.engaged_sessions::bigint AS engaged_sessions, aggregate_row.detail_sessions::bigint AS detail_sessions, aggregate_row.add_sessions::bigint AS add_sessions, aggregate_row.remove_sessions::bigint AS remove_sessions, aggregate_row.attention_ms::bigint AS attention_ms, aggregate_row.purchased_sessions::bigint AS purchased_sessions, aggregate_row.purchased_quantity::bigint AS purchased_quantity, aggregate_row.revenue::numeric AS revenue FROM (WITH scoped_sessions AS (
    SELECT id
    FROM public.menu_sessions
    WHERE tenant_id = $1::uuid
      AND is_test = FALSE
      AND started_at >= $2::timestamptz
      AND started_at < $3::timestamptz
      AND ($4::uuid IS NULL OR menu_id = $4::uuid)
      AND ($5::uuid IS NULL OR location_id = $5::uuid)
  ),
  scoped_events AS (
    SELECT e.*
    FROM public.menu_events e
    JOIN scoped_sessions s ON s.id = e.session_id
    WHERE e.tenant_id = $1::uuid
      AND e.occurred_at >= $2::timestamptz
      AND e.occurred_at < $3::timestamptz
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
    JOIN public.order_items oi ON oi.order_id = co.order_id
    GROUP BY oi.product_id
  ),
  relevant_products AS (
    SELECT p.id, p.name
    FROM public.products p
    WHERE p.tenant_id = $1::uuid
      AND ($4::uuid IS NULL OR p.menu_id = $4::uuid)
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
  ORDER BY COALESCE(pm.revenue, 0) DESC, COALESCE(e.impression_sessions, 0) DESC) AS aggregate_row(product_id,product_name,impression_sessions,engaged_sessions,detail_sessions,add_sessions,remove_sessions,attention_ms,purchased_sessions,purchased_quantity,revenue)) typed_row
` },
  upsell: { source: "20261025140000_order_sequence_upsell.sql", functionName: "get_menu_upsell_analytics", bodySha256: "fe654eeb665f561bfc57cbbfdaa6c8f01741318bd56ec8c589cd23aada35f0d8", table: false, sql: String.raw`
SELECT (WITH scoped_sessions AS (
    SELECT id
    FROM public.menu_sessions
    WHERE tenant_id = $1::uuid
      AND is_test = FALSE
      AND started_at >= $2::timestamptz
      AND started_at < $3::timestamptz
      AND ($4::uuid IS NULL OR menu_id = $4::uuid)
      AND ($5::uuid IS NULL OR location_id = $5::uuid)
  ),
  scoped_events AS (
    SELECT e.event_name, e.product_id, COALESCE(e.quantity, 1) AS quantity
    FROM public.menu_events e
    JOIN scoped_sessions s ON s.id = e.session_id
    WHERE e.tenant_id = $1::uuid
      AND e.event_name IN ('upsell_shown', 'upsell_accepted', 'upsell_skipped')
      AND e.occurred_at >= $2::timestamptz
      AND e.occurred_at < $3::timestamptz
  ),
  accepted AS (
    SELECT se.product_id, p.name, SUM(se.quantity) AS items, SUM(se.quantity * COALESCE(p.price, 0)) AS value
    FROM scoped_events se
    LEFT JOIN public.products p ON p.id = se.product_id AND p.tenant_id = $1::uuid
    WHERE se.event_name = 'upsell_accepted'
    GROUP BY se.product_id, p.name
  )
  SELECT jsonb_build_object(
    'shown', (SELECT COUNT(*) FROM scoped_events WHERE event_name = 'upsell_shown'),
    'skipped', (SELECT COUNT(*) FROM scoped_events WHERE event_name = 'upsell_skipped'),
    'accepted_items', COALESCE((SELECT SUM(items) FROM accepted), 0),
    'accepted_value', COALESCE((SELECT SUM(value) FROM accepted), 0),
    'top', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('product_id', product_id, 'name', name, 'items', items, 'value', value) ORDER BY items DESC, value DESC)
      FROM (SELECT * FROM accepted ORDER BY items DESC, value DESC LIMIT 5) t
    ), '[]'::jsonb)
  )) AS data
` },
  attribution: { source: "20261026120000_order_item_attribution.sql", functionName: "get_order_attribution", bodySha256: "0f62e11c3062b9943fa6357c8f6201023352b8caa89ebdc9120fa9ca44dc7fcc", table: false, sql: String.raw`
SELECT (WITH scoped_orders AS (
    SELECT id
    FROM public.orders
    WHERE tenant_id = $1::uuid
      AND created_at >= $2::timestamptz
      AND created_at < $3::timestamptz
      AND status NOT IN ('cancelled', 'payment_failed', 'awaiting_payment')
      AND ($4::uuid IS NULL OR location_id = $4::uuid)
  ),
  lines AS (
    SELECT oi.order_id, oi.added_via, oi.quantity, oi.quantity * oi.unit_price AS value
    FROM public.order_items oi
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
  )) AS data
` },
  engagement: { source: "20261026130000_menu_engagement.sql", functionName: "get_menu_engagement", bodySha256: "31f3d2a24215b65c3813b686d44b9c0198ef3e2067526f20eb6eb7f250bc0719", table: false, sql: String.raw`
SELECT (WITH s AS (
    SELECT
      started_at,
      LEAST(GREATEST(EXTRACT(EPOCH FROM (last_seen_at - started_at)), 0), 10800) AS seconds,
      device_class, entry_source, COALESCE(NULLIF(language, ''), 'unknown') AS language,
      started_at AT TIME ZONE COALESCE(NULLIF($6::text, ''), 'UTC') AS local_start
    FROM public.menu_sessions
    WHERE tenant_id = $1::uuid
      AND is_test = FALSE
      AND started_at >= $2::timestamptz
      AND started_at < $3::timestamptz
      AND ($4::uuid IS NULL OR menu_id = $4::uuid)
      AND ($5::uuid IS NULL OR location_id = $5::uuid)
  ),
  buckets AS (
    SELECT bucket, ord, COUNT(s.seconds) AS sessions
    FROM (VALUES ('<30s', 1, 0, 30), ('30s–2m', 2, 30, 120), ('2–5m', 3, 120, 300), ('5–15m', 4, 300, 900), ('15m+', 5, 900, 1e9)) AS b(bucket, ord, lo, hi)
    LEFT JOIN s ON s.seconds >= b.lo AND s.seconds < b.hi
    GROUP BY bucket, ord
  )
  SELECT jsonb_build_object(
    'sessions', (SELECT COUNT(*) FROM s),
    'median_seconds', COALESCE((SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds) FROM s), 0),
    'avg_seconds', COALESCE((SELECT AVG(seconds) FROM s), 0),
    'duration', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', bucket, 'sessions', sessions) ORDER BY ord) FROM buckets), '[]'::jsonb),
    'by_hour', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', h, 'sessions', COALESCE(c.n, 0)) ORDER BY h)
      FROM generate_series(0, 23) AS h
      LEFT JOIN (SELECT EXTRACT(HOUR FROM local_start)::int AS hr, COUNT(*) AS n FROM s GROUP BY 1) c ON c.hr = h
    ), '[]'::jsonb),
    'by_weekday', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', d, 'sessions', COALESCE(c.n, 0)) ORDER BY d)
      FROM generate_series(0, 6) AS d
      LEFT JOIN (SELECT EXTRACT(DOW FROM local_start)::int AS dw, COUNT(*) AS n FROM s GROUP BY 1) c ON c.dw = d
    ), '[]'::jsonb),
    'devices', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', device_class, 'sessions', n) ORDER BY n DESC) FROM (SELECT device_class, COUNT(*) AS n FROM s GROUP BY 1) x), '[]'::jsonb),
    'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', entry_source, 'sessions', n) ORDER BY n DESC) FROM (SELECT entry_source, COUNT(*) AS n FROM s GROUP BY 1) x), '[]'::jsonb),
    'languages', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', language, 'sessions', n) ORDER BY n DESC) FROM (SELECT language, COUNT(*) AS n FROM s GROUP BY 1 ORDER BY 2 DESC LIMIT 6) x), '[]'::jsonb)
  )) AS data
` },
} as const
