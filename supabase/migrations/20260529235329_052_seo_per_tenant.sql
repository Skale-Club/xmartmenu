-- Migration 052: Per-tenant SEO overrides (SEED-014 completion)
-- Adds optional SEO override fields to tenant_settings. Non-breaking:
-- when NULL/empty the public pages fall back to derived values.
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS seo_title        TEXT,
  ADD COLUMN IF NOT EXISTS seo_description  TEXT,
  ADD COLUMN IF NOT EXISTS seo_keywords     TEXT,
  ADD COLUMN IF NOT EXISTS seo_og_image_url TEXT,
  ADD COLUMN IF NOT EXISTS seo_noindex      BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN tenant_settings.seo_title        IS 'SEED-014: optional <title> override for the public menu (falls back to tenant name).';
COMMENT ON COLUMN tenant_settings.seo_description  IS 'SEED-014: optional meta description override (falls back to tagline/about).';
COMMENT ON COLUMN tenant_settings.seo_keywords     IS 'SEED-014: optional comma-separated meta keywords.';
COMMENT ON COLUMN tenant_settings.seo_og_image_url IS 'SEED-014: optional Open Graph/Twitter image override (https URL). When NULL a branded card is generated at runtime.';
COMMENT ON COLUMN tenant_settings.seo_noindex      IS 'SEED-014: when true, the public menu is excluded from search indexing (noindex,nofollow).';

-- Platform-level SEO knobs used by the marketing landing schema.
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS twitter_handle TEXT,
  ADD COLUMN IF NOT EXISTS social_links   JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN platform_settings.twitter_handle IS 'SEED-014: @handle used for twitter:site card attribution.';
COMMENT ON COLUMN platform_settings.social_links   IS 'SEED-014: array of public profile URLs surfaced as Organization.sameAs.';;
