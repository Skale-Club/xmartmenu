-- Run before deploying the public/catalog projections that read feed_image_url.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database()<>'xmartmenu' OR current_user<>'xmartmenu_owner'
 OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())<>'xmartmenu_owner'
 THEN RAISE EXCEPTION 'Exact owned database and owner required'; END IF;
END $$;
-- Dedicated portrait still for the visual feed; ordinary galleries stay unchanged.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS feed_image_url text NULL;
COMMENT ON COLUMN public.products.feed_image_url IS 'Optional authored portrait scene for the visual feed; excluded from ordinary product galleries.';
GRANT SELECT (feed_image_url), INSERT (feed_image_url), UPDATE (feed_image_url) ON public.products TO xmartmenu_runtime;
DO $$ BEGIN
 IF NOT has_column_privilege('xmartmenu_runtime','public.products','feed_image_url','SELECT,INSERT,UPDATE')
 THEN RAISE EXCEPTION 'Runtime cannot use products.feed_image_url'; END IF;
END $$;
COMMIT;
