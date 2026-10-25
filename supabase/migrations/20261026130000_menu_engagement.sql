-- Screen time and audience for the restaurant dashboard, and a cross-client
-- view for the superadmin.
--
-- Screen time = last activity − start of a menu session (menu_sessions
-- last_seen_at is bumped on every analytics batch the menu sends while open),
-- capped at 3 hours so a tab left open does not skew it.

CREATE OR REPLACE FUNCTION public.get_menu_engagement(
  p_tenant_id UUID,
  p_started_at TIMESTAMPTZ,
  p_ended_at TIMESTAMPTZ,
  p_menu_id UUID DEFAULT NULL,
  p_location_id UUID DEFAULT NULL,
  p_time_zone TEXT DEFAULT 'UTC'
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (
    SELECT
      started_at,
      LEAST(GREATEST(EXTRACT(EPOCH FROM (last_seen_at - started_at)), 0), 10800) AS seconds,
      device_class, entry_source, COALESCE(NULLIF(language, ''), 'unknown') AS language,
      started_at AT TIME ZONE COALESCE(NULLIF(p_time_zone, ''), 'UTC') AS local_start
    FROM menu_sessions
    WHERE tenant_id = p_tenant_id
      AND is_test = FALSE
      AND started_at >= p_started_at
      AND started_at < p_ended_at
      AND (p_menu_id IS NULL OR menu_id = p_menu_id)
      AND (p_location_id IS NULL OR location_id = p_location_id)
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
  );
$$;

REVOKE ALL ON FUNCTION public.get_menu_engagement(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_menu_engagement(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID, TEXT) TO service_role;

-- One row per restaurant: visits, screen time, orders and revenue (in the
-- restaurant's own currency), for Superadmin › Dashboard.
CREATE OR REPLACE FUNCTION public.get_platform_menu_overview(
  p_started_at TIMESTAMPTZ,
  p_ended_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH sess AS (
    SELECT tenant_id,
           COUNT(*) AS sessions,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY LEAST(GREATEST(EXTRACT(EPOCH FROM (last_seen_at - started_at)), 0), 10800)) AS median_seconds
    FROM menu_sessions
    WHERE is_test = FALSE AND started_at >= p_started_at AND started_at < p_ended_at
    GROUP BY tenant_id
  ),
  ord AS (
    SELECT tenant_id, COUNT(*) AS orders, SUM(total) AS revenue
    FROM orders
    WHERE created_at >= p_started_at AND created_at < p_ended_at
      AND status NOT IN ('cancelled', 'payment_failed', 'awaiting_payment')
    GROUP BY tenant_id
  ),
  calls AS (
    SELECT tenant_id, COUNT(*) AS waiter_calls
    FROM waiter_calls
    WHERE created_at >= p_started_at AND created_at < p_ended_at
    GROUP BY tenant_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'tenant_id', t.id,
    'name', t.name,
    'slug', t.slug,
    'plan', t.plan,
    'currency', COALESCE(ts.currency, 'USD'),
    'sessions', COALESCE(sess.sessions, 0),
    'median_seconds', COALESCE(sess.median_seconds, 0),
    'orders', COALESCE(ord.orders, 0),
    'revenue', COALESCE(ord.revenue, 0),
    'waiter_calls', COALESCE(calls.waiter_calls, 0)
  ) ORDER BY COALESCE(sess.sessions, 0) DESC, t.name), '[]'::jsonb)
  FROM tenants t
  LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
  LEFT JOIN sess ON sess.tenant_id = t.id
  LEFT JOIN ord ON ord.tenant_id = t.id
  LEFT JOIN calls ON calls.tenant_id = t.id
  WHERE t.is_active;
$$;

REVOKE ALL ON FUNCTION public.get_platform_menu_overview(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_menu_overview(TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
