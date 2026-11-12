-- Access requests: a business that signs up on the main XmartMenu site answers
-- a short questionnaire and waits for the team (docs/product/access-request-onboarding.md,
-- XMM-D-2026-11-12-access-request-onboarding).
-- Legacy counterpart: supabase/migrations/20261112210000_access_requests.sql.
--
--   status    draft -> pending (submitted) -> approved | declined.
--             Submitting never grants access: only a platform administrator's
--             approval links the account to a restaurant (profiles.tenant_id).
--   answers   the questionnaire (src/lib/access-requests/contract.ts), validated
--             by the app; bounded here.
--   tenant_id the restaurant the request was approved into.
--
-- One transaction, idempotent, run by the Owned schema workflow as
-- xmartmenu_owner (docs/owned-schema/README.md). The app treats a missing table
-- as "access requests unavailable", so deploying the code first is safe.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database()<>'xmartmenu' OR current_user<>'xmartmenu_owner'
 OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())<>'xmartmenu_owner'
 THEN RAISE EXCEPTION 'Exact owned database and owner required'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','declined')),
  step text NOT NULL DEFAULT 'language' CHECK (step ~ '^[A-Za-z]{1,40}$'),
  answers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers)='object' AND octet_length(answers::text)<=32768),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version>0),
  whatsapp_opt_in_at timestamptz NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  abandoned_notified_at timestamptz NULL,
  submitted_at timestamptz NULL,
  reviewed_at timestamptz NULL,
  reviewed_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  decision_note text NULL CHECK (decision_note IS NULL OR length(decision_note)<=2000),
  tenant_id uuid NULL REFERENCES public.tenants(id) ON DELETE SET NULL,
  CHECK (status='draft' OR submitted_at IS NOT NULL),
  CHECK (status NOT IN ('approved','declined') OR reviewed_at IS NOT NULL),
  CHECK (status<>'approved' OR tenant_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS access_requests_status_idx ON public.access_requests(status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS access_requests_abandoned_idx ON public.access_requests(last_activity_at)
  WHERE status='draft' AND abandoned_notified_at IS NULL;

ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.access_requests FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.access_requests TO xmartmenu_runtime;

-- Sentinel: the runtime can read and write requests, and the status rule holds.
DO $$ BEGIN
 IF NOT has_table_privilege('xmartmenu_runtime','public.access_requests','SELECT,INSERT,UPDATE')
 THEN RAISE EXCEPTION 'Runtime cannot use access_requests'; END IF;
 IF has_table_privilege('xmartmenu_runtime','public.access_requests','DELETE')
 THEN RAISE EXCEPTION 'Runtime must not delete access_requests'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.access_requests'::regclass AND contype='c'
   AND pg_get_constraintdef(oid) LIKE '%draft%pending%approved%declined%')
 THEN RAISE EXCEPTION 'access_requests status check is missing'; END IF;
END $$;
COMMIT;
