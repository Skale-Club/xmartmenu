-- Menu staging: a private copy of a live menu that the team edits and the
-- restaurant approves through an unlisted, non-indexed preview link, then
-- swaps into production in one step (docs/product/menu-staging.md).
-- Legacy counterpart: supabase/migrations/20261111120000_menu_staging.sql.
--
--   menus.staging_of     the live menu this one stages (NULL for ordinary menus).
--                        Also set on the version a publish replaced, so it can
--                        be restored by publishing it again.
--   menus.preview_token  unguessable token of the preview link
--                        /<slug>/preview/<token>; only staging menus answer it.
--   menus.replaced_at    when a publish took this version out of production
--                        (NULL for a staging copy that was never live).
--   menus_staging_hidden a staging menu can never be visible or the default:
--                        the only way to production is the publish swap.
--
-- ON DELETE SET NULL on staging_of: deleting a live menu leaves its staging as
-- an ordinary hidden menu instead of cascading into rows the menu deletion
-- guard did not lock (src/lib/data/admin-menus.ts reviews this edge).
--
-- One transaction, idempotent, run by the Owned schema workflow as
-- xmartmenu_owner (docs/owned-schema/README.md). The app tolerates the columns
-- being absent (staging actions answer 503 until this runs).
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database()<>'xmartmenu' OR current_user<>'xmartmenu_owner'
 OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())<>'xmartmenu_owner'
 THEN RAISE EXCEPTION 'Exact owned database and owner required'; END IF;
END $$;

ALTER TABLE public.menus
  ADD COLUMN IF NOT EXISTS staging_of uuid NULL,
  ADD COLUMN IF NOT EXISTS preview_token text NULL,
  ADD COLUMN IF NOT EXISTS replaced_at timestamptz NULL;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.menus'::regclass AND conname='menus_staging_of_fkey') THEN
  ALTER TABLE public.menus ADD CONSTRAINT menus_staging_of_fkey FOREIGN KEY (staging_of) REFERENCES public.menus(id) ON DELETE SET NULL;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.menus'::regclass AND conname='menus_staging_not_self') THEN
  ALTER TABLE public.menus ADD CONSTRAINT menus_staging_not_self CHECK (staging_of IS NULL OR staging_of <> id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.menus'::regclass AND conname='menus_staging_hidden') THEN
  ALTER TABLE public.menus ADD CONSTRAINT menus_staging_hidden CHECK (staging_of IS NULL OR (is_active = false AND is_default = false));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.menus'::regclass AND conname='menus_preview_token_check') THEN
  ALTER TABLE public.menus ADD CONSTRAINT menus_preview_token_check CHECK (preview_token IS NULL OR preview_token ~ '^[A-Za-z0-9_-]{32,128}$');
 END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS menus_preview_token_key ON public.menus(preview_token) WHERE preview_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS menus_staging_of_idx ON public.menus(staging_of) WHERE staging_of IS NOT NULL;

GRANT SELECT, INSERT, UPDATE (staging_of, preview_token, replaced_at) ON public.menus TO xmartmenu_runtime;

-- Sentinel: the runtime can read and write the new columns, and the guard holds.
DO $$ BEGIN
 IF NOT has_column_privilege('xmartmenu_runtime','public.menus','staging_of','SELECT,INSERT,UPDATE')
 OR NOT has_column_privilege('xmartmenu_runtime','public.menus','preview_token','SELECT,INSERT,UPDATE')
 OR NOT has_column_privilege('xmartmenu_runtime','public.menus','replaced_at','SELECT,INSERT,UPDATE')
 THEN RAISE EXCEPTION 'Runtime cannot use the menu staging columns'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.menus'::regclass AND conname='menus_staging_hidden' AND convalidated)
 THEN RAISE EXCEPTION 'menus_staging_hidden is missing'; END IF;
END $$;
COMMIT;
