-- Migration 045: add missing columns to platform_settings
-- Phase 44: Zero Hardcoded Values
-- cta_color was referenced in code but never added to the DB schema.
-- seo_title and seo_description enable DB-driven marketing metadata.
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS cta_color       TEXT NOT NULL DEFAULT '#EEFF00',
  ADD COLUMN IF NOT EXISTS seo_title       TEXT,
  ADD COLUMN IF NOT EXISTS seo_description TEXT;
