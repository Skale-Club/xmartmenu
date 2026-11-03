-- Additive foundation only. No account creation, automatic matching, role
-- changes, legacy login retirement, or production cutover in this migration.
-- Populate accounts from a reconciled source manifest in a separate operation.
CREATE TABLE public.app_accounts (
  id uuid PRIMARY KEY,
  disabled_at timestamptz,
  session_version integer NOT NULL DEFAULT 0 CHECK (session_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.app_identity_bindings (
  project_id text NOT NULL,
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 128),
  user_id uuid NOT NULL REFERENCES public.app_accounts(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('phone', 'google.com')),
  binding_proof text NOT NULL CHECK (binding_proof IN ('legacy-session', 'google-subject', 'operator-recovery')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, subject)
);
CREATE INDEX app_identity_bindings_user ON public.app_identity_bindings(user_id);

CREATE TABLE public.app_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES public.app_accounts(id) ON DELETE CASCADE,
  session_version integer NOT NULL,
  authenticated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX app_sessions_user ON public.app_sessions(user_id);
CREATE INDEX app_sessions_expiry ON public.app_sessions(expires_at);

-- These are backend-only. Browser RLS gets no policies, including the owner.
ALTER TABLE public.app_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_identity_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_accounts, public.app_identity_bindings, public.app_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_accounts, public.app_identity_bindings, public.app_sessions TO service_role;
