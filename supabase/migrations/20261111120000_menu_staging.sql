-- Menu staging (legacy Supabase counterpart of
-- docs/owned-schema/20261111120000_menu_staging.sql): a private copy of a live
-- menu, previewed through an unlisted non-indexed link and swapped into
-- production by a publish. See docs/product/menu-staging.md.
ALTER TABLE public.menus
  ADD COLUMN IF NOT EXISTS staging_of UUID NULL REFERENCES public.menus(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS preview_token TEXT NULL,
  ADD COLUMN IF NOT EXISTS replaced_at TIMESTAMPTZ NULL;

ALTER TABLE public.menus DROP CONSTRAINT IF EXISTS menus_staging_not_self;
ALTER TABLE public.menus ADD CONSTRAINT menus_staging_not_self CHECK (staging_of IS NULL OR staging_of <> id);
ALTER TABLE public.menus DROP CONSTRAINT IF EXISTS menus_staging_hidden;
ALTER TABLE public.menus ADD CONSTRAINT menus_staging_hidden CHECK (staging_of IS NULL OR (is_active = false AND is_default = false));
ALTER TABLE public.menus DROP CONSTRAINT IF EXISTS menus_preview_token_check;
ALTER TABLE public.menus ADD CONSTRAINT menus_preview_token_check CHECK (preview_token IS NULL OR preview_token ~ '^[A-Za-z0-9_-]{32,128}$');

CREATE UNIQUE INDEX IF NOT EXISTS menus_preview_token_key ON public.menus(preview_token) WHERE preview_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS menus_staging_of_idx ON public.menus(staging_of) WHERE staging_of IS NOT NULL;
