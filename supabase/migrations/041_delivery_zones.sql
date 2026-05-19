-- SEED-020: Robust Delivery Zone System
-- delivery_zones: per-tenant zone definitions with zipcode prefix matching
-- orders: structured delivery address fields + zone reference + out_for_delivery status

CREATE TABLE IF NOT EXISTS delivery_zones (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  fee_cents        INT         NOT NULL DEFAULT 0,
  zipcode_prefixes TEXT[]      NOT NULL DEFAULT '{}',
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_zones_tenant ON delivery_zones(tenant_id);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_street     TEXT,
  ADD COLUMN IF NOT EXISTS delivery_complement TEXT,
  ADD COLUMN IF NOT EXISTS delivery_zipcode    TEXT,
  ADD COLUMN IF NOT EXISTS delivery_city       TEXT,
  ADD COLUMN IF NOT EXISTS delivery_notes      TEXT,
  ADD COLUMN IF NOT EXISTS delivery_zone_id    UUID REFERENCES delivery_zones(id) ON DELETE SET NULL;

-- Add out_for_delivery to status (drop and recreate check constraint if it exists)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'paid', 'payment_failed', 'preparing', 'ready', 'out_for_delivery', 'done', 'cancelled'));
