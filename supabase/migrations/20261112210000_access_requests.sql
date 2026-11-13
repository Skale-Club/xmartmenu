-- Access requests (development database counterpart of
-- docs/owned-schema/20261112210000_access_requests.sql; see that file and
-- docs/product/access-request-onboarding.md). Server-only table: browser roles
-- get nothing.
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
REVOKE ALL ON public.access_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.access_requests TO service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='xmartmenu_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON public.access_requests TO xmartmenu_runtime;
  END IF;
END $$;
