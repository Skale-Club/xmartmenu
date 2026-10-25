-- Audit trail: who changed what, when, from where — for every admin action.
--
-- Recorded by triggers, so nothing slips through: changes made from the admin
-- in the browser (Supabase client with the user's token), from API routes
-- (service role) and from SQL alike.
--
--   actor_id   the user: from their token (browser writes) or from the
--              x-actor-id header our server sends on service-role calls
--              (src/lib/supabase/server.ts); NULL for SQL / jobs.
--   via        'browser' (user token) | 'server' (service role) | 'anon' |
--              'sql' (no API request: migrations, dashboard, scripts).
--   request_id the x-request-id of the API request — the same id as in the
--              logs and in Sentry.
--   changes    UPDATE: only the columns that changed, {"col": [old, new]};
--              INSERT/DELETE: the row. Secret-looking columns are redacted.
--
-- Read-only for everyone (no write policies): superadmins see everything,
-- restaurant owners see their own restaurant.

CREATE TABLE IF NOT EXISTS public.audit_events (
  id          BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id   UUID,          -- no FK: history outlives the restaurant
  actor_id    UUID,          -- no FK: history outlives the user
  via         TEXT NOT NULL CHECK (via IN ('browser', 'server', 'anon', 'sql')),
  table_name  TEXT NOT NULL,
  record_id   TEXT,
  action      TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  changes     JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id  TEXT
);

CREATE INDEX IF NOT EXISTS audit_events_occurred_idx ON public.audit_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_tenant_idx ON public.audit_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_record_idx ON public.audit_events (table_name, record_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON public.audit_events (actor_id, occurred_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_events_request_idx ON public.audit_events (request_id) WHERE request_id IS NOT NULL;

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_events_superadmin_read ON public.audit_events;
CREATE POLICY audit_events_superadmin_read ON public.audit_events
  FOR SELECT USING (public.is_superadmin());

DROP POLICY IF EXISTS audit_events_owner_read ON public.audit_events;
CREATE POLICY audit_events_owner_read ON public.audit_events
  FOR SELECT USING (
    tenant_id IS NOT NULL
    AND tenant_id = public.auth_tenant_id()
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('store-admin', 'admin'))
  );

-- TG_ARGV[0]: comma-separated columns to ignore (e.g. updated_at). An UPDATE
-- that changes only ignored columns is not recorded.
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ignored   TEXT[] := CASE WHEN TG_NARGS > 0 THEN string_to_array(TG_ARGV[0], ',') ELSE ARRAY[]::TEXT[] END;
  old_row   JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  new_row   JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  row_data  JSONB := COALESCE(new_row, old_row);
  diff      JSONB := '{}'::jsonb;
  k         TEXT;
  headers   JSONB;
  claims    JSONB;
  actor     UUID;
  header_actor TEXT;
  role_claim TEXT;
  source    TEXT;
  tenant    UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(new_row) LOOP
      CONTINUE WHEN k = ANY(ignored);
      IF (old_row -> k) IS DISTINCT FROM (new_row -> k) THEN
        diff := diff || jsonb_build_object(k, jsonb_build_array(old_row -> k, new_row -> k));
      END IF;
    END LOOP;
    IF diff = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  ELSE
    diff := row_data - ignored;
  END IF;

  -- Never store secrets (API keys, tokens, passwords) in the trail.
  FOR k IN SELECT jsonb_object_keys(diff) LOOP
    IF k ~* '(key|secret|token|password)' THEN
      diff := jsonb_set(diff, ARRAY[k], '"[redacted]"'::jsonb);
    END IF;
  END LOOP;

  -- PostgREST exposes the request's headers and JWT claims as settings.
  BEGIN
    headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN headers := NULL;
  END;
  BEGIN
    claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN others THEN claims := NULL;
  END;
  role_claim := claims ->> 'role';

  IF claims ->> 'sub' ~* '^[0-9a-f-]{36}$' THEN
    actor := (claims ->> 'sub')::uuid;
  END IF;
  header_actor := headers ->> 'x-actor-id';
  IF actor IS NULL AND role_claim = 'service_role' AND header_actor ~* '^[0-9a-f-]{36}$' THEN
    actor := header_actor::uuid;
  END IF;

  source := CASE
    WHEN role_claim = 'service_role' THEN 'server'
    WHEN role_claim = 'authenticated' THEN 'browser'
    WHEN role_claim = 'anon' THEN 'anon'
    ELSE 'sql'
  END;

  BEGIN
    tenant := CASE WHEN TG_TABLE_NAME = 'tenants' THEN (row_data ->> 'id') ELSE (row_data ->> 'tenant_id') END::uuid;
  EXCEPTION WHEN others THEN tenant := NULL;
  END;

  INSERT INTO public.audit_events (tenant_id, actor_id, via, table_name, record_id, action, changes, request_id)
  VALUES (
    tenant,
    actor,
    source,
    TG_TABLE_NAME,
    COALESCE(row_data ->> 'id', row_data ->> 'tenant_id'),
    lower(TG_OP),
    diff,
    left(headers ->> 'x-request-id', 128)
  );
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_row_change() FROM PUBLIC, anon, authenticated;

-- Configuration and catalogue: every insert / update / delete.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants', 'tenant_settings', 'tenant_subscriptions', 'plans', 'platform_settings', 'profiles',
    'menus', 'categories', 'products', 'product_option_groups', 'product_options', 'product_media',
    'ingredients', 'product_ingredients', 'restaurant_tables', 'locations', 'delivery_zones',
    'chat_addon_settings', 'stripe_connections', 'qr_codes'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.%I '
        'FOR EACH ROW EXECUTE FUNCTION public.audit_row_change(%L)',
        t, 'updated_at,created_at'
      );
    END IF;
  END LOOP;
END $$;

-- Orders: only status changes (who accepted, cancelled, delivered), not every
-- order placed — those already live in the orders table and the analytics.
DROP TRIGGER IF EXISTS audit_order_status ON public.orders;
CREATE TRIGGER audit_order_status
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.audit_row_change('updated_at,created_at');
