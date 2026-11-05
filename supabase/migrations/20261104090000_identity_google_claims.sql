-- Additive. Imported Google subjects (operator script, exact app UID only).
-- Backend-only: browser roles get no access. No flags, accounts or roles change.
CREATE TABLE public.identity_google_subject_claims (
  google_sub text PRIMARY KEY CHECK (length(google_sub) BETWEEN 1 AND 255),
  account_id uuid NOT NULL REFERENCES public.app_accounts(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('supabase-auth-import')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX identity_google_subject_claims_account ON public.identity_google_subject_claims(account_id);

ALTER TABLE public.identity_google_subject_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.identity_google_subject_claims FROM PUBLIC, authenticated;
GRANT SELECT, INSERT ON public.identity_google_subject_claims TO service_role;
-- Roles that exist only in some databases: Supabase has anon, the native
-- database has xmartmenu_runtime. Both are handled without creating a role.
DO $roles$ BEGIN
  IF to_regrole('anon') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON public.identity_google_subject_claims FROM anon';
  END IF;
  IF to_regrole('xmartmenu_runtime') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON public.identity_google_subject_claims TO xmartmenu_runtime';
  END IF;
END $roles$;

-- 'native-registration' is already written by NativeRegistration; 'phone-match'
-- is a verified phone equal to the stored E.164 phone of exactly one eligible
-- customer account.
ALTER TABLE public.app_identity_bindings DROP CONSTRAINT app_identity_bindings_binding_proof_check;
ALTER TABLE public.app_identity_bindings ADD CONSTRAINT app_identity_bindings_binding_proof_check
  CHECK (binding_proof IN ('legacy-session','owned-session','native-registration','google-subject','phone-match','operator-recovery'));
