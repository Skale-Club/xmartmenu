-- Migration 012: Multi-language support for menus

ALTER TABLE menus
  ADD COLUMN IF NOT EXISTS supported_languages TEXT[] NOT NULL DEFAULT ARRAY['en'];

ALTER TABLE menus
  ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Keep existing menu language as the default supported language when possible
UPDATE menus
SET supported_languages = ARRAY[COALESCE(NULLIF(language, ''), 'en')]
WHERE supported_languages IS NULL
   OR array_length(supported_languages, 1) IS NULL
   OR array_length(supported_languages, 1) = 0;
