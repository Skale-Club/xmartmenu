-- "Complete your order": after a guest adds a dish, the menu offers what
-- usually comes next — a side, a drink, a dessert — one step at a time.
--
-- categories.course     what a category is in a meal. Steps are built from it:
--                       adding a 'main' offers sides, drinks and desserts
--                       the guest does not have yet. NULL = not part of it.
-- products.upsell_product_ids
--                       dishes the restaurant hand-picks to suggest with this
--                       one ("goes well with"), shown first, in this order.
-- tenant_settings.upsell_enabled
--                       restaurant switch (Settings › Menu display). Nothing
--                       shows until categories have a course or dishes have
--                       picks, so the default does not change any menu.
--
-- Tracking: upsell_shown / upsell_skipped (product_id = the dish that started
-- the sequence) and upsell_accepted (product_id = the suggestion taken), plus
-- add_to_cart with source 'upsell'. get_menu_upsell_analytics feeds the
-- restaurant dashboard.

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS course TEXT
    CHECK (course IS NULL OR course IN ('main', 'side', 'drink', 'dessert'));

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS upsell_product_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS upsell_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.menu_events DROP CONSTRAINT IF EXISTS menu_events_event_name_check;
ALTER TABLE public.menu_events ADD CONSTRAINT menu_events_event_name_check CHECK (event_name IN (
  'menu_session_started',
  'product_impression',
  'product_engagement',
  'product_detail_opened',
  'media_started',
  'media_completed',
  'media_swiped',
  'category_selected',
  'search_performed',
  'product_customization_started',
  'add_to_cart',
  'remove_from_cart',
  'checkout_started',
  'upsell_shown',
  'upsell_accepted',
  'upsell_skipped',
  'order_created',
  'order_completed',
  'order_cancelled'
));

ALTER TABLE public.menu_events DROP CONSTRAINT IF EXISTS menu_events_source_check;
ALTER TABLE public.menu_events ADD CONSTRAINT menu_events_source_check CHECK (source IS NULL OR source IN (
  'grid', 'featured', 'detail', 'cart', 'checkout', 'feed', 'search', 'upsell', 'unknown'
));

-- Sequences shown and skipped, suggestions taken and their estimated value
-- (current dish price × quantity), and the suggestions guests take most.
CREATE OR REPLACE FUNCTION get_menu_upsell_analytics(
  p_tenant_id UUID,
  p_started_at TIMESTAMPTZ,
  p_ended_at TIMESTAMPTZ,
  p_menu_id UUID DEFAULT NULL,
  p_location_id UUID DEFAULT NULL
)
RETURNS JSONB
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
    SELECT e.event_name, e.product_id, COALESCE(e.quantity, 1) AS quantity
    FROM menu_events e
    JOIN scoped_sessions s ON s.id = e.session_id
    WHERE e.tenant_id = p_tenant_id
      AND e.event_name IN ('upsell_shown', 'upsell_accepted', 'upsell_skipped')
      AND e.occurred_at >= p_started_at
      AND e.occurred_at < p_ended_at
  ),
  accepted AS (
    SELECT se.product_id, p.name, SUM(se.quantity) AS items, SUM(se.quantity * COALESCE(p.price, 0)) AS value
    FROM scoped_events se
    LEFT JOIN products p ON p.id = se.product_id AND p.tenant_id = p_tenant_id
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
  );
$$;

REVOKE ALL ON FUNCTION get_menu_upsell_analytics(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_menu_upsell_analytics(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID) TO service_role;
