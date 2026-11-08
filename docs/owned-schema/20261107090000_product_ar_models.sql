-- Augmented reality: 3D dish models on the owned PostgreSQL (production).
-- Owned-database counterpart of supabase/migrations/20261107090000_product_ar_models.sql.
-- Lives in docs/owned-schema/ (schema changes after the final cutover), not in
-- docs/proposals/, which is the cutover operator's fixed list.
--
-- Run once as xmartmenu_owner on database xmartmenu (psql in the PostgreSQL
-- container), in one transaction. Idempotent: running it again changes nothing.
--
--   product_ar_models   one 3D model per dish (product_id unique), tenant
--                       checked against the dish by a trigger.
--   xmartmenu_runtime   SELECT, INSERT, UPDATE, DELETE (server role, BYPASSRLS;
--                       no browser role reads or writes this table).
--   menu_events         event_name CHECK gains model_viewer_opened and
--                       ar_launched, keeping every name it already allows.
--
-- The app reads the table only once it exists and the runtime may read it, so
-- deploying the code first is safe: menus just show no 3D until this runs.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database()<>'xmartmenu' OR current_user<>'xmartmenu_owner'
 OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())<>'xmartmenu_owner'
 THEN RAISE EXCEPTION 'Exact owned database and owner required'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.product_ar_models(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id uuid NOT NULL UNIQUE REFERENCES public.products(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 glb_url text NOT NULL CHECK(length(glb_url) BETWEEN 1 AND 2048),
 glb_storage_path text CHECK(glb_storage_path IS NULL OR length(glb_storage_path) <= 1024),
 glb_bytes integer CHECK(glb_bytes IS NULL OR glb_bytes > 0),
 usdz_url text CHECK(usdz_url IS NULL OR length(usdz_url) <= 2048),
 usdz_storage_path text CHECK(usdz_storage_path IS NULL OR length(usdz_storage_path) <= 1024),
 usdz_bytes integer CHECK(usdz_bytes IS NULL OR usdz_bytes > 0),
 poster_url text CHECK(poster_url IS NULL OR length(poster_url) <= 2048),
 real_scale boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_ar_models_tenant_id_idx ON public.product_ar_models(tenant_id);

-- The row's tenant must be the dish's tenant.
CREATE OR REPLACE FUNCTION public.product_ar_models_check_tenant()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id=NEW.product_id AND p.tenant_id=NEW.tenant_id) THEN
  RAISE EXCEPTION 'product_ar_models: product does not belong to tenant' USING ERRCODE='42501';
 END IF;
 NEW.updated_at := now();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.product_ar_models_check_tenant() FROM PUBLIC;
DROP TRIGGER IF EXISTS product_ar_models_check_tenant ON public.product_ar_models;
CREATE TRIGGER product_ar_models_check_tenant BEFORE INSERT OR UPDATE ON public.product_ar_models
 FOR EACH ROW EXECUTE FUNCTION public.product_ar_models_check_tenant();

-- Same audit trail as product_media, only when product_media has it here.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.product_media'::regclass AND tgname='audit_row_change' AND NOT tgisinternal) THEN
  DROP TRIGGER IF EXISTS audit_row_change ON public.product_ar_models;
  CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.product_ar_models
   FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('updated_at,created_at');
 END IF;
END $$;

ALTER TABLE public.product_ar_models ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_ar_models FROM PUBLIC;
DO $$ DECLARE actor text; BEGIN
 FOREACH actor IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=actor) THEN
   EXECUTE format('REVOKE ALL ON public.product_ar_models FROM %I',actor);
  END IF;
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.product_ar_models TO xmartmenu_runtime;

-- menu_events: add the two AR events to whatever the CHECK allows today.
DO $$ DECLARE def text; names text[]; BEGIN
 SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
  WHERE conrelid='public.menu_events'::regclass AND conname='menu_events_event_name_check';
 IF def IS NULL THEN RETURN; END IF;
 SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO names FROM regexp_matches(def, '''([a-z_]+)''', 'g') AS m;
 IF names IS NULL OR array_length(names,1) < 10 THEN RAISE EXCEPTION 'Unexpected menu_events_event_name_check: %', def; END IF;
 IF 'model_viewer_opened' = ANY(names) AND 'ar_launched' = ANY(names) THEN RETURN; END IF;
 names := ARRAY(SELECT DISTINCT n FROM unnest(names || ARRAY['model_viewer_opened','ar_launched']) n ORDER BY n);
 ALTER TABLE public.menu_events DROP CONSTRAINT menu_events_event_name_check;
 -- Same ARRAY['..'::text] shape as before, so a later run can read it back.
 EXECUTE format('ALTER TABLE public.menu_events ADD CONSTRAINT menu_events_event_name_check CHECK (event_name = ANY (ARRAY[%s])) NOT VALID',
  (SELECT string_agg(quote_literal(n) || '::text', ', ' ORDER BY n) FROM unnest(names) n));
 ALTER TABLE public.menu_events VALIDATE CONSTRAINT menu_events_event_name_check;
END $$;

-- Sentinel: the runtime can use the table.
DO $$ BEGIN
 IF NOT has_table_privilege('xmartmenu_runtime','public.product_ar_models','SELECT,INSERT,UPDATE,DELETE')
 THEN RAISE EXCEPTION 'Runtime grants missing on product_ar_models'; END IF;
END $$;
COMMIT;
