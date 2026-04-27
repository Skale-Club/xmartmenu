-- Migration 018: Add direct orders toggle to tenant_settings
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS direct_orders_enabled BOOLEAN NOT NULL DEFAULT false;
