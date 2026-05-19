-- SEED-019: Public / Private Menu Modes
-- is_private gates menu behind phone OTP login; price_multiplier adjusts prices

ALTER TABLE menus
  ADD COLUMN IF NOT EXISTS is_private       BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_multiplier DECIMAL(5,2) NOT NULL DEFAULT 1.00;
