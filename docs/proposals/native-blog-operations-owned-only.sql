-- REVIEW PROPOSAL ONLY. No automatic migration, flags, provider or live apply.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database()<>'xmartmenu' OR current_user<>'xmartmenu_owner'
 OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())<>'xmartmenu_owner'
 THEN RAISE EXCEPTION 'Exact owned database and owner required'; END IF;
END $$;
CREATE TABLE public.app_blog_operations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid REFERENCES public.tenants(id) ON DELETE RESTRICT,
 actor_id uuid REFERENCES public.app_accounts(id) ON DELETE RESTRICT,
 actor_session_hash text CHECK(actor_session_hash IS NULL OR actor_session_hash ~ '^[a-f0-9]{64}$'),
 authenticated_at timestamptz,
 actor_project_id text,
 actor_subject text,
 kind text NOT NULL CHECK(kind IN('generation','telegram-settings','telegram-send','telegram-callback')),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 256),
 input_digest text NOT NULL CHECK(input_digest ~ '^[a-f0-9]{64}$'),
 input jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(input)='object'),
 settings_digest text CHECK(settings_digest IS NULL OR settings_digest ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN('reserved','running','completed','failed','reconcile')),
 claim_id uuid,
 generation_job_id uuid REFERENCES public.blog_generation_jobs(id) ON DELETE RESTRICT,
 result jsonb,
 draft_payload jsonb,
 outcome_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 CHECK((actor_id IS NULL AND actor_session_hash IS NULL AND authenticated_at IS NULL AND actor_project_id IS NULL AND actor_subject IS NULL)
  OR (actor_id IS NOT NULL AND actor_session_hash IS NOT NULL AND authenticated_at IS NOT NULL AND actor_project_id IS NOT NULL AND actor_subject IS NOT NULL))
);
CREATE UNIQUE INDEX app_blog_operations_request ON public.app_blog_operations(coalesce(tenant_id::text,'platform'),kind,request_key);
CREATE INDEX app_blog_operations_unresolved ON public.app_blog_operations(tenant_id,created_at,id) WHERE status IN('running','reconcile');
CREATE TABLE public.app_blog_calls(
 operation_id uuid NOT NULL REFERENCES public.app_blog_operations(id) ON DELETE RESTRICT,
 call_index integer NOT NULL CHECK(call_index BETWEEN 0 AND 100),
 claim_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('ai','telegram','storage')),
 status text NOT NULL CHECK(status IN('sending','response','ambiguous')),
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 response_digest text CHECK(response_digest IS NULL OR response_digest ~ '^[a-f0-9]{64}$'),
 response_payload jsonb,
 generation_id text,
 model text,
 key_source text CHECK(key_source IS NULL OR key_source IN('tenant','platform')),
 billable boolean NOT NULL DEFAULT false,
 markup_pct numeric NOT NULL DEFAULT 0,
 cost_usd numeric CHECK(cost_usd IS NULL OR cost_usd>=0),
 charge_usd numeric CHECK(charge_usd IS NULL OR charge_usd>=0),
 token_count bigint CHECK(token_count IS NULL OR token_count>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 PRIMARY KEY(operation_id,call_index)
);
ALTER TABLE public.app_blog_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_blog_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_blog_operations,public.app_blog_calls FROM PUBLIC;
DO $$ DECLARE actor text; BEGIN
 FOREACH actor IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=actor) THEN
   EXECUTE format('REVOKE ALL ON public.app_blog_operations,public.app_blog_calls FROM %I',actor);
  END IF;
 END LOOP;
END $$;
-- Existing blog/settings/post/job/feedback/Telegram rows and IDs are unchanged.
-- Backend grants and operational activation require their own reviewed step.
COMMIT;
