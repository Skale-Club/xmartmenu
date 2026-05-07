-- ============================================================
-- Migration 023: ai_jobs table
-- Tracks long-running image seeding jobs dispatched to GH Actions (AI-07, AI-08, AI-09)
-- Safe to run multiple times (IF NOT EXISTS everywhere)
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature_key   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  error_message TEXT
);

ALTER TABLE ai_jobs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ai_jobs' AND policyname = 'ai_jobs_superadmin'
  ) THEN
    CREATE POLICY "ai_jobs_superadmin" ON ai_jobs
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE id = auth.uid() AND role = 'superadmin'
        )
      );
  END IF;
END $$;
