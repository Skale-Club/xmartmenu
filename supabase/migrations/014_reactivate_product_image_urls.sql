-- Migration 014: re-activate multiple product images in all environments

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_urls TEXT[];

ALTER TABLE products
  ALTER COLUMN image_urls SET DEFAULT '{}',
  ALTER COLUMN image_urls SET NOT NULL;

-- Ensure legacy rows always have at least an empty array, and backfill from image_url when useful.
UPDATE products
SET image_urls = CASE
  WHEN image_url IS NOT NULL AND (image_urls IS NULL OR array_length(image_urls, 1) IS NULL OR array_length(image_urls, 1) = 0)
    THEN ARRAY[image_url]
  WHEN image_urls IS NULL
    THEN '{}'
  ELSE image_urls
END;

-- Force PostgREST schema cache refresh (Supabase API) after DDL changes.
NOTIFY pgrst, 'reload schema';
