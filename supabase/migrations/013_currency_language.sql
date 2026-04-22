-- Migration 013: Ensure currency and language columns exist on tenant_settings
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'BRL';
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'pt';
