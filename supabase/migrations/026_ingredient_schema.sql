-- ============================================================
-- Migration 026: Ingredient Schema (v1.7 Customization)
-- Creates ingredients catalog, product_ingredients join table,
-- adds ingredient_customization_enabled to tenant_settings,
-- adds ingredient_modifications JSONB to order_items.
-- Safe to run multiple times (IF NOT EXISTS everywhere)
-- Apply via: Supabase Dashboard → SQL Editor
-- ============================================================

-- ============================================================
-- 1. INGREDIENTS catalog table (INGR-01)
-- ============================================================
CREATE TABLE IF NOT EXISTS ingredients (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  image_url           TEXT,
  default_extra_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  default_add_price   NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_available        BOOLEAN NOT NULL DEFAULT true,
  position            INTEGER NOT NULL DEFAULT 0,
  translations        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;

-- Index for tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_ingredients_tenant ON ingredients(tenant_id);

-- RLS: tenant members (store-admin, store-staff) can manage their ingredients
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ingredients' AND policyname = 'Tenant members manage ingredients'
  ) THEN
    CREATE POLICY "Tenant members manage ingredients" ON ingredients
      FOR ALL USING (
        tenant_id = auth_tenant_id() OR is_superadmin()
      );
  END IF;
END $$;

-- RLS: public can read available ingredients (for public menu page)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ingredients' AND policyname = 'Public read available ingredients'
  ) THEN
    CREATE POLICY "Public read available ingredients" ON ingredients
      FOR SELECT USING (is_available = true);
  END IF;
END $$;

-- updated_at trigger
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'ingredients_updated_at'
  ) THEN
    CREATE TRIGGER ingredients_updated_at
      BEFORE UPDATE ON ingredients
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
-- 2. PRODUCT_INGREDIENTS join table (INGR-02)
-- ============================================================
CREATE TABLE IF NOT EXISTS product_ingredients (
  product_id           UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_id        UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  is_default           BOOLEAN NOT NULL DEFAULT false,
  extra_price_override NUMERIC(10,2),
  add_price_override   NUMERIC(10,2),
  position             INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, ingredient_id)
);

ALTER TABLE product_ingredients ENABLE ROW LEVEL SECURITY;

-- Index on (product_id, tenant_id) for efficient product-level queries
CREATE INDEX IF NOT EXISTS idx_product_ingredients_product_tenant
  ON product_ingredients(product_id, tenant_id);

-- RLS: tenant members can manage product_ingredients for their tenant
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'product_ingredients' AND policyname = 'Tenant members manage product_ingredients'
  ) THEN
    CREATE POLICY "Tenant members manage product_ingredients" ON product_ingredients
      FOR ALL USING (
        tenant_id = auth_tenant_id() OR is_superadmin()
      );
  END IF;
END $$;

-- RLS: public can read product_ingredients (needed for public menu customization panel)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'product_ingredients' AND policyname = 'Public read product_ingredients'
  ) THEN
    CREATE POLICY "Public read product_ingredients" ON product_ingredients
      FOR SELECT USING (true);
  END IF;
END $$;

-- ============================================================
-- 3. tenant_settings.ingredient_customization_enabled (INGR-03)
-- ============================================================
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS ingredient_customization_enabled BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- 4. order_items.ingredient_modifications JSONB (INGR-04)
-- ============================================================
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS ingredient_modifications JSONB;

-- ============================================================
-- Done.
-- Reload schema cache: Supabase Dashboard → API → Reload schema
-- ============================================================
