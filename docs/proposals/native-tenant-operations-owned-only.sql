-- PROPOSAL ONLY. No startup/migration hook, provider call or flag activation.
BEGIN;
CREATE TABLE public.app_tenant_operations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES public.app_accounts(id) ON DELETE RESTRICT,
  actor_session_hash text NOT NULL CHECK(actor_session_hash ~ '^[a-f0-9]{64}$'),
  request_key uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN('seed','image','image-job','ocr','upload','ocr-upload')),
  input_digest text NOT NULL CHECK(input_digest ~ '^[a-f0-9]{64}$'),
  input jsonb NOT NULL,
  menu_id uuid,
  category_id uuid,
  product_id uuid,
  status text NOT NULL DEFAULT 'reserved' CHECK(status IN('reserved','running','generated','applied','rejected','failed','reconcile')),
  claim_id uuid,
  snapshot_digest text,
  result jsonb,
  outcome_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(actor_id,tenant_id,kind,request_key)
);
CREATE TABLE public.app_tenant_operation_calls (
  operation_id uuid NOT NULL REFERENCES public.app_tenant_operations(id) ON DELETE RESTRICT,
  call_index integer NOT NULL CHECK(call_index BETWEEN 0 AND 1000),
  claim_id uuid NOT NULL,
  status text NOT NULL CHECK(status IN('prepared','response','ambiguous','failed')),
  request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
  feature text NOT NULL CHECK(feature IN('seed','ocr','seed_image','storage')),
  response_digest text,
  generation_id text,
  model text,
  cost_usd numeric,
  token_count bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY(operation_id,call_index)
);
CREATE TABLE public.app_tenant_uploads (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE REFERENCES public.app_tenant_operations(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES public.app_accounts(id) ON DELETE RESTRICT,
  actor_session_hash text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  content_type text NOT NULL,
  byte_length bigint NOT NULL CHECK(byte_length BETWEEN 1 AND 15728640),
  expires_at timestamptz NOT NULL,
  consumed_by uuid REFERENCES public.app_tenant_operations(id) ON DELETE RESTRICT,
  content_digest text
);
ALTER TABLE public.app_tenant_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_tenant_operation_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_tenant_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_tenant_operations,public.app_tenant_operation_calls,public.app_tenant_uploads FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.app_tenant_operations,public.app_tenant_operation_calls,public.app_tenant_uploads FROM %I',r);
    END IF;
  END LOOP;
END $$;
-- Explicit existing backend DML grants are reviewed separately. No credentials,
-- raw user session tokens, provider identities or arbitrary SQL are stored.
COMMIT;
