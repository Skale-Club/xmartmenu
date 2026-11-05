-- PROPOSAL ONLY: reviewed owned candidate, no automatic or Source apply.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $guard$ BEGIN
 IF current_database()<>'xmartmenu' OR current_user<>'xmartmenu_owner'
 OR to_regrole('xmartmenu_runtime') IS NULL OR to_regrole('xmartmenu_staging_reader') IS NULL
 OR to_regclass('public.app_subscription_billing_requests') IS NOT NULL
 THEN RAISE EXCEPTION 'Reviewed owned candidate and absent request ledger required'; END IF;
END $guard$;
CREATE TABLE public.app_subscription_billing_requests (
 id uuid PRIMARY KEY,
 tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
 actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 original_tenant_id uuid NOT NULL,
 original_actor_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN('checkout','plan_change','expire_checkout')),
 request_body jsonb NOT NULL CHECK(jsonb_typeof(request_body)='object'),
 facts jsonb NOT NULL CHECK(jsonb_typeof(facts)='object'),
 provider_context jsonb NOT NULL CHECK(jsonb_typeof(provider_context)='object'),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL,
 state text NOT NULL CHECK(state IN('prepared','requesting','open_checkout','completed','rejected','reconcile_required')),
 first_attempt_at timestamptz,
 attempt_token uuid,
 lease_until timestamptz,
 provider_object_id text,
 result jsonb,
 CHECK((state='prepared' AND first_attempt_at IS NULL AND attempt_token IS NULL AND lease_until IS NULL AND provider_object_id IS NULL)
   OR (state='requesting' AND first_attempt_at IS NOT NULL AND attempt_token IS NOT NULL AND lease_until IS NOT NULL)
   OR (state='reconcile_required' AND attempt_token IS NULL AND lease_until IS NULL)
   OR (state IN('completed','rejected') AND attempt_token IS NULL AND lease_until IS NULL)
   OR (state='open_checkout' AND operation='checkout' AND provider_object_id IS NOT NULL AND attempt_token IS NULL AND lease_until IS NULL))
);
CREATE UNIQUE INDEX app_subscription_billing_one_pending ON public.app_subscription_billing_requests(tenant_id)
 WHERE state IN('prepared','requesting','reconcile_required');
CREATE UNIQUE INDEX app_subscription_billing_one_open_checkout ON public.app_subscription_billing_requests(tenant_id)
 WHERE operation='checkout' AND state='open_checkout';
ALTER TABLE public.app_subscription_billing_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_subscription_billing_requests FROM PUBLIC,xmartmenu_runtime,xmartmenu_staging_reader;
DO $browser_roles$ BEGIN
 IF to_regrole('anon') IS NOT NULL THEN REVOKE ALL ON public.app_subscription_billing_requests FROM anon; END IF;
 IF to_regrole('authenticated') IS NOT NULL THEN REVOKE ALL ON public.app_subscription_billing_requests FROM authenticated; END IF;
END $browser_roles$;
GRANT SELECT,INSERT ON public.app_subscription_billing_requests TO xmartmenu_runtime;
GRANT UPDATE(state,first_attempt_at,attempt_token,lease_until,provider_object_id,result) ON public.app_subscription_billing_requests TO xmartmenu_runtime;
GRANT SELECT ON public.app_subscription_billing_requests TO xmartmenu_staging_reader;
COMMIT;
