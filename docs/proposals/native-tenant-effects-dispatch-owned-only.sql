-- PROPOSAL ONLY, reviewed separately after the PR62 table. Never auto-migrate.
-- No provider/network work or flags are enabled by this schema preparation.
BEGIN;
ALTER TABLE public.app_tenant_effects DROP CONSTRAINT app_tenant_effects_kind_check;
ALTER TABLE public.app_tenant_effects ADD CONSTRAINT app_tenant_effects_kind_check
  CHECK(kind IN('onboarded','plan_activated','plan_changed','past_due','churned','connect_changed','backfill','manual'));
ALTER TABLE public.app_tenant_effects DROP CONSTRAINT app_tenant_effects_status_check;
ALTER TABLE public.app_tenant_effects ADD CONSTRAINT app_tenant_effects_status_check
  CHECK(status IN('pending','cancelled','processing','delivered','failed','reconcile'));
ALTER TABLE public.app_tenant_effects
  ADD COLUMN event_id text CHECK(event_id IS NULL OR length(event_id) BETWEEN 1 AND 256),
  ADD COLUMN tags jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(tags)='array'),
  ADD COLUMN claim_id uuid,
  ADD COLUMN claimed_at timestamptz,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN outcome_code text,
  ADD COLUMN observed_at timestamptz,
  ADD COLUMN request_digest text CHECK(request_digest IS NULL OR request_digest ~ '^[a-f0-9]{64}$'),
  ADD COLUMN response_digest text CHECK(response_digest IS NULL OR response_digest ~ '^[a-f0-9]{64}$');
CREATE UNIQUE INDEX app_tenant_effects_event_dedup ON public.app_tenant_effects(tenant_id,kind,event_id) WHERE event_id IS NOT NULL;
CREATE INDEX app_tenant_effects_pending ON public.app_tenant_effects(created_at,id) WHERE status='pending';
-- Existing IDs/status/tenant/kind/created_at are preserved. New defaults are
-- neutral; no existing job is claimed or dispatched by this proposal.
COMMIT;
