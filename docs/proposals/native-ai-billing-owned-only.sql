-- PROPOSAL ONLY. Never execute on Source or auto-apply during deployment.
-- A separately reviewed candidate operator must pin the existing business
-- manifest, roles, grants, owner, ledger and restoration-proven backup.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $guard$ BEGIN
 IF current_database()<>'xmartmenu' OR current_user<>'xmartmenu_owner'
 OR to_regrole('xmartmenu_runtime') IS NULL OR to_regrole('xmartmenu_staging_reader') IS NULL
 OR to_regclass('public.ai_billing_requests') IS NOT NULL
 THEN RAISE EXCEPTION 'Reviewed owned candidate and absent billing ledger required'; END IF;
END $guard$;
CREATE TABLE public.ai_billing_requests (
 batch_id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL,
 cutoff_at timestamptz NOT NULL,
 request_body jsonb NOT NULL CHECK(jsonb_typeof(request_body)='object'
   AND jsonb_typeof(request_body->'metadata')='object'
   AND jsonb_typeof(request_body->'amount')='number'
   AND (request_body->>'amount')::numeric BETWEEN 1 AND 9007199254740991),
 provider_context jsonb NOT NULL CHECK(jsonb_typeof(provider_context)='object'),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 usage_digest text NOT NULL CHECK(usage_digest ~ '^[a-f0-9]{64}$'),
 event_count integer NOT NULL CHECK(event_count BETWEEN 1 AND 50000),
 cost_usd numeric NOT NULL CHECK(cost_usd>=0),
 charge_usd numeric NOT NULL CHECK(charge_usd>=0),
 max_event_id bigint NOT NULL CHECK(max_event_id>0),
 source_event_id text UNIQUE CHECK(source_event_id ~ '^evt_[A-Za-z0-9]+$'),
 state text NOT NULL CHECK(state IN('prepared','requesting','confirmed','reconcile_required')),
 first_attempt_at timestamptz,
 attempt_token uuid,
 lease_until timestamptz,
 stripe_invoice_item_id text UNIQUE,
 confirmed_at timestamptz,
 CHECK (
   (state='prepared' AND first_attempt_at IS NULL AND attempt_token IS NULL AND lease_until IS NULL AND stripe_invoice_item_id IS NULL AND confirmed_at IS NULL)
   OR (state='requesting' AND first_attempt_at IS NOT NULL AND attempt_token IS NOT NULL AND lease_until IS NOT NULL AND stripe_invoice_item_id IS NULL AND confirmed_at IS NULL)
   OR (state='reconcile_required' AND first_attempt_at IS NOT NULL AND attempt_token IS NULL AND lease_until IS NULL AND stripe_invoice_item_id IS NULL AND confirmed_at IS NULL)
   OR (state='confirmed' AND first_attempt_at IS NOT NULL AND attempt_token IS NULL AND lease_until IS NULL AND stripe_invoice_item_id IS NOT NULL AND confirmed_at IS NOT NULL)
 )
);
CREATE UNIQUE INDEX ai_billing_one_open_tenant ON public.ai_billing_requests(tenant_id) WHERE state<>'confirmed';
ALTER TABLE public.ai_billing_requests ENABLE ROW LEVEL SECURITY;
-- Existing runtime is the approved server BYPASSRLS role; no browser policy.
REVOKE ALL ON public.ai_billing_requests FROM PUBLIC,xmartmenu_runtime,xmartmenu_staging_reader;
DO $public_roles$ BEGIN
 IF to_regrole('anon') IS NOT NULL THEN REVOKE ALL ON public.ai_billing_requests FROM anon; END IF;
 IF to_regrole('authenticated') IS NOT NULL THEN REVOKE ALL ON public.ai_billing_requests FROM authenticated; END IF;
END $public_roles$;
GRANT SELECT,INSERT ON public.ai_billing_requests TO xmartmenu_runtime;
-- Runtime can advance state but cannot replace immutable financial facts.
GRANT UPDATE(state,first_attempt_at,attempt_token,lease_until,stripe_invoice_item_id,confirmed_at) ON public.ai_billing_requests TO xmartmenu_runtime;
GRANT SELECT ON public.ai_billing_requests TO xmartmenu_staging_reader;
COMMIT;
