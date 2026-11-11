-- Augmented reality, second step: real-size correction of a dish's 3D model,
-- and AR orders told apart in the analytics.
-- Legacy counterpart: supabase/migrations/20261111090000_ar_real_size_and_cart_source.sql.
--
--   product_ar_models.scale           multiplies the model's own size so the dish
--                                     shows at its real size (1 = as modelled).
--                                     Set from the back office: real size / size in the file.
--   product_ar_models.model_width_cm  the model's largest horizontal side as
--                                     modelled (cm), measured on upload; shown
--                                     next to the real-size field.
--   menu_events source CHECK          gains 'ar': add_to_cart from the AR camera.
--
-- One transaction, idempotent, run by the Owned schema workflow as
-- xmartmenu_owner (docs/owned-schema/README.md). The app reads the new columns
-- only once they exist.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database()<>'xmartmenu' OR current_user<>'xmartmenu_owner'
 OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())<>'xmartmenu_owner'
 THEN RAISE EXCEPTION 'Exact owned database and owner required'; END IF;
END $$;

ALTER TABLE public.product_ar_models
  ADD COLUMN IF NOT EXISTS scale numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS model_width_cm numeric NULL;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.product_ar_models'::regclass AND conname='product_ar_models_scale_check') THEN
  ALTER TABLE public.product_ar_models ADD CONSTRAINT product_ar_models_scale_check CHECK (scale >= 0.05 AND scale <= 20);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.product_ar_models'::regclass AND conname='product_ar_models_model_width_check') THEN
  ALTER TABLE public.product_ar_models ADD CONSTRAINT product_ar_models_model_width_check CHECK (model_width_cm IS NULL OR (model_width_cm > 0 AND model_width_cm < 10000));
 END IF;
END $$;

-- menu_events: add 'ar' to whatever the source CHECK allows today.
DO $$ DECLARE def text; names text[]; BEGIN
 SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
  WHERE conrelid='public.menu_events'::regclass AND conname='menu_events_source_check';
 IF def IS NULL THEN RETURN; END IF;
 SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO names FROM regexp_matches(def, '''([a-z_]+)''', 'g') AS m;
 IF names IS NULL OR array_length(names,1) < 5 THEN RAISE EXCEPTION 'Unexpected menu_events_source_check: %', def; END IF;
 IF 'ar' = ANY(names) THEN RETURN; END IF;
 names := ARRAY(SELECT DISTINCT n FROM unnest(names || ARRAY['ar']) n ORDER BY n);
 ALTER TABLE public.menu_events DROP CONSTRAINT menu_events_source_check;
 -- Same ARRAY['..'::text] shape, so a later run can read it back.
 EXECUTE format('ALTER TABLE public.menu_events ADD CONSTRAINT menu_events_source_check CHECK (source IS NULL OR source = ANY (ARRAY[%s])) NOT VALID',
  (SELECT string_agg(quote_literal(n) || '::text', ', ' ORDER BY n) FROM unnest(names) n));
 ALTER TABLE public.menu_events VALIDATE CONSTRAINT menu_events_source_check;
END $$;

-- Sentinel: the runtime can read and write the new columns.
DO $$ BEGIN
 IF NOT has_column_privilege('xmartmenu_runtime','public.product_ar_models','scale','SELECT,INSERT,UPDATE')
 OR NOT has_column_privilege('xmartmenu_runtime','public.product_ar_models','model_width_cm','SELECT,INSERT,UPDATE')
 THEN RAISE EXCEPTION 'Runtime cannot use the new product_ar_models columns'; END IF;
END $$;
COMMIT;
