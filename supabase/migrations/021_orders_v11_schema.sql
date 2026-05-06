-- ============================================================
-- Migration 021: Orders v1.1 schema
-- Adds product_option_groups, product_options tables (ORD-01, ORD-02)
-- Alters orders (status constraint + notes column) (ORD-03)
-- Alters order_items (selected_options column) (ORD-04)
-- Safe to run multiple times (uses IF NOT EXISTS everywhere)
-- NOTE: orders_public_insert RLS policy was already updated in 020
-- ============================================================

-- ============================================================
-- 1. ALTER orders: migrate existing status rows, update constraint, add notes
-- ============================================================

-- Step 1a: Migrate any legacy status values before changing the constraint
-- (rows with 'confirmed' or 'completed' would fail the new CHECK)
UPDATE orders SET status = 'preparing' WHERE status = 'confirmed';
UPDATE orders SET status = 'done'      WHERE status = 'completed';

-- Step 1b: Replace the status CHECK constraint
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'preparing', 'ready', 'done', 'cancelled'));

-- Step 1c: Add notes column
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- ============================================================
-- 2. ALTER order_items: add selected_options JSONB
-- ============================================================

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS selected_options JSONB;

-- ============================================================
-- 3. CREATE product_option_groups
-- ============================================================

CREATE TABLE IF NOT EXISTS product_option_groups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT 'single'
                   CHECK (type IN ('single', 'multiple', 'half_and_half')),
  required       BOOLEAN NOT NULL DEFAULT false,
  min_selections INTEGER NOT NULL DEFAULT 0,
  max_selections INTEGER,
  price_rule     TEXT NOT NULL DEFAULT 'sum'
                   CHECK (price_rule IN ('max', 'average', 'sum', 'fixed')),
  position       INTEGER NOT NULL DEFAULT 0,
  translations   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE product_option_groups ENABLE ROW LEVEL SECURITY;

-- Admin: manage own groups; superadmin: manage all
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'product_option_groups' AND policyname = 'option_groups_admin'
  ) THEN
    CREATE POLICY "option_groups_admin" ON product_option_groups FOR ALL
      USING (tenant_id = auth_tenant_id() OR is_superadmin());
  END IF;
END $$;

-- Public: read option groups (needed to display options on public menu)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'product_option_groups' AND policyname = 'option_groups_public_read'
  ) THEN
    CREATE POLICY "option_groups_public_read" ON product_option_groups FOR SELECT
      USING (true);
  END IF;
END $$;

-- updated_at trigger for product_option_groups
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'product_option_groups_updated_at'
  ) THEN
    CREATE TRIGGER product_option_groups_updated_at
      BEFORE UPDATE ON product_option_groups
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_option_groups_product ON product_option_groups(product_id);
CREATE INDEX IF NOT EXISTS idx_option_groups_tenant  ON product_option_groups(tenant_id);

-- ============================================================
-- 4. CREATE product_options
-- ============================================================

CREATE TABLE IF NOT EXISTS product_options (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID NOT NULL REFERENCES product_option_groups(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  base_price     NUMERIC(10,2),
  price_modifier NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_available   BOOLEAN NOT NULL DEFAULT true,
  position       INTEGER NOT NULL DEFAULT 0,
  translations   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE product_options ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'product_options' AND policyname = 'options_admin'
  ) THEN
    CREATE POLICY "options_admin" ON product_options FOR ALL
      USING (tenant_id = auth_tenant_id() OR is_superadmin());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'product_options' AND policyname = 'options_public_read'
  ) THEN
    CREATE POLICY "options_public_read" ON product_options FOR SELECT
      USING (true);
  END IF;
END $$;

-- updated_at trigger for product_options
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'product_options_updated_at'
  ) THEN
    CREATE TRIGGER product_options_updated_at
      BEFORE UPDATE ON product_options
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_options_group  ON product_options(group_id);
CREATE INDEX IF NOT EXISTS idx_options_tenant ON product_options(tenant_id);

-- ============================================================
-- Done. Reload schema cache: Supabase Dashboard -> API -> Reload schema
-- ============================================================
