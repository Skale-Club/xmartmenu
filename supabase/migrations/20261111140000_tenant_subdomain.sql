-- Restaurant subdomains (legacy Supabase counterpart of
-- docs/owned-schema/20261111140000_tenant_subdomain.sql). NULL = no subdomain.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS subdomain TEXT NULL;
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_subdomain_label_check;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_subdomain_label_check
  CHECK (subdomain IS NULL OR (subdomain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' AND position('--' in subdomain) = 0));
CREATE UNIQUE INDEX IF NOT EXISTS tenants_subdomain_key ON public.tenants(subdomain) WHERE subdomain IS NOT NULL;
