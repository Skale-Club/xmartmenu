-- REVIEWED OWNED-ONLY PROPOSAL. Never run through Source migrations or startup.
-- Apply separately with the native tenant administration feature still false.
BEGIN;
CREATE TABLE public.app_tenant_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('onboarded')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','cancelled','processing','delivered','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_tenant_effects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_tenant_effects FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.app_tenant_effects FROM %I',r);
    END IF;
  END LOOP;
END $$;
-- Separately grant SELECT,INSERT,UPDATE to the reviewed existing admin backend
-- role; never grant browser/anon/authenticated access. No dispatcher is enabled.
COMMIT;
