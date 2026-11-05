-- Additive. Imported Google subjects (operator script, exact app UID only) and
-- the short-lived pending Google identity that waits for a verified phone.
-- Backend-only: browser roles get no access. No flags, accounts or roles change.
CREATE TABLE public.identity_google_subject_claims (
  google_sub text PRIMARY KEY CHECK (length(google_sub) BETWEEN 1 AND 255),
  account_id uuid NOT NULL REFERENCES public.app_accounts(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('supabase-auth-import')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX identity_google_subject_claims_account ON public.identity_google_subject_claims(account_id);

CREATE TABLE public.app_identity_pending_google (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  project_id text NOT NULL,
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 128),
  authenticated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX app_identity_pending_google_expiry ON public.app_identity_pending_google(expires_at);

ALTER TABLE public.identity_google_subject_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_identity_pending_google ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.identity_google_subject_claims, public.app_identity_pending_google FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.identity_google_subject_claims TO service_role;
GRANT SELECT, INSERT, DELETE ON public.app_identity_pending_google TO service_role;

-- 'native-registration' is already written by NativeRegistration; 'phone-match'
-- is a verified phone that equals exactly one active account's profile phone.
ALTER TABLE public.app_identity_bindings DROP CONSTRAINT app_identity_bindings_binding_proof_check;
ALTER TABLE public.app_identity_bindings ADD CONSTRAINT app_identity_bindings_binding_proof_check
  CHECK (binding_proof IN ('legacy-session','owned-session','native-registration','google-subject','phone-match','operator-recovery'));
