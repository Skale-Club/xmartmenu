-- SEED-017: Tip System at Checkout
-- Adds tip configuration to tenant_settings and tip_cents to orders

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS tips_enabled     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tip_percentage_1 INT     NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS tip_percentage_2 INT     NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS tip_percentage_3 INT     NOT NULL DEFAULT 20;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS tip_cents INT NOT NULL DEFAULT 0;
