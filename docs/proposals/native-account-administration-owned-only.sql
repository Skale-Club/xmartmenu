-- REVIEW SEPARATELY. No automatic migration, existing data updates or apply.
BEGIN;
CREATE TABLE public.app_staff_access_codes (
 id uuid PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN('invite','recovery')),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 recipient_user_id uuid NOT NULL REFERENCES public.app_accounts(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 issued_by uuid NOT NULL REFERENCES public.app_accounts(id) ON DELETE CASCADE,
 expected_session_version integer NOT NULL CHECK(expected_session_version>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 used_at timestamptz,
 revoked_at timestamptz,
 CHECK(expires_at>created_at)
);
CREATE INDEX app_staff_access_codes_recipient ON public.app_staff_access_codes(recipient_user_id,tenant_id,kind);
ALTER TABLE public.app_staff_access_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_staff_access_codes FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.app_staff_access_codes FROM %I',r); END IF;
 END LOOP;
END $$;
-- Review SELECT/INSERT/UPDATE permissions for the actual existing admin runtime
-- role, plus INSERT/sequence privileges on the existing audit_events table.
-- No provider tables, profile defaults, bans, role grants or historical rows change.
COMMIT;
