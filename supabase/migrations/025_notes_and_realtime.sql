-- ============================================================
-- Migration 025: Per-item notes + Realtime publication
-- Adds item_notes_enabled to tenant_settings (NOTE-01)
-- Adds notes column to order_items (NOTE-03)
-- Enables Realtime publication on orders table (KDS-06)
-- Safe to run multiple times (IF NOT EXISTS everywhere)
-- ============================================================

-- 1. Add item_notes_enabled flag to tenant_settings
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS item_notes_enabled BOOLEAN NOT NULL DEFAULT false;

-- 2. Add notes column to order_items
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- 3. Enable Realtime publication for orders table
--    Required for postgres_changes subscription in OrdersClient
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
