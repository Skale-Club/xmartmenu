-- SEED-023: Table Management + Waiter Order Entry
-- Creates the tables catalog and adds table_name to orders.
-- Also adds table_management_enabled flag to tenant_settings.

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  position     INT         NOT NULL DEFAULT 0,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS restaurant_tables_tenant_id_idx ON restaurant_tables (tenant_id);

ALTER TABLE restaurant_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_tables_tenant_all"
  ON restaurant_tables FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Add table_name (free text) to orders — no FK, staff types it or selects from table list
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS table_name TEXT NULL;

-- Add table_management_enabled to tenant_settings (default false)
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS table_management_enabled BOOLEAN NOT NULL DEFAULT false;
