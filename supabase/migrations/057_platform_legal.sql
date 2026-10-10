-- 057_platform_legal.sql
-- Legal documents (Terms of Service, Privacy Policy) editable from the
-- superadmin Platform Settings panel, so publishing them no longer requires a
-- code change and a deploy.
--
-- Stored as one jsonb blob to match the existing `landing` / `social_links`
-- grouping on this single-row table:
--
--   {
--     "terms":   { "title": "...", "body": "...", "updated_at": "2026-08-06" },
--     "privacy": { "title": "...", "body": "...", "updated_at": "2026-08-06" }
--   }
--
-- `body` holds a small Markdown subset. It is rendered to React nodes by
-- src/lib/marketing/legal-doc.tsx and never injected as HTML, so no sanitizer
-- is required on the read path.
--
-- Default '{}' means "not published yet": both pages fall back to their
-- built-in placeholder, which is the behaviour before this migration.

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS legal JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN platform_settings.legal IS
  'Terms/Privacy documents rendered at /terms and /privacy. Keys: terms, privacy — each { title, body, updated_at }. Body is a Markdown subset rendered to React nodes, never raw HTML.';
