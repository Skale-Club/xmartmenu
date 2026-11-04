-- Short-lived, single-use browser binding for the opt-in identity pilot.
-- No provider tokens, account IDs or personal data are stored in challenges.
CREATE TABLE public.app_identity_challenges (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX app_identity_challenges_expiry ON public.app_identity_challenges(expires_at);
ALTER TABLE public.app_identity_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_identity_challenges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.app_identity_challenges TO service_role;

ALTER TABLE public.app_identity_bindings DROP CONSTRAINT app_identity_bindings_binding_proof_check;
ALTER TABLE public.app_identity_bindings ADD CONSTRAINT app_identity_bindings_binding_proof_check
  CHECK (binding_proof IN ('legacy-session', 'owned-session', 'google-subject', 'operator-recovery'));
