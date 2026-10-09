-- Migration 053: Local SEO — structured address, geo coordinates & price range
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS city        TEXT,
  ADD COLUMN IF NOT EXISTS region      TEXT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT,
  ADD COLUMN IF NOT EXISTS country     TEXT,
  ADD COLUMN IF NOT EXISTS latitude    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS price_range TEXT;

COMMENT ON COLUMN tenant_settings.region      IS 'SEED-014 local SEO: state/province → schema.org addressRegion.';
COMMENT ON COLUMN tenant_settings.postal_code IS 'SEED-014 local SEO: → schema.org postalCode.';
COMMENT ON COLUMN tenant_settings.country     IS 'SEED-014 local SEO: ISO country (e.g. US, BR) → schema.org addressCountry.';
COMMENT ON COLUMN tenant_settings.latitude    IS 'SEED-014 local SEO: → schema.org geo.latitude (for "near me" / Maps).';
COMMENT ON COLUMN tenant_settings.longitude   IS 'SEED-014 local SEO: → schema.org geo.longitude.';
COMMENT ON COLUMN tenant_settings.price_range IS 'SEED-014 local SEO: $/$$/$$$/$$$$ → schema.org priceRange.';

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS region      TEXT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT,
  ADD COLUMN IF NOT EXISTS country     TEXT,
  ADD COLUMN IF NOT EXISTS latitude    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude   DOUBLE PRECISION;

COMMENT ON COLUMN locations.latitude  IS 'SEED-014 local SEO: branch geo.latitude for per-branch local indexing.';
COMMENT ON COLUMN locations.longitude IS 'SEED-014 local SEO: branch geo.longitude.';;
