-- ============================================================
-- Migration 022: AI infrastructure
-- Adds ai_usage table for cost attribution (AI-15)
-- Adds business_type, tagline, about columns to tenant_settings (AI-04)
-- Safe to run multiple times (IF NOT EXISTS / IF NOT EXISTS everywhere)
-- ============================================================

-- ============================================================
-- 1. TENANT_SETTINGS — add AI copy generation columns
-- ============================================================
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS business_type TEXT,
  ADD COLUMN IF NOT EXISTS tagline       TEXT,
  ADD COLUMN IF NOT EXISTS about         TEXT;

-- ============================================================
-- 2. AI_USAGE — cost attribution table
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_usage (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  date        DATE NOT NULL,
  call_count  INTEGER NOT NULL DEFAULT 0,
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, feature_key, date)
);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

-- Superadmin can read and write all usage records
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ai_usage' AND policyname = 'ai_usage_superadmin'
  ) THEN
    CREATE POLICY "ai_usage_superadmin" ON ai_usage
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE id = auth.uid() AND role = 'superadmin'
        )
      );
  END IF;
END $$;

-- No tenant read access — superadmin-only table
