-- ============================================================
-- Migration 027: KDS urgency thresholds (v1.8 KDS+)
-- Adds amber_threshold_minutes and red_threshold_minutes to
-- tenant_settings. Safe to run multiple times (IF NOT EXISTS).
-- Apply via: node scripts/apply-migration-027.mjs
-- ============================================================

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS amber_threshold_minutes INT NOT NULL DEFAULT 10;

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS red_threshold_minutes INT NOT NULL DEFAULT 20;
