-- Restaurant subdomains: <label>.<TENANT_SUBDOMAIN_BASE> serves the restaurant
-- like a verified custom domain (docs/product/tenant-subdomains.md).
-- Legacy counterpart: supabase/migrations/20261111140000_tenant_subdomain.sql.
--
--   tenants.subdomain   one DNS label, NULL = no subdomain (the default: opt-in
--                       per restaurant, set by a platform administrator).
--                       Unique across restaurants. Reserved names are refused by
--                       the app (src/lib/tenant-subdomain.ts), not here.
--
-- One transaction, idempotent, run by the Owned schema workflow as
-- xmartmenu_owner (docs/owned-schema/README.md). The app reads the column only
-- once it exists, so deploying the code first is safe.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database()<>'xmartmenu' OR current_user<>'xmartmenu_owner'
 OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())<>'xmartmenu_owner'
 THEN RAISE EXCEPTION 'Exact owned database and owner required'; END IF;
END $$;

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS subdomain text NULL;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tenants'::regclass AND conname='tenants_subdomain_label_check') THEN
  ALTER TABLE public.tenants ADD CONSTRAINT tenants_subdomain_label_check
   CHECK (subdomain IS NULL OR (subdomain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' AND position('--' in subdomain) = 0));
 END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_subdomain_key ON public.tenants(subdomain) WHERE subdomain IS NOT NULL;

GRANT SELECT, UPDATE (subdomain) ON public.tenants TO xmartmenu_runtime;

-- Sentinel: the runtime can read and set the column, and the label rule holds.
DO $$ BEGIN
 IF NOT has_column_privilege('xmartmenu_runtime','public.tenants','subdomain','SELECT,UPDATE')
 THEN RAISE EXCEPTION 'Runtime cannot use tenants.subdomain'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tenants'::regclass AND conname='tenants_subdomain_label_check' AND convalidated)
 THEN RAISE EXCEPTION 'tenants_subdomain_label_check is missing'; END IF;
END $$;
COMMIT;
