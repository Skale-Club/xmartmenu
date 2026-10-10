-- Visual menu analytics foundation.
--
-- Raw behavioral data stays anonymous and tenant-scoped. Public clients never
-- write these tables directly; the validated /api/public/analytics endpoint
-- uses the service role. Tenant members receive read-only access through RLS.

CREATE TABLE IF NOT EXISTS menu_sessions (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  menu_id       UUID NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  location_id   UUID REFERENCES locations(id) ON DELETE SET NULL,
  qr_code_id    UUID REFERENCES qr_codes(id) ON DELETE SET NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  entry_source  TEXT NOT NULL DEFAULT 'unknown'
    CHECK (entry_source IN ('qr', 'direct', 'custom_domain', 'unknown')),
  device_class  TEXT NOT NULL DEFAULT 'unknown'
    CHECK (device_class IN ('mobile', 'tablet', 'desktop', 'unknown')),
  language      TEXT,
  is_test       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT menu_sessions_time_order
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE TABLE IF NOT EXISTS menu_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_event_id  UUID NOT NULL UNIQUE,
  server_event_key TEXT UNIQUE,
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id       UUID NOT NULL REFERENCES menu_sessions(id) ON DELETE CASCADE,
  menu_id          UUID NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  location_id      UUID REFERENCES locations(id) ON DELETE SET NULL,
  product_id       UUID REFERENCES products(id) ON DELETE SET NULL,
  category_id      UUID REFERENCES categories(id) ON DELETE SET NULL,
  order_id         UUID REFERENCES orders(id) ON DELETE SET NULL,
  event_name       TEXT NOT NULL CHECK (event_name IN (
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
    'order_created',
    'order_completed',
    'order_cancelled'
  )),
  occurred_at      TIMESTAMPTZ NOT NULL,
  duration_ms      INTEGER CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 3600000),
  quantity         INTEGER CHECK (quantity IS NULL OR quantity BETWEEN 1 AND 99),
  source           TEXT CHECK (source IS NULL OR source IN (
    'grid', 'featured', 'detail', 'cart', 'checkout', 'feed', 'search', 'unknown'
  )),
  media_type       TEXT CHECK (media_type IS NULL OR media_type IN ('image', 'video')),
  media_index      INTEGER CHECK (media_index IS NULL OR media_index BETWEEN 0 AND 20),
  query_length     INTEGER CHECK (query_length IS NULL OR query_length BETWEEN 0 AND 200),
  amount           NUMERIC(12,2) CHECK (amount IS NULL OR amount >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS analytics_session_id UUID
    REFERENCES menu_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_menu_sessions_tenant_started
  ON menu_sessions (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_menu_sessions_menu_started
  ON menu_sessions (menu_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_menu_sessions_location_started
  ON menu_sessions (location_id, started_at DESC)
  WHERE location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_menu_events_tenant_occurred
  ON menu_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_menu_events_session_occurred
  ON menu_events (session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_menu_events_product_occurred
  ON menu_events (product_id, occurred_at DESC)
  WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_menu_events_menu_name_occurred
  ON menu_events (menu_id, event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_analytics_session
  ON orders (analytics_session_id)
  WHERE analytics_session_id IS NOT NULL;

ALTER TABLE menu_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "menu_sessions_tenant_read"
  ON menu_sessions FOR SELECT
  USING (tenant_id = auth_tenant_id() OR is_superadmin());

CREATE POLICY "menu_events_tenant_read"
  ON menu_events FOR SELECT
  USING (tenant_id = auth_tenant_id() OR is_superadmin());

COMMENT ON TABLE menu_sessions IS
  'Anonymous first-party public-menu sessions; no customer PII.';
COMMENT ON TABLE menu_events IS
  'Schema-controlled menu engagement and ordering funnel events.';
COMMENT ON COLUMN menu_events.server_event_key IS
  'Stable idempotency key for trusted server events; null for browser events.';
COMMENT ON COLUMN orders.analytics_session_id IS
  'Optional anonymous menu session used for server-trusted order attribution.';
