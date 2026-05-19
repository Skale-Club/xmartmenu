-- Migration 035: add order_type and delivery_address to orders
-- order_type uses TEXT (not ENUM) for forward-compatible changes; CHECK constraint enforces valid values
-- Default 'dine_in' makes all existing orders backward-compatible

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'dine_in'
    CONSTRAINT orders_order_type_check CHECK (order_type IN ('dine_in', 'pickup', 'delivery')),
  ADD COLUMN IF NOT EXISTS delivery_address TEXT;
