-- Proposal only. No Source migration and no live apply in this publication.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'xmartmenu' OR current_user<>'xmartmenu_owner' THEN
    RAISE EXCEPTION 'Reviewed OWNED database/owner required';
  END IF;
END $$;
CREATE TABLE public.app_mcp_clients (
  id text PRIMARY KEY CHECK(id ~ '^xm_mcp_client_[a-f0-9]{32}$'),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  redirect_uris text[] NOT NULL CHECK(cardinality(redirect_uris) BETWEEN 1 AND 10),
  auth_method text NOT NULL CHECK(auth_method IN ('none','client_secret_basic','client_secret_post')),
  grant_types text[] NOT NULL CHECK(cardinality(grant_types) BETWEEN 1 AND 2 AND grant_types @> ARRAY['authorization_code']::text[] AND grant_types <@ ARRAY['authorization_code','refresh_token']::text[]),
  secret_hash text CHECK(secret_hash ~ '^[a-f0-9]{64}$'),
  CHECK((auth_method='none' AND secret_hash IS NULL) OR (auth_method<>'none' AND secret_hash IS NOT NULL)),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.app_mcp_grants (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.app_accounts(id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES public.app_mcp_clients(id) ON DELETE CASCADE,
  session_version integer NOT NULL CHECK(session_version>=0),
  project_id text NOT NULL,
  subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 128),
  authenticated_at timestamptz NOT NULL,
  resource text NOT NULL CHECK(length(resource) BETWEEN 1 AND 2048),
  scopes text[] NOT NULL CHECK(scopes=ARRAY['mcp:admin']::text[]),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at>created_at)
);
CREATE TABLE public.app_mcp_authorizations (
  request_hash text PRIMARY KEY CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  client_id text NOT NULL REFERENCES public.app_mcp_clients(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL CHECK(length(redirect_uri) BETWEEN 1 AND 2048),
  resource text NOT NULL CHECK(length(resource) BETWEEN 1 AND 2048),
  scopes text[] NOT NULL CHECK(scopes=ARRAY['mcp:admin']::text[]),
  state text NOT NULL CHECK(length(state) BETWEEN 1 AND 2048),
  challenge text NOT NULL CHECK(challenge ~ '^[A-Za-z0-9_-]{43}$'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','used')),
  grant_id uuid REFERENCES public.app_mcp_grants(id) ON DELETE CASCADE,
  code_hash text UNIQUE CHECK(code_hash ~ '^[a-f0-9]{64}$'),
  code_expires_at timestamptz,
  used_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at>created_at),
  CHECK((status IN ('pending','denied') AND grant_id IS NULL AND code_hash IS NULL AND code_expires_at IS NULL AND used_at IS NULL)
    OR (status='approved' AND grant_id IS NOT NULL AND code_hash IS NOT NULL AND code_expires_at IS NOT NULL AND used_at IS NULL)
    OR (status='used' AND grant_id IS NOT NULL AND code_hash IS NOT NULL AND code_expires_at IS NOT NULL AND used_at IS NOT NULL))
);
CREATE TABLE public.app_mcp_tokens (
  token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  grant_id uuid NOT NULL REFERENCES public.app_mcp_grants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('access','refresh')),
  parent_hash text REFERENCES public.app_mcp_tokens(token_hash),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at>created_at)
);
CREATE INDEX app_mcp_grants_user ON public.app_mcp_grants(user_id);
CREATE INDEX app_mcp_clients_created ON public.app_mcp_clients(created_at);
CREATE INDEX app_mcp_tokens_grant ON public.app_mcp_tokens(grant_id);
CREATE INDEX app_mcp_authorizations_client_created ON public.app_mcp_authorizations(client_id,created_at);
CREATE INDEX app_mcp_authorizations_created ON public.app_mcp_authorizations(created_at);
REVOKE ALL ON public.app_mcp_clients,public.app_mcp_grants,public.app_mcp_authorizations,public.app_mcp_tokens FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON public.app_mcp_clients,public.app_mcp_grants,public.app_mcp_authorizations,public.app_mcp_tokens FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT,INSERT ON public.app_mcp_clients,public.app_mcp_grants,public.app_mcp_authorizations,public.app_mcp_tokens TO xmartmenu_runtime;
-- Column-level UPDATE is also required for FOR SHARE client pinning. Metadata
-- and secret digests remain immutable to the application role.
GRANT UPDATE(disabled_at) ON public.app_mcp_clients TO xmartmenu_runtime;
GRANT UPDATE(revoked_at) ON public.app_mcp_grants TO xmartmenu_runtime;
GRANT UPDATE(status,grant_id,code_hash,code_expires_at,used_at) ON public.app_mcp_authorizations TO xmartmenu_runtime;
GRANT UPDATE(consumed_at) ON public.app_mcp_tokens TO xmartmenu_runtime;
GRANT SELECT ON public.app_mcp_clients,public.app_mcp_grants,public.app_mcp_authorizations,public.app_mcp_tokens TO xmartmenu_staging_reader;
ALTER TABLE public.app_mcp_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_mcp_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_mcp_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_mcp_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_mcp_clients_runtime ON public.app_mcp_clients TO xmartmenu_runtime USING(true) WITH CHECK(true);
CREATE POLICY app_mcp_grants_runtime ON public.app_mcp_grants TO xmartmenu_runtime USING(true) WITH CHECK(true);
CREATE POLICY app_mcp_authorizations_runtime ON public.app_mcp_authorizations TO xmartmenu_runtime USING(true) WITH CHECK(true);
CREATE POLICY app_mcp_tokens_runtime ON public.app_mcp_tokens TO xmartmenu_runtime USING(true) WITH CHECK(true);
CREATE POLICY app_mcp_clients_reader ON public.app_mcp_clients FOR SELECT TO xmartmenu_staging_reader USING(true);
CREATE POLICY app_mcp_grants_reader ON public.app_mcp_grants FOR SELECT TO xmartmenu_staging_reader USING(true);
CREATE POLICY app_mcp_authorizations_reader ON public.app_mcp_authorizations FOR SELECT TO xmartmenu_staging_reader USING(true);
CREATE POLICY app_mcp_tokens_reader ON public.app_mcp_tokens FOR SELECT TO xmartmenu_staging_reader USING(true);
COMMIT;
