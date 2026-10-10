-- 056_orders_phone_key.sql
-- Add a stable phone-match key so the customer /me panel can find a visitor's
-- orders. orders.customer_phone stores the free-text value typed at checkout,
-- while the OTP session phone is E.164 — an exact match never lines them up.
-- customer_phone_key holds the last 8 digits (local subscriber number), which
-- both the write path and the /me read path derive identically.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_phone_key TEXT;

-- Backfill existing rows: strip non-digits, take the last 8.
UPDATE orders
  SET customer_phone_key = RIGHT(REGEXP_REPLACE(COALESCE(customer_phone, ''), '\D', '', 'g'), 8)
  WHERE customer_phone_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_tenant_phone_key
  ON orders (tenant_id, customer_phone_key);
