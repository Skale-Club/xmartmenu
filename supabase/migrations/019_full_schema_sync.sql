-- ============================================================
-- Migration 019: Full schema sync
-- Safe to run multiple times (uses IF NOT EXISTS everywhere)
-- Run this in Supabase SQL Editor to bring DB fully up to date
-- ============================================================

-- ============================================================
-- 1. TENANT_SETTINGS — add all missing columns
-- ============================================================
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS custom_tags          TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS currency             TEXT NOT NULL DEFAULT 'BRL',
  ADD COLUMN IF NOT EXISTS language             TEXT NOT NULL DEFAULT 'pt',
  ADD COLUMN IF NOT EXISTS whatsapp_orders_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS orders_enabled       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS direct_orders_enabled BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- 2. PROFILES — add missing columns and fix role constraint
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone                TEXT,
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_changed_at  TIMESTAMPTZ;

-- Drop old role constraint and replace with the full set of roles
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('superadmin', 'store-admin', 'store-staff', 'admin'));

-- ============================================================
-- 3. PRODUCTS — add image_urls array
-- ============================================================
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_urls TEXT[] DEFAULT '{}';

-- ============================================================
-- 4. MENUS table (and foreign keys on categories/products)
-- ============================================================
CREATE TABLE IF NOT EXISTS menus (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  description TEXT,
  language    TEXT NOT NULL DEFAULT 'pt',
  supported_languages TEXT[] NOT NULL DEFAULT ARRAY['pt'],
  translations        JSONB  NOT NULL DEFAULT '{}'::jsonb,
  purpose     TEXT NOT NULL DEFAULT 'restaurant',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, slug)
);

ALTER TABLE menus ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'menus' AND policyname = 'Public read active menus'
  ) THEN
    CREATE POLICY "Public read active menus" ON menus
      FOR SELECT USING (is_active = true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'menus' AND policyname = 'Tenant members manage menus'
  ) THEN
    CREATE POLICY "Tenant members manage menus" ON menus
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE id = auth.uid()
            AND tenant_id = menus.tenant_id
            AND role IN ('store-admin', 'store-staff', 'superadmin', 'admin')
        )
      );
  END IF;
END $$;

-- menus i18n columns (safe if already exist)
ALTER TABLE menus ADD COLUMN IF NOT EXISTS supported_languages TEXT[] NOT NULL DEFAULT ARRAY['pt'];
ALTER TABLE menus ADD COLUMN IF NOT EXISTS translations        JSONB  NOT NULL DEFAULT '{}'::jsonb;

-- menu_id on categories and products
ALTER TABLE categories ADD COLUMN IF NOT EXISTS menu_id UUID REFERENCES menus(id) ON DELETE CASCADE;
ALTER TABLE products   ADD COLUMN IF NOT EXISTS menu_id UUID REFERENCES menus(id) ON DELETE CASCADE;

-- Create a default menu for any tenant that doesn't have one yet
INSERT INTO menus (tenant_id, name, slug, language, supported_languages, purpose, is_active, is_default, position)
SELECT t.id, 'Main Menu', 'main', 'pt', ARRAY['pt'], 'restaurant', true, true, 0
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM menus m WHERE m.tenant_id = t.id);

-- Assign orphan categories/products to their tenant default menu
UPDATE categories c
SET menu_id = m.id
FROM menus m
WHERE m.tenant_id = c.tenant_id AND m.is_default = true AND c.menu_id IS NULL;

UPDATE products p
SET menu_id = m.id
FROM menus m
WHERE m.tenant_id = p.tenant_id AND m.is_default = true AND p.menu_id IS NULL;

-- ============================================================
-- 5. PLATFORM_SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_settings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_name              TEXT DEFAULT 'Skale QR Menu',
  brand_name            TEXT DEFAULT 'Skale Club',
  default_primary_color TEXT DEFAULT '#000000',
  default_accent_color  TEXT DEFAULT '#FF5722',
  menu_footer_brand     TEXT DEFAULT 'Skale QR Menu',
  landing               JSONB DEFAULT '{}',
  updated_at            TIMESTAMPTZ DEFAULT now()
);

INSERT INTO platform_settings (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM platform_settings);

-- ============================================================
-- 6. ORDERS + ORDER_ITEMS tables
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_name  TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
  total          NUMERIC(10,2) NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL,
  product_name TEXT NOT NULL,
  quantity     INTEGER NOT NULL,
  unit_price   NUMERIC(10,2) NOT NULL,
  notes        TEXT
);

ALTER TABLE orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_orders_tenant     ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'orders' AND policyname = 'orders_tenant_admin'
  ) THEN
    CREATE POLICY "orders_tenant_admin" ON orders FOR ALL
      USING (tenant_id = auth_tenant_id() OR is_superadmin());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'orders' AND policyname = 'orders_public_insert'
  ) THEN
    CREATE POLICY "orders_public_insert" ON orders FOR INSERT
      WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'order_items' AND policyname = 'order_items_admin'
  ) THEN
    CREATE POLICY "order_items_admin" ON order_items FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM orders o
          WHERE o.id = order_items.order_id
            AND (o.tenant_id = auth_tenant_id() OR is_superadmin())
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'order_items' AND policyname = 'order_items_public_insert'
  ) THEN
    CREATE POLICY "order_items_public_insert" ON order_items FOR INSERT
      WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 7. updated_at trigger for tenant_settings
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'tenant_settings_updated_at'
  ) THEN
    CREATE TRIGGER tenant_settings_updated_at
      BEFORE UPDATE ON tenant_settings
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'orders_updated_at'
  ) THEN
    CREATE TRIGGER orders_updated_at
      BEFORE UPDATE ON orders
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
-- Done. Reload schema cache: Supabase Dashboard → API → Reload schema
-- ============================================================
