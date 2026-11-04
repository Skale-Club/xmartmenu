-- PROPOSAL ONLY. No automatic/Source apply. A reviewed candidate operation
-- must pin business manifests, profiles, roles, ledger and restore proof.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $guard$ BEGIN
 IF current_database()<>'xmartmenu' OR current_user<>'xmartmenu_owner'
 OR to_regrole('xmartmenu_runtime') IS NULL OR to_regrole('xmartmenu_staging_reader') IS NULL
 OR to_regclass('public.app_stripe_oauth_attempts') IS NOT NULL
 THEN RAISE EXCEPTION 'Reviewed owned candidate and absent OAuth ledger required'; END IF;
END $guard$;
CREATE TABLE public.app_stripe_oauth_attempts (
 nonce_hash text PRIMARY KEY CHECK(nonce_hash ~ '^[a-f0-9]{64}$'),
 code_hash text NOT NULL UNIQUE CHECK(code_hash ~ '^[a-f0-9]{64}$'),
 actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
 original_actor_id uuid NOT NULL,
 original_tenant_id uuid NOT NULL,
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL CHECK(expires_at>=created_at AND expires_at<=created_at+interval '16 minutes'),
 state text NOT NULL CHECK(state IN('claimed','connected','reconcile_required')),
 stripe_account_id text,
 completed_at timestamptz,
 CHECK((state='claimed' AND stripe_account_id IS NULL AND completed_at IS NULL)
   OR (state='connected' AND stripe_account_id IS NOT NULL AND completed_at IS NOT NULL)
   OR (state='reconcile_required' AND completed_at IS NULL))
);
ALTER TABLE public.app_stripe_oauth_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_stripe_oauth_attempts FROM PUBLIC,xmartmenu_runtime,xmartmenu_staging_reader;
DO $browser_roles$ BEGIN
 IF to_regrole('anon') IS NOT NULL THEN REVOKE ALL ON public.app_stripe_oauth_attempts FROM anon; END IF;
 IF to_regrole('authenticated') IS NOT NULL THEN REVOKE ALL ON public.app_stripe_oauth_attempts FROM authenticated; END IF;
END $browser_roles$;
GRANT SELECT,INSERT ON public.app_stripe_oauth_attempts TO xmartmenu_runtime;
GRANT UPDATE(state,stripe_account_id,completed_at) ON public.app_stripe_oauth_attempts TO xmartmenu_runtime;
GRANT SELECT ON public.app_stripe_oauth_attempts TO xmartmenu_staging_reader;
COMMIT;
